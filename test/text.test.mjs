import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProject, htmlToText, isLikelyQuestion, normalizeBrowserMessage, normalizeGraphMessage } from '../lib/text.mjs';

test('nettoie le HTML Teams et conserve les mentions', () => {
  assert.equal(htmlToText('<p>Bonjour <at id="0">Alice</at><br>Ça marche&nbsp;?</p>'), 'Bonjour @Alice\nÇa marche ?');
});

test('détecte les questions explicites et implicites', () => {
  assert.equal(isLikelyQuestion('Pourquoi la campagne ne part pas ?'), true);
  assert.equal(isLikelyQuestion('La livraison est terminée.'), false);
  assert.equal(isLikelyQuestion('Vous avez une idée pour ce bug'), true);
});

test('classe Coach et Academy par vocabulaire métier', () => {
  assert.equal(classifyProject('La campagne phishing Néréus est bloquée').project, 'coach');
  assert.equal(classifyProject('La progression du module Academy reste à zéro').project, 'academy');
  assert.equal(classifyProject('Peux-tu regarder ce souci ?').project, 'unknown');
});

test('normalise un message Graph', () => {
  const result = normalizeGraphMessage({
    id: '42', createdDateTime: '2026-09-21T08:00:00Z', messageType: 'message',
    from: { user: { displayName: 'Ada' } }, body: { content: '<p>Pourquoi Academy bloque ?</p>' }
  }, { id: 'chat-1', label: 'Chat', url: 'https://teams.example' });
  assert.equal(result.id, 'chat-1:42');
  assert.equal(result.project, 'academy');
  assert.equal(result.needsReply, true);
});

test('normalise un message lu dans le navigateur Teams', () => {
  const result = normalizeBrowserMessage({
    id: '99', author: 'Ada', createdAt: '2026-09-21T09:00:00Z',
    content: 'Pourquoi la campagne phishing est bloquée ?'
  }, { id: 'chat-1', label: 'Chat', url: 'https://teams.example' });
  assert.equal(result.id, 'chat-1:99');
  assert.equal(result.project, 'coach');
  assert.equal(result.needsReply, true);
});
