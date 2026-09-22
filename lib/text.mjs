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

export function normalizeGraphMessage(message, source) {
  const content = htmlToText(message?.body?.content || message?.subject || '');
  const classification = classifyProject(`${message?.subject || ''}\n${content}`);
  return {
    id: `${source.id}:${message.id}`,
    graphId: message.id,
    sourceId: source.id,
    sourceLabel: source.resolvedLabel || source.label,
    sourceUrl: source.url,
    webUrl: message.webUrl || source.url,
    author: message?.from?.user?.displayName || message?.from?.application?.displayName || 'Microsoft Teams',
    createdAt: message.createdDateTime || new Date().toISOString(),
    updatedAt: message.lastModifiedDateTime || message.createdDateTime || new Date().toISOString(),
    subject: htmlToText(message.subject || ''),
    content,
    needsReply: isLikelyQuestion(content),
    project: classification.project,
    confidence: classification.confidence,
    status: 'new',
    answer: '',
    evidence: [],
    error: null,
    isDemo: false
  };
}

export function normalizeBrowserMessage(message, source) {
  const content = htmlToText(message.content || '');
  const classification = classifyProject(content);
  const rawId = message.id || `${message.createdAt || ''}:${message.author || ''}:${content}`;
  const parsedDate = Date.parse(message.createdAt || '');
  return {
    id: `${source.id}:${rawId}`,
    graphId: null,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    webUrl: source.url,
    author: message.author || 'Microsoft Teams',
    createdAt: Number.isNaN(parsedDate) ? new Date().toISOString() : new Date(parsedDate).toISOString(),
    updatedAt: Number.isNaN(parsedDate) ? new Date().toISOString() : new Date(parsedDate).toISOString(),
    subject: '',
    content,
    needsReply: isLikelyQuestion(content),
    project: classification.project,
    confidence: classification.confidence,
    status: 'new',
    answer: '',
    evidence: [],
    error: null,
    isDemo: false
  };
}
