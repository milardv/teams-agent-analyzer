const state = {
  messages: [], status: null, stats: null, filter: 'todo', selectedId: null, authTimer: null,
  search: '', sort: localStorage.getItem('reply-board-sort') || 'priority',
  detailSignature: '', lastTodoCount: null, dailyGoal: 5
};

const elements = {
  list: document.querySelector('#message-list'), detail: document.querySelector('#detail-panel'),
  title: document.querySelector('#view-title'), sync: document.querySelector('#sync-button'),
  syncLabel: document.querySelector('#sync-label'), connect: document.querySelector('#connect-button'),
  markCategory: document.querySelector('#mark-category-button'),
  connection: document.querySelector('#connection-card'), connectionDetail: document.querySelector('#connection-detail'),
  demo: document.querySelector('#demo-notice'), error: document.querySelector('#error-notice'),
  dialog: document.querySelector('#auth-dialog'), authContent: document.querySelector('#auth-content'),
  toast: document.querySelector('#toast'), search: document.querySelector('#search-input'),
  sort: document.querySelector('#sort-button'), quest: document.querySelector('#quest-card'),
  help: document.querySelector('#help-dialog'), confetti: document.querySelector('#confetti')
};

const LEVELS = [
  [0, 'Stagiaire du support', '🌱'], [10, 'Apprenti répondeur', '🔧'], [30, 'Artisan des réponses', '🛠️'],
  [75, 'Maître du fil', '🧵'], [150, 'Sensei Teams', '🥋'], [300, 'Légende de la Taskforce', '🏆']
];

const EMPTY_MESSAGES = {
  todo: ['Inbox zéro. Le calme avant la prochaine question.', 'Rien à traiter. Un café ?', 'Tout est répondu. La Taskforce vous salue.'],
  default: ['Aucun message dans cette vue.', 'Rien ici pour le moment.']
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

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
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
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  return formatter.format(Math.round(days / 30), 'month');
}

function ageDays(value) {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function isSelf(author) {
  return (state.status?.selfAuthors || []).includes(author);
}

function projectLabel(project) {
  return project === 'coach' ? 'Coach' : project === 'academy' ? 'Academy' : 'À classer';
}

function supportLabel(message) {
  if (message.supportType === 'bug') {
    return `Bug · ${message.criticality === 'bloquant' ? 'Bloquant' : 'Gênant'}`;
  }
  if (message.supportType === 'fonctionnement') return 'Fonctionnement';
  return '';
}

function conversationTitle(chronological) {
  const source = chronological.find((message) => /TASK\s*FORCE\s+[A-Z]+-\d+/i.test(message.content || ''))
    || chronological.find((message) => message.subject?.trim())
    || chronological[0];
  const text = (source?.subject || source?.content || '').replace(/\s+/g, ' ').trim();
  const bracketTitle = text.match(/\[([^\]]+)\]\s*(.*?)(?:\s+🔗|$)/i)?.[2];
  let title = bracketTitle || text.replace(/^TASK\s*FORCE\s+[A-Z]+-\d+\s*\|[^|]*\|\s*/i, '');
  title = title.replace(/\s*Afficher dans Jira.*$/i, '').trim();
  return (title || 'Flux de conversation').slice(0, 86);
}

function buildGroups() {
  const grouped = new Map();
  for (const message of state.messages) {
    const id = message.groupId || `${message.sourceId}:thread:${message.id}`;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(message);
  }
  return [...grouped.entries()].map(([id, messages]) => {
    const chronological = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = chronological.at(-1);
    const projectCounts = new Map();
    for (const message of chronological) {
      if (['coach', 'academy'].includes(message.project)) {
        projectCounts.set(message.project, (projectCounts.get(message.project) || 0) + 1);
      }
    }
    const project = [...projectCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || latest.project || 'unknown';
    const statuses = chronological.map((message) => message.status);
    const status = statuses.every((value) => value === 'treated')
      ? 'treated'
      : statuses.every((value) => value === 'archived')
        ? 'archived'
        : statuses.includes('analyzing') ? 'analyzing'
          : statuses.includes('error') ? 'error'
            : chronological.some((message) => message.answer) ? 'ready' : latest.status;
    const tags = [...new Set(chronological.flatMap((message) => message.businessTags || []))];
    const supportType = chronological.some((message) => message.supportType === 'bug')
      ? 'bug'
      : chronological.some((message) => message.supportType === 'fonctionnement') ? 'fonctionnement' : 'inconnu';
    const criticality = supportType === 'bug' && chronological.some((message) => message.criticality === 'bloquant')
      ? 'bloquant' : supportType === 'bug' ? 'genant' : null;
    const lastSelfIndex = chronological.map((message) => isSelf(message.author)).lastIndexOf(true);
    const pendingQuestion = chronological.slice(lastSelfIndex + 1).find((message) => message.needsReply) || null;
    const open = chronological.some((message) => !['archived', 'treated'].includes(message.status));
    return {
      id, messages: chronological, latest, author: latest.author, content: latest.content,
      createdAt: latest.createdAt, sourceLabel: latest.sourceLabel, webUrl: latest.webUrl,
      title: conversationTitle(chronological),
      project, status, supportType, criticality, businessTags: tags,
      needsReply: Boolean(pendingQuestion),
      answeredBySelf: !pendingQuestion && chronological.some((message) => message.needsReply),
      pendingSince: pendingQuestion?.createdAt || null,
      open,
      messageCount: chronological.length,
      answerMessage: [...chronological].reverse().find((message) => message.answer) || null
    };
  });
}

function matchesSearch(group) {
  const needle = state.search.trim().toLocaleLowerCase('fr');
  if (!needle) return true;
  const haystack = [
    group.title, group.sourceLabel, ...group.businessTags,
    ...group.messages.flatMap((message) => [message.author, message.content])
  ].join('\n').toLocaleLowerCase('fr');
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

function filteredGroups() {
  return buildGroups().filter((group) => {
    if (state.filter === 'todo') return group.needsReply && group.open;
    if (state.filter === 'treated') return group.status === 'treated';
    if (state.filter === 'archived') return group.status === 'archived';
    if (state.filter === 'coach' || state.filter === 'academy') {
      return group.project === state.filter && group.status !== 'archived';
    }
    return group.status !== 'archived';
  }).filter(matchesSearch);
}

function selectedGroup() {
  return buildGroups().find((group) => group.id === state.selectedId);
}

function renderCounts() {
  const groups = buildGroups();
  const open = (group) => group.open;
  document.querySelector('#count-todo').textContent = groups.filter((g) => g.needsReply && open(g)).length;
  document.querySelector('#count-coach').textContent = groups.filter((g) => g.project === 'coach' && open(g)).length;
  document.querySelector('#count-academy').textContent = groups.filter((g) => g.project === 'academy' && open(g)).length;
  document.querySelector('#count-all').textContent = groups.filter(open).length;
  document.querySelector('#count-treated').textContent = groups.filter((g) => g.status === 'treated').length;
  document.querySelector('#count-archived').textContent = groups.filter((g) => g.status === 'archived').length;
}

function sortGroups(groups) {
  return [...groups].sort((a, b) => {
    if (state.sort === 'priority') {
      const priorityA = a.messages.some((message) => message.sourceId === 'taskforce-coach-aca') ? 1 : 0;
      const priorityB = b.messages.some((message) => message.sourceId === 'taskforce-coach-aca') ? 1 : 0;
      if (priorityB !== priorityA) return priorityB - priorityA;
    }
    if (state.sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function updateCategoryActions() {
  const groups = filteredGroups();
  const candidates = groups.filter((group) => group.open);
  elements.markCategory.hidden = state.filter === 'treated' || state.filter === 'archived';
  elements.markCategory.disabled = candidates.length === 0;
  elements.markCategory.textContent = candidates.length ? `Tout traiter (${candidates.length})` : 'Tout est traité';
  elements.sort.textContent = { priority: '⭐ Taskforce d’abord', newest: '🕒 Plus récents', oldest: '⏳ Plus anciens' }[state.sort];
}

function renderList() {
  const groups = sortGroups(filteredGroups());
  renderCounts();
  if (!groups.length) {
    const pool = state.search ? ['Aucun résultat pour cette recherche.'] : (EMPTY_MESSAGES[state.filter] || EMPTY_MESSAGES.default);
    const icon = state.filter === 'todo' && !state.search ? '🎉' : '🔎';
    elements.list.innerHTML = `<div class="empty-list"><span class="empty-list-icon">${icon}</span>${escapeHtml(pool[Math.floor(Date.now() / 60_000) % pool.length])}</div>`;
    return;
  }
  const scrollTop = elements.list.scrollTop;
  elements.list.innerHTML = groups.map((group) => {
    const age = group.pendingSince ? ageDays(group.pendingSince) : 0;
    const agePill = group.needsReply && group.open && age >= 1
      ? `<span class="badge age ${age >= 3 ? 'hot' : ''}" title="En attente depuis ${formatDate(group.pendingSince)}">⏳ ${plural(age, 'jour')}</span>` : '';
    return `
    <article class="message-card ${group.id === state.selectedId ? 'selected' : ''} ${group.status === 'treated' ? 'treated' : ''}" data-id="${escapeHtml(group.id)}">
      <button class="message-open" type="button" aria-label="Ouvrir le flux ${escapeHtml(group.title)}">
        <span class="message-top"><span class="message-author">${escapeHtml(group.title)}</span><span class="message-time" title="${escapeHtml(formatDate(group.createdAt))}">${relativeDate(group.createdAt)}</span></span>
        <span class="message-conversation">${escapeHtml(group.sourceLabel)} · ${plural(group.messageCount, 'message')}${group.answeredBySelf ? ' · ✅ répondu' : ''}</span>
        <span class="message-text"><strong>${escapeHtml(group.author)}</strong> : ${escapeHtml(group.content)}</span>
        <span class="message-meta">
          <span class="badge ${group.project}">${projectLabel(group.project)}</span>
          ${group.businessTags.map((tag) => `<span class="badge business-tag">${escapeHtml(tag)}</span>`).join('')}
          ${supportLabel(group) ? `<span class="badge support-${group.supportType}">${escapeHtml(supportLabel(group))}</span>` : ''}
          ${agePill}
          ${['analyzing', 'ready', 'error'].includes(group.status) ? `<span class="badge ${group.status}">${group.status === 'analyzing' ? 'Analyse…' : group.status === 'ready' ? 'Réponse prête' : 'Erreur'}</span>` : ''}
          ${group.status === 'treated' ? '<span class="badge treated-badge">Traité</span>' : ''}
        </span>
      </button>
      ${group.status !== 'archived' ? `<button class="message-treated" type="button" data-treated-id="${escapeHtml(group.id)}">${group.status === 'treated' ? '↶ Rouvrir' : '✓ Traité'}</button>` : ''}
    </article>`;
  }).join('');
  elements.list.scrollTop = scrollTop;
  elements.list.querySelectorAll('.message-card').forEach((card) => {
    card.querySelector('.message-open').addEventListener('click', () => selectMessage(card.dataset.id));
    card.querySelector('.message-treated')?.addEventListener('click', () => setGroupTreated(card.dataset.id));
  });
}

function detailSignature(group) {
  if (!group) return 'empty';
  return JSON.stringify(group.messages.map((message) => [
    message.id, message.status, message.answer, message.error, message.project, message.author, message.createdAt, message.evidence?.length
  ]));
}

function renderDetail({ force = false } = {}) {
  const group = selectedGroup();
  const signature = detailSignature(group);
  const editing = elements.detail.contains(document.activeElement) && document.activeElement.id === 'answer-text';
  if (!force && (signature === state.detailSignature || editing)) return;
  state.detailSignature = signature;
  if (!group) {
    elements.detail.className = 'detail empty';
    elements.detail.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">↗</div><h2>Sélectionnez un message</h2><p>La question, les preuves trouvées dans le code et la réponse proposée apparaîtront ici.</p><p class="hint">Astuce : <kbd>j</kbd>/<kbd>k</kbd> pour naviguer, <kbd>?</kbd> pour les raccourcis.</p></div>';
    return;
  }
  elements.detail.className = 'detail';
  const answerMessage = group.answerMessage || group.latest;
  const evidence = answerMessage.evidence?.length
    ? `<div class="evidence"><p class="section-label">Preuves dans le dépôt</p>${answerMessage.evidence.map((item) => `<div class="evidence-item"><code>${escapeHtml(item.path)}</code><span>${escapeHtml(item.reason)}</span></div>`).join('')}</div>`
    : '';
  const analysisState = group.status === 'analyzing'
    ? 'L’agent recherche dans le dépôt…'
    : answerMessage.error || (answerMessage.answer ? 'Réponse prête à relire' : 'Aucune analyse lancée');
  const thread = group.messages.map((message) => `
    <div class="thread-comment ${message === group.latest ? 'latest' : ''} ${isSelf(message.author) ? 'self' : ''} ${message.needsReply ? 'question' : ''}" id="msg-${escapeHtml(message.id)}">
      <div class="thread-comment-top"><strong>${escapeHtml(message.author)}${isSelf(message.author) ? ' (vous)' : ''}</strong><span title="${escapeHtml(formatDate(message.createdAt))}">${formatDate(message.createdAt)}</span></div>
      <div>${escapeHtml(message.content)}</div>
    </div>`).join('');
  elements.detail.innerHTML = `
    <div class="detail-header">
      <div><span class="badge ${group.project}">${projectLabel(group.project)}</span>${group.businessTags.map((tag) => `<span class="badge business-tag">${escapeHtml(tag)}</span>`).join('')}<h2>${escapeHtml(group.title)}</h2><p>${plural(group.messageCount, 'message')} · ${escapeHtml(group.sourceLabel)} · du ${formatDate(group.messages[0].createdAt)} au ${formatDate(group.createdAt)}</p></div>
      <a class="detail-link" href="${escapeHtml(group.webUrl || group.latest.sourceUrl)}" target="_blank" rel="noreferrer">Ouvrir dans Teams ↗</a>
    </div>
    ${supportLabel(group) ? `<p class="support-qualification"><span class="section-label">Qualification support</span><span class="badge support-${group.supportType}">${escapeHtml(supportLabel(group))}</span></p>` : ''}
    <div class="thread-comments" id="thread-comments">${thread}</div>
    <div class="detail-actions">
      <select class="project-select" id="project-select" aria-label="Projet à analyser">
        <option value="unknown" ${group.project === 'unknown' ? 'selected' : ''}>Choisir le projet…</option>
        <option value="coach" ${group.project === 'coach' ? 'selected' : ''}>Phishing Coach</option>
        <option value="academy" ${group.project === 'academy' ? 'selected' : ''}>Academy</option>
      </select>
      <button class="button" id="analyze-button" ${group.status === 'analyzing' ? 'disabled' : ''}>${answerMessage.answer ? 'Relancer l’analyse' : 'Analyser le flux'} <kbd>a</kbd></button>
      ${group.status !== 'archived' ? `<button class="button secondary" id="treated-button">${group.status === 'treated' ? '↶ Rouvrir' : 'Marquer traité'} <kbd>t</kbd></button>` : ''}
      <button class="button secondary" id="archive-button">${group.status === 'archived' ? 'Restaurer' : 'Archiver'}</button>
    </div>
    ${evidence}
    <p class="section-label" style="margin-top:22px">Réponse proposée</p>
    <div class="answer-box">
      <textarea id="answer-text" placeholder="La réponse de l’agent apparaîtra ici… ou rédigez la vôtre.">${escapeHtml(answerMessage.answer || '')}</textarea>
      <div class="answer-footer">
        <span class="answer-state">${escapeHtml(analysisState)}</span>
        <span class="answer-buttons">
          <button class="button secondary" id="copy-button" ${answerMessage.answer ? '' : 'disabled'}>Copier <kbd>c</kbd></button>
          <button class="button" id="copy-treat-button" ${answerMessage.answer && group.status !== 'treated' ? '' : 'disabled'}>Copier et traiter</button>
        </span>
      </div>
    </div>
  `;
  document.querySelector('#analyze-button').addEventListener('click', analyzeSelected);
  document.querySelector('#archive-button').addEventListener('click', toggleArchive);
  document.querySelector('#treated-button')?.addEventListener('click', () => setGroupTreated(group.id));
  document.querySelector('#copy-button').addEventListener('click', () => copyAnswer());
  document.querySelector('#copy-treat-button').addEventListener('click', () => copyAnswer({ treat: true }));
  document.querySelector('#project-select').addEventListener('change', updateProject);
  const textarea = document.querySelector('#answer-text');
  textarea.addEventListener('change', saveAnswer);
  textarea.addEventListener('input', () => {
    const hasText = textarea.value.trim().length > 0;
    document.querySelector('#copy-button').disabled = !hasText;
    document.querySelector('#copy-treat-button').disabled = !hasText || group.status === 'treated';
  });
  const comments = document.querySelector('#thread-comments');
  comments.scrollTop = comments.scrollHeight;
}

function selectMessage(id) {
  state.selectedId = id;
  renderList();
  renderDetail({ force: true });
}

function moveSelection(step) {
  const groups = sortGroups(filteredGroups());
  if (!groups.length) return;
  const index = groups.findIndex((group) => group.id === state.selectedId);
  const next = groups[Math.min(groups.length - 1, Math.max(0, index + step))] || groups[0];
  selectMessage(next.id);
  document.querySelector(`.message-card[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

async function analyzeSelected() {
  const group = selectedGroup();
  const message = [...(group?.messages || [])].reverse().find((item) => item.needsReply && item.status !== 'treated') || group?.latest;
  if (!message) return;
  const project = document.querySelector('#project-select').value;
  message.status = 'analyzing';
  message.error = null;
  renderList(); renderDetail();
  try {
    await api(`/api/messages/${encodeURIComponent(message.id)}/analyze`, { method: 'POST', body: JSON.stringify({ project }) });
    toast('🔍 Analyse lancée');
  } catch (error) {
    message.status = 'error'; message.error = error.message; renderDetail(); toast(error.message);
  }
}

async function updateProject(event) {
  const group = selectedGroup();
  if (!group) return;
  await Promise.all(group.messages.map(async (message) => {
    message.project = event.target.value;
    await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ project: message.project }) });
  }));
  renderList();
}

async function saveAnswer(event) {
  const group = selectedGroup();
  const message = group?.answerMessage || group?.latest;
  if (!message) return;
  message.answer = event.target.value;
  await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ answer: message.answer }) });
  toast('💾 Brouillon enregistré');
}

async function toggleArchive() {
  const group = selectedGroup();
  if (!group) return;
  const status = group.status === 'archived' ? 'new' : 'archived';
  await Promise.all(group.messages.map(async (message) => {
    await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    message.status = status;
  }));
  if (status === 'archived') state.selectedId = null;
  renderList(); renderDetail();
}

async function setGroupTreated(groupId) {
  const group = buildGroups().find((item) => item.id === groupId);
  if (!group) return;
  const status = group.open ? 'treated' : 'new';
  const todoBefore = buildGroups().filter((item) => item.needsReply && item.open).length;
  const result = await api('/api/messages/mark-treated', {
    method: 'POST', body: JSON.stringify({ groupId, status })
  });
  for (const message of group.messages) {
    message.status = status;
    message.processedAt = status === 'treated' ? new Date().toISOString() : null;
  }
  renderList(); renderDetail(); updateCategoryActions();
  toast(status === 'treated' ? `✅ ${plural(result.treated, 'message')} traité${result.treated > 1 ? 's' : ''}` : `↶ ${plural(result.treated, 'message')} rouvert${result.treated > 1 ? 's' : ''}`);
  if (status === 'treated') {
    const todoAfter = buildGroups().filter((item) => item.needsReply && item.open).length;
    if (todoBefore > 0 && todoAfter === 0) celebrate();
    void refreshStats();
  }
}

async function markCategoryTreated() {
  const category = ['todo', 'coach', 'academy', 'all'].includes(state.filter) ? state.filter : 'all';
  const result = await api('/api/messages/mark-treated', {
    method: 'POST', body: JSON.stringify({ category })
  });
  await refresh();
  toast(`✅ ${plural(result.treated, 'message')} marqué${result.treated > 1 ? 's' : ''} comme traité${result.treated > 1 ? 's' : ''}`);
  if (result.treated) celebrate();
}

async function copyAnswer({ treat = false } = {}) {
  const textarea = document.querySelector('#answer-text');
  if (!textarea?.value.trim()) return;
  await navigator.clipboard.writeText(textarea.value);
  const group = selectedGroup();
  if (group && textarea.value !== (group.answerMessage || group.latest).answer) await saveAnswer({ target: textarea });
  if (treat && group && group.open) {
    await setGroupTreated(group.id);
    toast('📋 Copiée et traitée. À coller dans Teams !');
  } else {
    toast('📋 Réponse copiée');
  }
}

function levelFor(total) {
  const index = LEVELS.findLastIndex(([threshold]) => total >= threshold);
  const [threshold, name, icon] = LEVELS[index];
  const next = LEVELS[index + 1];
  return { name, icon, progress: next ? (total - threshold) / (next[0] - threshold) : 1, next: next?.[0] ?? null };
}

function renderQuest() {
  const stats = state.stats;
  if (!stats) return;
  const level = levelFor(stats.treatedTotal);
  const goalRatio = Math.min(1, stats.treatedToday / state.dailyGoal);
  const max = Math.max(1, ...stats.week.map((day) => day.treated));
  const bars = stats.week.map((day) => {
    const label = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(day.day)).slice(0, 2);
    return `<span class="quest-bar" title="${escapeHtml(day.day)} · ${plural(day.treated, 'traité')}"><i style="height:${Math.round((day.treated / max) * 100)}%"></i><b>${label}</b></span>`;
  }).join('');
  const oldest = stats.oldestOpen ? ageDays(stats.oldestOpen) : 0;
  elements.quest.innerHTML = `
    <div class="quest-head"><span class="quest-icon">${level.icon}</span><div><strong>${escapeHtml(level.name)}</strong><span>${plural(stats.treatedTotal, 'réponse')} au total${level.next ? ` · niveau suivant à ${level.next}` : ''}</span></div></div>
    <div class="quest-level"><i style="width:${Math.round(level.progress * 100)}%"></i></div>
    <div class="quest-today"><span>Quête du jour</span><strong>${stats.treatedToday}/${state.dailyGoal} ${goalRatio >= 1 ? '🎯' : ''}</strong></div>
    <div class="quest-goal ${goalRatio >= 1 ? 'done' : ''}"><i style="width:${Math.round(goalRatio * 100)}%"></i></div>
    <div class="quest-week">${bars}</div>
    <div class="quest-footer"><span>🔥 ${plural(stats.streak, 'jour')} d’affilée</span>${oldest >= 2 ? `<span class="quest-warning">⏳ question de ${plural(oldest, 'jour')}</span>` : '<span>👌 rien ne traîne</span>'}</div>`;
}

function celebrate() {
  const canvas = elements.confetti;
  const context = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('active');
  const colors = ['#76e4c4', '#5746d7', '#0b7f72', '#f6a723', '#ff6b8a', '#ffffff'];
  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.4,
    size: 6 + Math.random() * 8, speed: 2.5 + Math.random() * 4, drift: (Math.random() - 0.5) * 2,
    rotation: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.25, color: colors[Math.floor(Math.random() * colors.length)]
  }));
  const started = performance.now();
  const frame = (now) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const piece of pieces) {
      piece.y += piece.speed; piece.x += piece.drift; piece.rotation += piece.spin;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (now - started < 2600) requestAnimationFrame(frame);
    else { context.clearRect(0, 0, canvas.width, canvas.height); canvas.classList.remove('active'); }
  };
  requestAnimationFrame(frame);
  toast('🎉 Inbox zéro ! Bravo.');
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
  elements.syncLabel.title = status.lastSyncAt ? formatDate(status.lastSyncAt) : '';
  const errors = [status.lastSyncError, ...Object.values(status.sourceErrors || {})].filter(Boolean);
  elements.error.hidden = !errors.length;
  elements.error.textContent = errors[0] || '';
}

async function refreshStats() {
  state.stats = await api('/api/stats');
  renderQuest();
}

async function refresh() {
  const selectedBefore = state.selectedId;
  const [status, inbox, stats] = await Promise.all([api('/api/status'), api('/api/messages'), api('/api/stats')]);
  state.status = status;
  state.messages = inbox.messages;
  state.stats = stats;
  if (selectedBefore && !buildGroups().some((group) => group.id === selectedBefore)) state.selectedId = null;
  const todoCount = buildGroups().filter((group) => group.needsReply && group.open).length;
  if (state.lastTodoCount !== null && todoCount > state.lastTodoCount) {
    toast(`📨 ${plural(todoCount - state.lastTodoCount, 'nouvelle question', 'nouvelles questions')}`);
    document.title = `(${todoCount}) Reply Board`;
  } else {
    document.title = todoCount ? `(${todoCount}) Reply Board` : 'Reply Board';
  }
  state.lastTodoCount = todoCount;
  renderStatus(); renderList(); renderDetail(); updateCategoryActions(); renderQuest();
}

async function sync() {
  elements.sync.disabled = true;
  elements.sync.textContent = 'Synchronisation…';
  try {
    const result = await api('/api/sync', { method: 'POST' });
    toast(result.imported ? `📥 ${plural(result.imported, 'nouveau message', 'nouveaux messages')}` : '✨ Rien de nouveau');
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

function waitForConnection(intervalMs) {
  clearInterval(state.authTimer);
  state.authTimer = setInterval(async () => {
    const status = await api('/api/status').catch(() => null);
    if (status?.connected) {
      clearInterval(state.authTimer);
      elements.dialog.close();
      toast('🔗 Microsoft Teams connecté');
      await refresh();
    }
  }, intervalMs);
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
  try {
    if (!state.status.clientConfigured) {
      elements.authContent.innerHTML = authSetupContent();
      await api('/api/browser/start', { method: 'POST' });
      waitForConnection(2000);
    } else {
      renderAuthFlow(await api('/api/auth/start', { method: 'POST' }));
      waitForConnection(2500);
    }
  } catch (error) {
    elements.authContent.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

let toastTimer = null;
function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2600);
}

function setFilter(filter) {
  const button = document.querySelector(`.filter[data-filter="${filter}"]`);
  if (!button) return;
  document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  state.filter = filter;
  elements.title.textContent = button.querySelector('span').textContent;
  state.selectedId = null;
  renderList(); renderDetail(); updateCategoryActions();
}

function cycleSort() {
  const order = ['priority', 'newest', 'oldest'];
  state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
  localStorage.setItem('reply-board-sort', state.sort);
  renderList(); updateCategoryActions();
}

function handleKeyboard(event) {
  const target = event.target;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  if (event.key === 'Escape' && typing) { target.blur(); return; }
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  const filters = ['todo', 'coach', 'academy', 'all', 'treated', 'archived'];
  switch (event.key) {
    case 'j': case 'ArrowDown': event.preventDefault(); moveSelection(1); break;
    case 'k': case 'ArrowUp': event.preventDefault(); moveSelection(-1); break;
    case 't': if (state.selectedId) void setGroupTreated(state.selectedId); break;
    case 'a': if (state.selectedId) void analyzeSelected(); break;
    case 'c': if (state.selectedId) void copyAnswer(); break;
    case 'o': { const group = selectedGroup(); if (group) window.open(group.webUrl || group.latest.sourceUrl, '_blank', 'noreferrer'); break; }
    case 's': void sync(); break;
    case '/': event.preventDefault(); elements.search.focus(); break;
    case 'Escape': state.selectedId = null; renderList(); renderDetail(); break;
    case '?': elements.help.showModal(); break;
    default:
      if (/^[1-6]$/.test(event.key)) setFilter(filters[Number(event.key) - 1]);
  }
}

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
});
elements.sync.addEventListener('click', sync);
elements.connect.addEventListener('click', connect);
elements.sort.addEventListener('click', cycleSort);
elements.markCategory.addEventListener('click', () => markCategoryTreated().catch((error) => toast(error.message)));
elements.search.addEventListener('input', () => { state.search = elements.search.value; renderList(); updateCategoryActions(); });
document.addEventListener('keydown', handleKeyboard);
document.querySelector('#help-button').addEventListener('click', () => elements.help.showModal());
document.querySelector('#quest-card').addEventListener('click', () => {
  const value = Number(prompt('Objectif de réponses par jour ?', String(state.dailyGoal)));
  if (value > 0) { state.dailyGoal = value; localStorage.setItem('reply-board-goal', String(value)); renderQuest(); }
});
state.dailyGoal = Number(localStorage.getItem('reply-board-goal')) || 5;

refresh().catch((error) => toast(error.message));
setInterval(() => refresh().catch(() => {}), 5000);
