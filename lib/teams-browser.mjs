import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CdpClient, listCdpTargets } from './cdp.mjs';
import { normalizeBrowserMessage } from './text.mjs';

const PORT = Number(process.env.TEAMS_BROWSER_DEBUG_PORT || 9223);
const CHROME = process.env.TEAMS_BROWSER_BIN || 'google-chrome';
const sourceTabs = new Map();

function isTeamsUrl(url = '') {
  return /^https:\/\/teams\.(cloud\.)?microsoft\//.test(url);
}

export async function getTeamsBrowserStatus() {
  try {
    const targets = await listCdpTargets(PORT);
    const page = targets.find((item) => item.type === 'page' && isTeamsUrl(item.url));
    const login = targets.find((item) => item.type === 'page' && /login\.microsoftonline\.com/.test(item.url));
    return {
      running: true,
      loggedIn: Boolean(page),
      url: page?.url || login?.url || null,
      port: PORT
    };
  } catch {
    return { running: false, loggedIn: false, url: null, port: PORT };
  }
}

export async function startTeamsBrowser({ root, url }) {
  const current = await getTeamsBrowserStatus();
  if (current.running) return current;
  const profile = join(root, 'data', 'teams-browser-profile');
  await mkdir(profile, { recursive: true });
  const uid = process.getuid?.() || 1000;
  const child = spawn(CHROME, [
    '--ozone-platform=wayland', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--no-sandbox', url
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${uid}/bus`,
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0'
    }
  });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return getTeamsBrowserStatus();
}

async function openSource(source) {
  let targets = await listCdpTargets(PORT);
  let target = targets.find((item) => item.id === sourceTabs.get(source.id));
  if (!target) {
    for (const candidate of targets.filter((item) => item.type === 'page' && isTeamsUrl(item.url))) {
      const probe = await new CdpClient(candidate.webSocketDebuggerUrl).connect();
      try {
        if (await probe.evaluate(`sessionStorage.getItem('teams-answer-board-source')`) === source.id) {
          target = candidate;
          break;
        }
      } finally {
        probe.close();
      }
    }
  }
  if (!target) {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(source.url)}`, {
      method: 'PUT', signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Chrome n'a pas pu ouvrir ${source.label}.`);
    target = await response.json();
  }
  sourceTabs.set(source.id, target.id);
  const client = await new CdpClient(target.webSocketDebuggerUrl).connect();
  await client.call('Page.enable');
  if (!isTeamsUrl(target.url)) await client.call('Page.navigate', { url: source.url });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const result = await client.evaluate(`({
      url: location.href,
      ready: document.readyState,
      messages: document.querySelectorAll('[data-tid="chat-pane-message"], [data-tid="channel-pane-message"], [data-message-id], [data-mid]').length
    })`);
    if (isTeamsUrl(result.url) && result.ready === 'complete' && result.messages > 0) {
      await client.evaluate(`sessionStorage.setItem('teams-answer-board-source', ${JSON.stringify(source.id)})`);
      return client;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  client.close();
  throw new Error(`${source.label} ne s'est pas chargé dans Teams.`);
}

const EXTRACT_MESSAGES = `(() => {
  const primary = '[data-tid="chat-pane-item"], [data-tid="channel-pane-message"] [data-mid], [data-tid="thread-pane-message"]';
  const nodes = [...document.querySelectorAll(primary)].filter((node) =>
    node.getAttribute('data-tid') !== 'chat-pane-item' || node.querySelector('[data-tid="chat-pane-message"]'));
  if (!nodes.length) nodes.push(...document.querySelectorAll('[data-tid="chat-pane-message"], [data-message-id], [data-mid]'));
  const value = (node, selectors) => {
    for (const item of selectors) {
      const found = node.querySelector(item);
      if (found?.innerText?.trim()) return found.innerText.trim();
    }
    return '';
  };
  return nodes.map((node, index) => {
    const messageNode = node.matches('[data-message-id], [data-mid]') ? node : node.querySelector('[data-message-id], [data-mid]');
    const messageId = messageNode?.getAttribute('data-message-id') || messageNode?.getAttribute('data-mid') || '';
    const body = value(node, ['[data-tid="message-body"]', '[data-tid="chat-pane-message-body"]',
      '[data-tid="channel-message-body"]', '.fui-ChatMessage__body', '[class*="messageBody"]']);
    let author = value(node, ['[data-tid="message-author-name"]', '[data-tid="message-author"]',
      '[data-tid="author-name"]', '[id^="author-"]', '[class*="author"]']);
    if (!author && messageId) author = document.getElementById('author-' + messageId)?.innerText?.trim() || '';
    if (!author) author = (node.querySelector('[aria-label^="Profile picture of "]')?.getAttribute('aria-label') || '')
      .replace(/^Profile picture of /, '').replace(/\.$/, '');
    const time = node.querySelector('time') || (messageId ? document.getElementById('timestamp-' + messageId) : null);
    const content = body || node.innerText?.trim() || '';
    const id = messageId || node.id ||
      [time?.dateTime || '', author, content, index].join(':');
    return { id, author, createdAt: time?.dateTime || time?.getAttribute('datetime') || time?.getAttribute('aria-label') || time?.title || '', content };
  }).filter((item) => item.content && item.content.length < 30000);
})()`;

export async function fetchBrowserSourceMessages(source) {
  const client = await openSource(source);
  try {
    await client.evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-tid*="message"], [role="main"]')]
        .filter((el) => el.scrollHeight > el.clientHeight + 100);
      const pane = panes.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (pane) pane.scrollTop = pane.scrollHeight;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const messages = await client.evaluate(EXTRACT_MESSAGES);
    if (!messages.length) throw new Error(`Aucun message visible dans ${source.label}.`);
    const conversationLabel = await client.evaluate(`[
      '[data-tid="chat-title-name-group-chat"]', '[data-tid="chat-title"]',
      '[data-tid="channelTitle-text"]'
    ].map((selector) => document.querySelector(selector)?.innerText?.trim()).find(Boolean) || ''`);
    const resolvedSource = { ...source, resolvedLabel: conversationLabel || source.label };
    return messages.map((message) => normalizeBrowserMessage(message, resolvedSource));
  } finally {
    client.close();
  }
}
