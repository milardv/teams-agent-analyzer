import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages } from '../lib/store.mjs';

test('actualise les métadonnées Teams sans écraser le brouillon', () => {
  const previous = {
    id: 'chat:1', author: 'Microsoft Teams', createdAt: '2026-09-21T10:00:00Z',
    content: 'Question', project: 'coach', confidence: 0.8, status: 'ready',
    answer: 'Réponse relue', evidence: [{ path: 'A.java', reason: 'preuve' }], error: null,
    supportType: 'bug', criticality: 'genant', threadId: 'root-1', groupId: 'chat:thread:root-1'
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
  assert.equal(result.supportType, 'bug');
  assert.equal(result.criticality, 'genant');
  assert.equal(result.groupId, 'chat:thread:root-1');
});

test('conserve la date et l’auteur connus quand Teams ne les rend plus', () => {
  const previous = {
    id: 'chat:2', author: 'Ada', createdAt: '2026-09-03T13:52:31.035Z', updatedAt: '2026-09-03T13:52:31.035Z',
    content: 'Question', project: 'unknown', status: 'new', answer: '', evidence: [], error: null
  };
  const incoming = { ...previous, author: 'Microsoft Teams', createdAt: null, updatedAt: null };
  const result = mergeMessages([previous], [incoming], '2026-09-22T11:00:00.000Z');
  assert.equal(result.messages[0].createdAt, '2026-09-03T13:52:31.035Z');
  assert.equal(result.messages[0].author, 'Ada');
  assert.equal(result.inserted.length, 0);
});

test('date un nouveau message sans horodatage à l’heure de synchro et trie du plus récent au plus ancien', () => {
  const now = '2026-09-22T11:00:00.000Z';
  const result = mergeMessages([], [
    { id: 'a', content: 'ancien', createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 'b', content: 'sans date', createdAt: null }
  ], now);
  assert.deepEqual(result.messages.map((message) => message.id), ['b', 'a']);
  assert.equal(result.messages[0].createdAt, now);
});
