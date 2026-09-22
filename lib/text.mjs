const COACH_WORDS = [
  'phishing', 'coach', 'campagne', 'campaign', 'simulation', 'nereus', 'néréus',
  'automation', 'automatisation', 'hameçonnage', 'addin', 'add-in', 'landing',
  'email', 'smtp', 'reported', 'signalement'
];

const ACADEMY_WORDS = [
  'academy', 'académie', 'formation', 'learning', 'module', 'parcours', 'emeraude',
  'émeraude', 'quiz', 'score', 'chapitre', 'lesson', 'cours', 'progression',
  'ulearning', 'my-academy', 'cyber-academy'
];

const QUESTION_WORDS = [
  'qui ', 'quoi ', 'quand ', 'comment ', 'pourquoi ', 'où ', 'quel', 'peux-tu',
  'pouvez-vous', 'est-ce', 'est ce', 'sais-tu', 'savez-vous', 'une idée',
  'vous avez', 'tu as', 'besoin de', 'possible de', 'problème', 'erreur',
  'bloqué', 'bloquée', 'help', 'how ', 'why ', 'what ', 'can you', 'could you'
];

const BUG_WORDS = [
  'bug', 'erreur', 'ne fonctionne', 'ne marche', 'cassé', 'casse', 'problème',
  'incident', 'régression', 'regression', 'impossible', 'bloqué', 'bloquée',
  'plantage', 'timeout', 'http 500', 'fixer le problème', 'pas jouable',
  'non jouable', 'inutilisable'
];

const BLOCKING_WORDS = [
  'bloquant', 'bloquante', 'bloqué', 'bloquée', 'impossible', 'indisponible',
  'ne peut plus', 'plus aucun', 'tous les utilisateurs', 'production à l’arrêt',
  'production a l’arrêt', 'urgent', 'pas jouable', 'non jouable', 'inutilisable',
  'pour certains utilisateurs', 'pour certains users', 'certains utilisateurs',
  'certains users', 'aucun utilisateur', 'aucun autre user', 'ne marche pour aucun',
  'ne fonctionne pour aucun'
];

const FUNCTION_WORDS = [
  'comment', 'fonctionnement', 'comportement', 'prévu', 'permet', 'possible',
  'où ', 'quel est', 'quelle est', 'peux-tu', 'pouvez-vous'
];

const BUSINESS_TAG_RULES = [
  { tag: 'autom', words: ['automation', 'automatisation', 'autom ', 'néréus', 'nereus'] },
  { tag: 'smart simu', words: ['smart simulation', 'smart simu', 'smart-simulation'] },
  { tag: 'chapitre', words: ['chapitre', 'chapter'] },
  { tag: 'jeu academy', words: ['emeraude', 'émeraude', 'jeu academy', 'academy game', 'my-academy'] },
  { tag: 'export csv', words: ['export csv', 'exportation csv', 'csv', 'export des'] }
];

export function htmlToText(html = '') {
  return String(html)
    .replace(/<at[^>]*>(.*?)<\/at>/gis, '@$1')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function isLikelyQuestion(text = '') {
  const normalized = ` ${text.toLocaleLowerCase('fr')} `;
  if (normalized.includes('?')) return true;
  return QUESTION_WORDS.some((word) => normalized.includes(` ${word}`));
}

export function classifyProject(text = '') {
  const normalized = text.toLocaleLowerCase('fr');
  const score = (words) => words.reduce((total, word) => total + (normalized.includes(word) ? 1 : 0), 0);
  const coach = score(COACH_WORDS);
  const academy = score(ACADEMY_WORDS);

  if (coach === academy) return { project: 'unknown', confidence: 0 };
  const winner = coach > academy ? 'coach' : 'academy';
  const high = Math.max(coach, academy);
  const low = Math.min(coach, academy);
  return {
    project: winner,
    confidence: Math.min(0.98, 0.58 + high * 0.12 - low * 0.08)
  };
}

/**
 * Local, token-free qualification of a support message.
 * The qualification is deliberately conservative: only explicit bug signals
 * are classified as bugs; otherwise a question about usage is a functional
 * question and the remaining messages stay unknown.
 */
export function classifySupportFeedback(text = '') {
  const normalized = ` ${text.toLocaleLowerCase('fr')} `;
  const hasBugSignal = BUG_WORDS.some((word) => normalized.includes(word));
  if (hasBugSignal) {
    const unusableApplication = /(jeu|application|fonctionnalité|feature)/.test(normalized)
      && /(cassé|casse|pas jouable|non jouable|inutilisable)/.test(normalized);
    return {
      supportType: 'bug',
      criticality: (unusableApplication || BLOCKING_WORDS.some((word) => normalized.includes(word)))
        ? 'bloquant' : 'genant'
    };
  }
  if (FUNCTION_WORDS.some((word) => normalized.includes(word)) || isLikelyQuestion(text)) {
    return { supportType: 'fonctionnement', criticality: null };
  }
  return { supportType: 'inconnu', criticality: null };
}

export function classifyMessage(text = '') {
  return {
    ...classifyProject(text),
    ...classifySupportFeedback(text),
    businessTags: classifyBusinessTags(text)
  };
}

export function classifyBusinessTags(text = '') {
  const normalized = text.toLocaleLowerCase('fr');
  return BUSINESS_TAG_RULES
    .filter(({ words }) => words.some((word) => normalized.includes(word)))
    .map(({ tag }) => tag);
}

export function normalizeGraphMessage(message, source) {
  const content = htmlToText(message?.body?.content || message?.subject || '');
  const fullText = `${message?.subject || ''}\n${content}`;
  const classification = classifyMessage(fullText);
  const threadId = message.replyToId || message.id;
  return {
    id: `${source.id}:${message.id}`,
    graphId: message.id,
    sourceId: source.id,
    sourceLabel: source.resolvedLabel || source.label,
    sourceUrl: source.url,
    webUrl: message.webUrl || source.url,
    threadId,
    groupId: `${source.id}:thread:${threadId}`,
    author: message?.from?.user?.displayName || message?.from?.application?.displayName || 'Microsoft Teams',
    createdAt: message.createdDateTime || new Date().toISOString(),
    updatedAt: message.lastModifiedDateTime || message.createdDateTime || new Date().toISOString(),
    subject: htmlToText(message.subject || ''),
    content,
    needsReply: isLikelyQuestion(content),
    project: classification.project,
    confidence: classification.confidence,
    supportType: classification.supportType,
    criticality: classification.criticality,
    businessTags: classification.businessTags,
    status: 'new',
    answer: '',
    evidence: [],
    error: null,
    isDemo: false
  };
}

const EPOCH_ID = /^\d{13}$/;

/**
 * Teams message identifiers are epoch milliseconds. They are more reliable than
 * the rendered <time> element, which disappears when Teams collapses consecutive
 * messages of the same author. Returns null when no reliable date exists so the
 * store can keep the previously known one instead of stamping the sync time.
 */
export function browserMessageDate(message = {}) {
  const rawId = String(message.id || '');
  if (EPOCH_ID.test(rawId)) {
    const fromId = Number(rawId);
    if (fromId > Date.UTC(2015, 0, 1) && fromId < Date.now() + 86_400_000) return new Date(fromId).toISOString();
  }
  const parsed = Date.parse(message.createdAt || '');
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function isGenericAuthor(author = '') {
  return !author || author === 'Microsoft Teams' || /^botcards_/i.test(author);
}

export function normalizeBrowserMessage(message, source) {
  const content = htmlToText(message.content || '');
  const classification = classifyMessage(content);
  const rawId = message.id || `${message.createdAt || ''}:${message.author || ''}:${content}`;
  const threadId = message.threadId || rawId;
  const createdAt = browserMessageDate(message);
  const author = isGenericAuthor(message.author) ? 'Microsoft Teams' : message.author;
  return {
    id: `${source.id}:${rawId}`,
    graphId: null,
    sourceId: source.id,
    sourceLabel: source.resolvedLabel || source.label,
    sourceUrl: source.url,
    webUrl: source.url,
    threadId,
    groupId: `${source.id}:thread:${threadId}`,
    author,
    createdAt,
    updatedAt: createdAt,
    subject: '',
    content,
    needsReply: isLikelyQuestion(content) && !(source.selfAuthors || []).includes(author),
    project: classification.project,
    confidence: classification.confidence,
    supportType: classification.supportType,
    criticality: classification.criticality,
    businessTags: classification.businessTags,
    status: 'new',
    answer: '',
    evidence: [],
    error: null,
    isDemo: false
  };
}
