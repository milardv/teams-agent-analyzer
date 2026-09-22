const state = {
  messages: [], status: null, filter: 'todo', selectedId: null, authTimer: null
};

const elements = {
  list: document.querySelector('#message-list'), detail: document.querySelector('#detail-panel'),
  title: document.querySelector('#view-title'), sync: document.querySelector('#sync-button'),
  syncLabel: document.querySelector('#sync-label'), connect: document.querySelector('#connect-button'),
  markCategory: document.querySelector('#mark-category-button'),
  connection: document.querySelector('#connection-card'), connectionDetail: document.querySelector('#connection-detail'),
  demo: document.querySelector('#demo-notice'), error: document.querySelector('#error-notice'),
  dialog: document.querySelector('#auth-dialog'), authContent: document.querySelector('#auth-content'),
  toast: document.querySelector('#toast')
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  return payload;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function relativeDate(value) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function projectLabel(project) {
  return project === 'coach' ? 'Coach' : project === 'academy' ? 'Academy' : 'À classer';
}

function filteredMessages() {
  return state.messages.filter((message) => {
    if (state.filter === 'todo') return message.needsReply && !['archived', 'treated'].includes(message.status);
    if (state.filter === 'treated') return message.status === 'treated';
    if (state.filter === 'archived') return message.status === 'archived';
    if (state.filter === 'coach' || state.filter === 'academy') {
      return message.project === state.filter && message.status !== 'archived';
    }
    return message.status !== 'archived';
  });
}

function renderCounts() {
  const count = (predicate) => state.messages.filter(predicate).length;
  const isOpen = (message) => !['archived', 'treated'].includes(message.status);
  document.querySelector('#count-todo').textContent = count((m) => m.needsReply && isOpen(m));
  document.querySelector('#count-coach').textContent = count((m) => m.project === 'coach' && isOpen(m));
  document.querySelector('#count-academy').textContent = count((m) => m.project === 'academy' && isOpen(m));
  document.querySelector('#count-all').textContent = count(isOpen);
  document.querySelector('#count-treated').textContent = count((m) => m.status === 'treated');
  document.querySelector('#count-archived').textContent = count((m) => m.status === 'archived');
}

function taskforceFirst(messages) {
  return [...messages].sort((a, b) => {
    const priorityA = a.sourceId === 'taskforce-coach-aca' ? 1 : 0;
    const priorityB = b.sourceId === 'taskforce-coach-aca' ? 1 : 0;
    return priorityB - priorityA || b.createdAt.localeCompare(a.createdAt);
  });
}

function updateCategoryActions() {
  const messages = filteredMessages();
  const candidates = messages.filter((message) => !['treated', 'archived'].includes(message.status));
  elements.markCategory.hidden = state.filter === 'treated' || state.filter === 'archived';
  elements.markCategory.disabled = candidates.length === 0;
  elements.markCategory.textContent = candidates.length ? `Tout traiter (${candidates.length})` : 'Tout est traité';
}

function renderList() {
  const messages = taskforceFirst(filteredMessages());
  renderCounts();
  if (!messages.length) {
    elements.list.innerHTML = '<div class="empty-list">Aucun message dans cette vue.</div>';
    return;
  }
  elements.list.innerHTML = messages.map((message) => `
    <article class="message-card ${message.id === state.selectedId ? 'selected' : ''} ${message.status === 'treated' ? 'treated' : ''}" data-id="${escapeHtml(message.id)}">
      <button class="message-open" type="button" aria-label="Ouvrir le message de ${escapeHtml(message.author)}">
        <span class="message-top"><span class="message-author">${escapeHtml(message.author)}</span><span class="message-time">${relativeDate(message.createdAt)}</span></span>
        <span class="message-conversation">Conversation · ${escapeHtml(message.sourceLabel)}</span>
        <span class="message-text">${escapeHtml(message.content)}</span>
        <span class="message-meta">
          <span class="badge ${message.project}">${projectLabel(message.project)}</span>
          ${['analyzing', 'ready', 'error'].includes(message.status) ? `<span class="badge ${message.status}">${message.status === 'analyzing' ? 'Analyse…' : message.status === 'ready' ? 'Réponse prête' : 'Erreur'}</span>` : ''}
          ${message.status === 'treated' ? '<span class="badge treated-badge">Traité</span>' : ''}
        </span>
      </button>
      ${message.status !== 'archived' ? `<button class="message-treated" type="button" data-treated-id="${escapeHtml(message.id)}">${message.status === 'treated' ? '↶ Rouvrir' : 'Marquer traité'}</button>` : ''}
    </article>
  `).join('');
  elements.list.querySelectorAll('.message-card').forEach((card) => {
    card.querySelector('.message-open').addEventListener('click', () => selectMessage(card.dataset.id));
    card.querySelector('.message-treated')?.addEventListener('click', () => setMessageTreated(card.dataset.id));
  });
}

function renderDetail() {
  const message = state.messages.find((item) => item.id === state.selectedId);
  if (!message) {
    elements.detail.className = 'detail empty';
    elements.detail.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">↗</div><h2>Sélectionnez un message</h2><p>La question, les preuves trouvées dans le code et la réponse proposée apparaîtront ici.</p></div>';
    return;
  }
  elements.detail.className = 'detail';
  const evidence = message.evidence?.length
    ? `<div class="evidence"><p class="section-label">Preuves dans le dépôt</p>${message.evidence.map((item) => `<div class="evidence-item"><code>${escapeHtml(item.path)}</code><span>${escapeHtml(item.reason)}</span></div>`).join('')}</div>`
    : '';
  const analysisState = message.status === 'analyzing'
    ? 'L’agent recherche dans le dépôt…'
    : message.error || (message.answer ? 'Réponse prête à relire' : 'Aucune analyse lancée');
  elements.detail.innerHTML = `
    <div class="detail-header">
      <div><span class="badge ${message.project}">${projectLabel(message.project)}</span><h2>${escapeHtml(message.author)}</h2><p>Conversation · ${escapeHtml(message.sourceLabel)} · ${formatDate(message.createdAt)}</p></div>
      <a class="detail-link" href="${escapeHtml(message.webUrl || message.sourceUrl)}" target="_blank" rel="noreferrer">Ouvrir dans Teams ↗</a>
    </div>
    <div class="detail-message">${escapeHtml(message.content)}</div>
    <div class="detail-actions">
      <select class="project-select" id="project-select" aria-label="Projet à analyser">
        <option value="unknown" ${message.project === 'unknown' ? 'selected' : ''}>Choisir le projet…</option>
        <option value="coach" ${message.project === 'coach' ? 'selected' : ''}>Phishing Coach</option>
        <option value="academy" ${message.project === 'academy' ? 'selected' : ''}>Academy</option>
      </select>
      <button class="button" id="analyze-button" ${message.status === 'analyzing' ? 'disabled' : ''}>${message.answer ? 'Relancer l’analyse' : 'Analyser le code'}</button>
      ${message.status !== 'archived' ? `<button class="button secondary" id="treated-button">${message.status === 'treated' ? '↶ Rouvrir' : 'Marquer traité'}</button>` : ''}
      <button class="button secondary" id="archive-button">${message.status === 'archived' ? 'Restaurer' : 'Archiver'}</button>
    </div>
    ${evidence}
    <p class="section-label" style="margin-top:22px">Réponse proposée</p>
    <div class="answer-box">
      <textarea id="answer-text" placeholder="La réponse de l’agent apparaîtra ici…">${escapeHtml(message.answer || '')}</textarea>
      <div class="answer-footer"><span class="answer-state">${escapeHtml(analysisState)}</span><button class="button" id="copy-button" ${message.answer ? '' : 'disabled'}>Copier la réponse</button></div>
    </div>
  `;
  document.querySelector('#analyze-button').addEventListener('click', analyzeSelected);
  document.querySelector('#archive-button').addEventListener('click', toggleArchive);
  document.querySelector('#treated-button')?.addEventListener('click', () => setMessageTreated(message.id));
  document.querySelector('#copy-button').addEventListener('click', copyAnswer);
  document.querySelector('#project-select').addEventListener('change', updateProject);
  document.querySelector('#answer-text').addEventListener('change', saveAnswer);
}

function selectMessage(id) {
  state.selectedId = id;
  renderList();
  renderDetail();
}

async function analyzeSelected() {
  const message = state.messages.find((item) => item.id === state.selectedId);
  const project = document.querySelector('#project-select').value;
  message.status = 'analyzing';
  message.error = null;
  renderList(); renderDetail();
  try {
    await api(`/api/messages/${encodeURIComponent(message.id)}/analyze`, { method: 'POST', body: JSON.stringify({ project }) });
    toast('Analyse lancée');
  } catch (error) {
    message.status = 'error'; message.error = error.message; renderDetail(); toast(error.message);
  }
}

async function updateProject(event) {
  const message = state.messages.find((item) => item.id === state.selectedId);
  message.project = event.target.value;
  await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ project: message.project }) });
  renderList();
}

async function saveAnswer(event) {
  const message = state.messages.find((item) => item.id === state.selectedId);
  message.answer = event.target.value;
  await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ answer: message.answer }) });
  toast('Brouillon enregistré');
}

async function toggleArchive() {
  const message = state.messages.find((item) => item.id === state.selectedId);
  const status = message.status === 'archived' ? 'new' : 'archived';
  await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  message.status = status;
  if (status === 'archived') state.selectedId = null;
  renderList(); renderDetail();
}

async function setMessageTreated(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  const status = message.status === 'treated' ? 'new' : 'treated';
  const saved = await api(`/api/messages/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status })
  });
  Object.assign(message, saved);
  renderList(); renderDetail(); updateCategoryActions();
  toast(status === 'treated' ? 'Message marqué comme traité' : 'Message rouvert');
}

async function markCategoryTreated() {
  const category = ['todo', 'coach', 'academy', 'all'].includes(state.filter) ? state.filter : 'all';
  const result = await api('/api/messages/mark-treated', {
    method: 'POST', body: JSON.stringify({ category })
  });
  await refresh();
  toast(`${result.treated} message${result.treated > 1 ? 's' : ''} marqué${result.treated > 1 ? 's' : ''} comme traité${result.treated > 1 ? 's' : ''}`);
}

async function copyAnswer() {
  const textarea = document.querySelector('#answer-text');
  await navigator.clipboard.writeText(textarea.value);
  toast('Réponse copiée');
}

function renderStatus() {
  const status = state.status;
  elements.demo.hidden = !status.demo;
  elements.connection.classList.toggle('online', status.connected);
  elements.connectionDetail.textContent = status.connected
    ? `Connecté · ${status.connectionMode === 'browser' ? 'navigateur local' : 'Microsoft Graph'}`
    : status.browser?.running ? 'Connexion Microsoft en attente' : 'Prêt à ouvrir';
  elements.connect.textContent = status.connected ? 'Teams connecté' : 'Ouvrir Teams';
  elements.sync.disabled = !status.connected;
  elements.syncLabel.textContent = status.lastSyncAt ? `Sync ${relativeDate(status.lastSyncAt)}` : 'Jamais synchronisé';
  const errors = [status.lastSyncError, ...Object.values(status.sourceErrors || {})].filter(Boolean);
  elements.error.hidden = !errors.length;
  elements.error.textContent = errors[0] || '';
}

async function refresh() {
  const selectedBefore = state.selectedId;
  const [status, inbox] = await Promise.all([api('/api/status'), api('/api/messages')]);
  state.status = status;
  state.messages = inbox.messages;
  if (selectedBefore && state.messages.some((message) => message.id === selectedBefore)) state.selectedId = selectedBefore;
  renderStatus(); renderList(); renderDetail(); updateCategoryActions();
}

async function sync() {
  elements.sync.disabled = true;
  elements.sync.textContent = 'Synchronisation…';
  try {
    const result = await api('/api/sync', { method: 'POST' });
    toast(`${result.imported} nouveau${result.imported > 1 ? 'x' : ''} message${result.imported > 1 ? 's' : ''}`);
    await refresh();
  } catch (error) {
    toast(error.message);
  } finally {
    elements.sync.textContent = '↻ Synchroniser';
    renderStatus();
  }
}

function authSetupContent() {
  return `<p>L’application utilise un profil Chrome local dédié. Connectez-vous à Microsoft Teams dans la fenêtre ouverte ; aucun droit administrateur Entra n’est nécessaire.</p>
    <ol class="setup-steps">
      <li>Terminez la connexion Microsoft dans Chrome.</li>
      <li>Laissez cette fenêtre ouverte ou réduite.</li>
      <li>Revenez ici : la connexion sera détectée automatiquement.</li>
    </ol>`;
}

function renderAuthFlow(flow) {
  elements.authContent.innerHTML = `<p>Ouvrez le lien Microsoft puis saisissez ce code :</p><div class="auth-code">${escapeHtml(flow.userCode)}</div><a class="button" href="${escapeHtml(flow.verificationUri)}" target="_blank" rel="noreferrer">Ouvrir Microsoft ↗</a><p style="margin-top:18px">Cette fenêtre se mettra à jour après la connexion.</p>`;
}

async function connect() {
  if (state.status.connected && state.status.connectionMode === 'graph') {
    await api('/api/auth/logout', { method: 'POST' });
    await refresh();
    return;
  }
  if (state.status.connected) {
    toast('Teams est déjà connecté');
    return;
  }
  elements.dialog.showModal();
  if (!state.status.clientConfigured) {
    elements.authContent.innerHTML = authSetupContent();
    try {
      await api('/api/browser/start', { method: 'POST' });
      clearInterval(state.authTimer);
      state.authTimer = setInterval(async () => {
        const status = await api('/api/status');
        if (status.connected) {
          clearInterval(state.authTimer);
          elements.dialog.close();
          toast('Microsoft Teams connecté');
          await refresh();
        }
      }, 2000);
    } catch (error) {
      elements.authContent.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    }
    return;
  }
  try {
    renderAuthFlow(await api('/api/auth/start', { method: 'POST' }));
    clearInterval(state.authTimer);
    state.authTimer = setInterval(async () => {
      const status = await api('/api/status');
      if (status.connected) {
        clearInterval(state.authTimer);
        elements.dialog.close();
        toast('Microsoft Teams connecté');
        await refresh();
      }
    }, 2500);
  } catch (error) {
    elements.authContent.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  setTimeout(() => elements.toast.classList.remove('visible'), 2600);
}

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.filter = button.dataset.filter;
    elements.title.textContent = button.querySelector('span').textContent;
    state.selectedId = null;
    renderList(); renderDetail(); updateCategoryActions();
  });
});
elements.sync.addEventListener('click', sync);
elements.connect.addEventListener('click', connect);
elements.markCategory.addEventListener('click', () => markCategoryTreated().catch((error) => toast(error.message)));

refresh().catch((error) => toast(error.message));
setInterval(() => refresh().catch(() => {}), 5000);
