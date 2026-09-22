import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { runCodexAgent } from './lib/agent.mjs';
import {
  fetchSourceMessages, pollDeviceCode, refreshAccessToken, startDeviceCode, summarizeGraphError
} from './lib/graph.mjs';
import { mergeMessages, readJson, writeJson } from './lib/store.mjs';
import { fetchBrowserSourceMessages, getTeamsBrowserStatus, startTeamsBrowser } from './lib/teams-browser.mjs';
import { browserMessageDate, classifyMessage } from './lib/text.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const CONFIG_PATH = process.env.TEAMS_BOARD_CONFIG || join(ROOT, 'config.json');
const STATE_PATH = join(DATA, 'state.json');
const AUTH_PATH = join(DATA, 'auth.json');
const PORT = Number(process.env.PORT || 4317);
const CLIENT_ID = process.env.TEAMS_BOARD_CLIENT_ID || '';
const config = await readJson(CONFIG_PATH, {});
const codexBin = process.env.CODEX_BIN || 'codex';

const selfAuthors = config.selfAuthors || [];

function isSelfAuthor(author) {
  return selfAuthors.includes(author);
}

/** Browser messages once stored the sync time as date: rebuild it from the epoch identifier. */
function repairDate(message) {
  if (message.graphId || message.isDemo) return message.createdAt;
  return browserMessageDate({ id: message.id.split(':').pop(), createdAt: message.createdAt }) || message.createdAt;
}

function enrichMessage(message) {
  const classification = classifyMessage(`${message.subject || ''}\n${message.content || ''}`);
  const createdAt = repairDate(message);
  return {
    ...message,
    createdAt,
    updatedAt: message.updatedAt && message.updatedAt >= createdAt ? message.updatedAt : createdAt,
    needsReply: Boolean(message.needsReply) && !isSelfAuthor(message.author),
    threadId: message.threadId || message.id,
    groupId: message.groupId || `${message.sourceId}:thread:${message.threadId || message.id}`,
    project: message.project && message.project !== 'unknown' ? message.project : classification.project,
    confidence: Math.max(message.confidence || 0, classification.confidence || 0),
    supportType: classification.supportType !== 'inconnu'
      ? classification.supportType : (message.supportType || classification.supportType),
    criticality: classification.supportType === 'bug'
      ? classification.criticality : (message.criticality ?? classification.criticality),
    businessTags: message.businessTags?.length ? message.businessTags : classification.businessTags
  };
}

let state = await readJson(STATE_PATH, {
  messages: [],
  firstSyncComplete: false,
  lastSyncAt: null,
  lastSyncError: null,
  sourceErrors: {}
});
{
  const before = JSON.stringify(state.messages);
  state.messages = state.messages
    .filter((message) => !(message.graphId === null && /^[^:]+:::[^:]+:\d+$/.test(message.id)))
    .map(enrichMessage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (JSON.stringify(state.messages) !== before) await writeJson(STATE_PATH, state);
}
let auth = await readJson(AUTH_PATH, null);
if (!auth?.accessToken && !auth?.refreshToken) auth = null;
let deviceFlow = null;
let syncPromise = null;
let browser = await getTeamsBrowserStatus();
const analysisQueue = [];
let analysisRunning = false;

const demoMessages = [
  {
    id: 'demo:coach', sourceId: 'taskforce-coach-aca', sourceLabel: 'Taskforce Coach-Aca',
    sourceUrl: config.sources?.[2]?.url, webUrl: config.sources?.[2]?.url,
    author: 'Camille R.', createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    content: "Pourquoi l'automatisation Coach ne génère plus de simulation pour ce groupe ?",
    needsReply: true, project: 'coach', confidence: 0.91, status: 'new', answer: '', evidence: [], isDemo: true
  },
  {
    id: 'demo:academy', sourceId: 'chat-coach-academy-2', sourceLabel: 'Chat projet 2',
    sourceUrl: config.sources?.[1]?.url, webUrl: config.sources?.[1]?.url,
    author: 'Nicolas P.', createdAt: new Date(Date.now() - 37 * 60_000).toISOString(),
    content: "Savez-vous pourquoi la progression du module Academy reste à 0 % ?",
    needsReply: true, project: 'academy', confidence: 0.94, status: 'ready',
    answer: "La progression est enregistrée à la réception du callback du jeu. Il faut d'abord vérifier que l'appel arrive bien côté Academy avec le bon identifiant utilisateur, puis contrôler la ligne persistée avant de conclure à un problème d'affichage.",
    evidence: [{ path: 'backend/.../EmeraudeController.java', reason: 'Point d’entrée de lecture de la progression' }], isDemo: true
  },
  {
    id: 'demo:info', sourceId: 'chat-coach-academy-1', sourceLabel: 'Chat projet 1',
    sourceUrl: config.sources?.[0]?.url, webUrl: config.sources?.[0]?.url,
    author: 'Sophie L.', createdAt: new Date(Date.now() - 68 * 60_000).toISOString(),
    content: 'La livraison de la branche de recette est terminée.',
    needsReply: false, project: 'unknown', confidence: 0, status: 'new', answer: '', evidence: [], isDemo: true
  }
].map(enrichMessage);

let codexCheck = { checkedAt: 0, available: false, version: '' };

function checkCodex() {
  if (Date.now() - codexCheck.checkedAt < 60_000) return codexCheck;
  const result = spawnSync(codexBin, ['--version'], { encoding: 'utf8', timeout: 3000 });
  codexCheck = { checkedAt: Date.now(), available: result.status === 0, version: (result.stdout || '').trim().split('\n')[0] };
  return codexCheck;
}

function publicStatus() {
  const codex = checkCodex();
  return {
    connected: Boolean(auth?.refreshToken || (auth?.accessToken && auth.expiresAt > Date.now()) || browser.loggedIn),
    connectionMode: auth ? 'graph' : browser.loggedIn ? 'browser' : null,
    browser,
    clientConfigured: Boolean(CLIENT_ID),
    deviceFlow: deviceFlow && {
      userCode: deviceFlow.userCode,
      verificationUri: deviceFlow.verificationUri,
      message: deviceFlow.message,
      expiresAt: deviceFlow.expiresAt,
      status: deviceFlow.status,
      error: deviceFlow.error
    },
    codexAvailable: codex.available,
    codexVersion: codex.version,
    selfAuthors,
    lastSyncAt: state.lastSyncAt,
    lastSyncError: state.lastSyncError,
    sourceErrors: state.sourceErrors,
    sources: (config.sources || []).map(({ id, label, type, url }) => ({ id, label, type, url })),
    pollIntervalMinutes: config.pollIntervalMinutes || 2,
    repositories: config.repositories,
    demo: !state.messages.length && Boolean(config.showDemoWhenEmpty)
  };
}

async function saveState() {
  await writeJson(STATE_PATH, state);
}

async function saveAuth() {
  await writeJson(AUTH_PATH, auth, 0o600);
}

function notifyDesktop(message) {
  const uid = process.getuid?.() || 1000;
  const child = spawn('notify-send', [
    '--app-name=Reply Board', '--icon=dialog-information',
    `Nouveau message · ${message.sourceLabel}`,
    `${message.author} : ${message.content.slice(0, 180)}`
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${uid}/bus`
    }
  });
  child.on('error', () => {});
  child.unref();
}

async function accessToken() {
  if (!auth) throw new Error('Microsoft Teams non connecté.');
  if (auth.accessToken && auth.expiresAt > Date.now() + 90_000) return auth.accessToken;
  if (!auth.refreshToken) throw new Error('Session Microsoft expirée. Reconnectez-vous.');
  auth = await refreshAccessToken({
    tenantId: config.tenantId,
    clientId: CLIENT_ID,
    refreshToken: auth.refreshToken
  });
  await saveAuth();
  return auth.accessToken;
}

async function syncMessages() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const incoming = [];
    const sourceErrors = {};
    const token = auth ? await accessToken() : null;
    if (!token && !browser.loggedIn) throw new Error('Connectez-vous à Teams dans la fenêtre Chrome dédiée.');
    for (const source of config.sources || []) {
      try {
        incoming.push(...(token
          ? await fetchSourceMessages({ ...source }, token)
          : await fetchBrowserSourceMessages({ ...source, selfAuthors })));
      } catch (error) {
        sourceErrors[source.id] = summarizeGraphError(error);
      }
    }
    const firstSync = !state.firstSyncComplete;
    const previousSyncAt = state.lastSyncAt;
    const merged = mergeMessages(state.messages, incoming);
    const sourceLabels = new Map((config.sources || []).map((source) => [source.id, source.label]));
    state = {
      ...state,
      messages: merged.messages.map((message) => ({
        ...message,
        sourceLabel: sourceLabels.get(message.sourceId) || message.sourceLabel
      })),
      firstSyncComplete: true,
      lastSyncAt: new Date().toISOString(),
      lastSyncError: Object.keys(sourceErrors).length === (config.sources || []).length
        ? 'Aucune source Teams n’a pu être lue.'
        : null,
      sourceErrors
    };
    await saveState();
    const fresh = merged.inserted.filter((message) => !isSelfAuthor(message.author)
      && (!previousSyncAt || Date.parse(message.createdAt) > Date.parse(previousSyncAt)));
    if (!firstSync) {
      for (const message of fresh) notifyDesktop(message);
      if (config.autoAnalyzeNewQuestions) {
        for (const message of fresh.filter((item) => item.needsReply)) enqueueAnalysis(message.id);
      }
    }
    return { imported: merged.inserted.length, sourceErrors };
  })().catch(async (error) => {
    state.lastSyncError = summarizeGraphError(error);
    await saveState();
    throw error;
  }).finally(() => { syncPromise = null; });
  return syncPromise;
}

function conversationContext(target) {
  return state.messages
    .filter((message) => message.id !== target.id && (target.groupId
      ? message.groupId === target.groupId
      : message.sourceId === target.sourceId))
    .filter((message) => message.createdAt <= target.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)
    .reverse()
    .map((message) => `[${message.author}] ${message.content}`)
    .join('\n');
}

function enqueueAnalysis(id, forcedProject) {
  const existing = analysisQueue.find((item) => item.id === id);
  if (!existing) analysisQueue.push({ id, forcedProject });
  void runQueue();
}

async function runQueue() {
  if (analysisRunning) return;
  analysisRunning = true;
  try {
    while (analysisQueue.length) {
      const { id, forcedProject } = analysisQueue.shift();
      const message = state.messages.find((item) => item.id === id);
      if (!message) continue;
      message.status = 'analyzing';
      message.error = null;
      await saveState();
      try {
        const result = await runCodexAgent({
          message,
          context: conversationContext(message),
          project: forcedProject || message.project || 'unknown',
          repositories: config.repositories,
          codexBin
        });
        message.project = result.project === 'unknown' ? (forcedProject || message.project) : result.project;
        message.confidence = Math.max(message.confidence || 0, 0.9);
        message.answer = result.answer;
        message.evidence = result.evidence;
        message.status = 'ready';
      } catch (error) {
        message.status = 'error';
        message.error = error.message;
      }
      await saveState();
    }
  } finally {
    analysisRunning = false;
  }
}

function dayKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function daysAgo(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date;
}

function computeStats() {
  const treated = state.messages
    .filter((message) => message.status === 'treated' && message.processedAt)
    .map((message) => dayKey(new Date(message.processedAt)));
  const perDay = new Map();
  for (const key of treated) perDay.set(key, (perDay.get(key) || 0) + 1);
  let streak = 0;
  for (let offset = 0; offset < 365; offset += 1) {
    if (perDay.has(dayKey(daysAgo(offset)))) streak += 1;
    else if (offset > 0) break;
  }
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = dayKey(daysAgo(6 - index));
    return { day, treated: perDay.get(day) || 0 };
  });
  const open = state.messages.filter((message) => message.needsReply && !['treated', 'archived'].includes(message.status));
  return {
    treatedTotal: treated.length,
    treatedToday: perDay.get(dayKey(new Date())) || 0,
    streak,
    week,
    openQuestions: open.length,
    oldestOpen: open.map((message) => message.createdAt).sort()[0] || null
  };
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function bodyJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Requête trop volumineuse.');
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(pathname, response) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = resolve(PUBLIC, relative);
  if (!target.startsWith(`${resolve(PUBLIC)}/`) && target !== resolve(PUBLIC, 'index.html')) {
    json(response, 403, { error: 'Accès refusé.' });
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not file');
    const mime = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'
    }[extname(target)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
    response.end(await readFile(target));
  } catch {
    json(response, 404, { error: `${basename(target)} introuvable.` });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      browser = await getTeamsBrowserStatus();
      return json(response, 200, publicStatus());
    }
    if (request.method === 'GET' && url.pathname === '/api/stats') {
      return json(response, 200, computeStats());
    }
    if (request.method === 'GET' && url.pathname === '/api/messages') {
      const messages = state.messages.length ? state.messages : (config.showDemoWhenEmpty ? demoMessages : []);
      return json(response, 200, { messages });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/start') {
      if (!CLIENT_ID) return json(response, 409, { error: 'Définissez TEAMS_BOARD_CLIENT_ID avant de connecter Microsoft Teams.' });
      const flow = await startDeviceCode({ tenantId: config.tenantId, clientId: CLIENT_ID });
      deviceFlow = {
        userCode: flow.user_code,
        verificationUri: flow.verification_uri,
        message: flow.message,
        expiresAt: Date.now() + flow.expires_in * 1000,
        status: 'pending',
        error: null
      };
      void pollDeviceCode({
        tenantId: config.tenantId,
        clientId: CLIENT_ID,
        deviceCode: flow.device_code,
        interval: flow.interval,
        expiresIn: flow.expires_in,
        onToken: async (token) => {
          auth = token;
          deviceFlow.status = 'connected';
          await saveAuth();
          void syncMessages();
        },
        onExpired: async () => { deviceFlow.status = 'expired'; }
      }).catch((error) => {
        deviceFlow.status = 'error';
        deviceFlow.error = error.message;
      });
      return json(response, 200, publicStatus().deviceFlow);
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      auth = null;
      await writeJson(AUTH_PATH, null, 0o600);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/browser/start') {
      browser = await startTeamsBrowser({ root: ROOT, url: config.sources?.[0]?.url });
      return json(response, 200, browser);
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      const result = await syncMessages();
      return json(response, 200, result);
    }
    if (request.method === 'POST' && url.pathname === '/api/messages/mark-treated') {
      const payload = await bodyJson(request);
      const category = ['todo', 'coach', 'academy', 'all'].includes(payload.category) ? payload.category : 'all';
      const groupId = typeof payload.groupId === 'string' ? payload.groupId : null;
      const targetStatus = ['new', 'treated'].includes(payload.status) ? payload.status : 'treated';
      const selected = state.messages.filter((message) => {
        if (groupId) return message.groupId === groupId;
        if (message.status === 'archived' || message.status === 'treated') return false;
        if (category === 'todo') return message.needsReply;
        if (category === 'coach' || category === 'academy') return message.project === category;
        return true;
      });
      const now = new Date().toISOString();
      for (const message of selected) {
        Object.assign(message, enrichMessage(message));
        message.status = targetStatus;
        message.processedAt = targetStatus === 'treated' ? now : null;
      }
      await saveState();
      return json(response, 200, { treated: selected.length });
    }
    const analyzeMatch = url.pathname.match(/^\/api\/messages\/(.+)\/analyze$/);
    if (request.method === 'POST' && analyzeMatch) {
      const id = decodeURIComponent(analyzeMatch[1]);
      const message = state.messages.find((item) => item.id === id) || demoMessages.find((item) => item.id === id);
      if (!message) return json(response, 404, { error: 'Message introuvable.' });
      if (message.isDemo && !state.messages.some((item) => item.id === id)) {
        state.messages.unshift({ ...message, isDemo: false });
      }
      const payload = await bodyJson(request);
      enqueueAnalysis(id, ['coach', 'academy'].includes(payload.project) ? payload.project : undefined);
      return json(response, 202, { queued: true });
    }
    const updateMatch = url.pathname.match(/^\/api\/messages\/(.+)$/);
    if (request.method === 'PATCH' && updateMatch) {
      const id = decodeURIComponent(updateMatch[1]);
      const message = state.messages.find((item) => item.id === id);
      if (!message) return json(response, 404, { error: 'Message introuvable.' });
      const payload = await bodyJson(request);
      if (['new', 'ready', 'archived', 'treated'].includes(payload.status)) {
        if (payload.status === 'treated') Object.assign(message, enrichMessage(message));
        message.status = payload.status;
        message.processedAt = payload.status === 'treated' ? new Date().toISOString() : null;
      }
      if (['coach', 'academy', 'unknown'].includes(payload.project)) message.project = payload.project;
      if (typeof payload.answer === 'string') message.answer = payload.answer.slice(0, 30_000);
      await saveState();
      return json(response, 200, message);
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Route inconnue.' });
    return serveStatic(url.pathname, response);
  } catch (error) {
    return json(response, 500, { error: error.message || 'Erreur interne.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Teams Answer Board: http://127.0.0.1:${PORT}`);
});

const intervalMs = Math.max(1, config.pollIntervalMinutes || 2) * 60_000;
setInterval(() => {
  if (auth || browser.loggedIn) void syncMessages().catch(() => {});
}, intervalMs).unref();
