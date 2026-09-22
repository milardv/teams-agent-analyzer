import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages } from '../lib/store.mjs';

test('actualise les métadonnées Teams sans écraser le brouillon', () => {
  const previous = {
    id: 'chat:1', author: 'Microsoft Teams', createdAt: '2026-09-21T10:00:00Z',
    content: 'Question', project: 'coach', confidence: 0.8, status: 'ready',
    answer: 'Réponse relue', evidence: [{ path: 'A.java', reason: 'preuve' }], error: null
  };
  const incoming = {
    ...previous, author: 'Ada', createdAt: '2026-09-18T08:00:00Z',
    project: 'unknown', confidence: 0, status: 'new', answer: '', evidence: []
  };
  const result = mergeMessages([previous], [incoming]).messages[0];
  assert.equal(result.author, 'Ada');
  assert.equal(result.createdAt, '2026-09-18T08:00:00Z');
  assert.equal(result.status, 'ready');
  assert.equal(result.answer, 'Réponse relue');
  assert.equal(result.project, 'coach');
});
