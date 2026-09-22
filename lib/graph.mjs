import { htmlToText, normalizeGraphMessage } from './text.mjs';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const LOGIN_ROOT = 'https://login.microsoftonline.com';
const SCOPES = [
  'offline_access',
  'Chat.Read',
  'ChannelMessage.Read.All',
  'Channel.ReadBasic.All'
].join(' ');

async function formPost(url, fields) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || `HTTP ${response.status}`);
    error.code = payload.error;
    throw error;
  }
  return payload;
}

export async function startDeviceCode({ tenantId, clientId }) {
  return formPost(`${LOGIN_ROOT}/${encodeURIComponent(tenantId)}/oauth2/v2.0/devicecode`, {
    client_id: clientId,
    scope: SCOPES
  });
}

export async function pollDeviceCode({ tenantId, clientId, deviceCode, interval, expiresIn, onToken, onExpired }) {
  const deadline = Date.now() + expiresIn * 1000;
  let delay = Math.max(5, interval || 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const token = await formPost(`${LOGIN_ROOT}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: deviceCode
      });
      await onToken(normalizeToken(token));
      return;
    } catch (error) {
      if (error.code === 'authorization_pending') continue;
      if (error.code === 'slow_down') {
        delay += 5000;
        continue;
      }
      if (error.code === 'authorization_declined' || error.code === 'expired_token') break;
      throw error;
    }
  }
  await onExpired();
}

export async function refreshAccessToken({ tenantId, clientId, refreshToken }) {
  const token = await formPost(`${LOGIN_ROOT}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPES
  });
  return normalizeToken(token);
}

function normalizeToken(token) {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
    scope: token.scope || SCOPES
  };
}

async function graphGet(pathOrUrl, accessToken) {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_ROOT}${pathOrUrl}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Microsoft Graph ${response.status}: ${body.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function graphCollection(path, accessToken, maxPages = 4) {
  const values = [];
  let next = path;
  let pages = 0;
  while (next && pages < maxPages) {
    const payload = await graphGet(next, accessToken);
    values.push(...(payload.value || []));
    next = payload['@odata.nextLink'];
    pages += 1;
  }
  return values;
}

async function resolveSourceLabel(source, accessToken) {
  try {
    if (source.type === 'channel') {
      const channel = await graphGet(`/teams/${source.teamId}/channels/${encodeURIComponent(source.channelId)}`, accessToken);
      return channel.displayName || source.label;
    }
    const chat = await graphGet(`/chats/${encodeURIComponent(source.chatId)}?$expand=members`, accessToken);
    if (chat.topic) return chat.topic;
    const names = (chat.members || []).map((member) => member.displayName).filter(Boolean);
    return names.length ? names.join(', ') : source.label;
  } catch {
    return source.label;
  }
}

export async function fetchSourceMessages(source, accessToken) {
  source.resolvedLabel = await resolveSourceLabel(source, accessToken);
  let raw;
  if (source.type === 'channel') {
    const base = `/teams/${source.teamId}/channels/${encodeURIComponent(source.channelId)}/messages`;
    const roots = await graphCollection(`${base}?$top=50`, accessToken, 2);
    const replyGroups = [];
    for (let index = 0; index < roots.length; index += 5) {
      const batch = roots.slice(index, index + 5);
      replyGroups.push(...await Promise.all(batch.map((message) =>
        graphCollection(`${base}/${encodeURIComponent(message.id)}/replies?$top=50`, accessToken, 2)
      )));
    }
    raw = roots.flatMap((message, index) => [message, ...(replyGroups[index] || [])]);
  } else {
    raw = await graphCollection(`/chats/${encodeURIComponent(source.chatId)}/messages?$top=50`, accessToken, 2);
  }
  return raw
    .filter((message) => message.messageType === 'message' || !message.messageType)
    .map((message) => normalizeGraphMessage(message, source));
}

export function summarizeGraphError(error) {
  const text = htmlToText(error?.message || String(error));
  if (error?.status === 403) {
    return 'Microsoft Graph refuse la lecture. Vérifiez les permissions déléguées et le consentement administrateur.';
  }
  if (error?.status === 401) return 'La session Microsoft a expiré. Reconnectez-vous.';
  return text.slice(0, 600);
}
