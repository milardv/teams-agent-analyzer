import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserMessageDate, classifyProject, classifySupportFeedback, htmlToText, isLikelyQuestion,
  normalizeBrowserMessage, normalizeGraphMessage
} from '../lib/text.mjs';

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

test('qualifie localement le retour support sans appel modèle', () => {
  assert.deepEqual(
    classifySupportFeedback("Comment fonctionne le reset de progression ?"),
    { supportType: 'fonctionnement', criticality: null }
  );
  assert.deepEqual(
    classifySupportFeedback('Le jeu est bloqué pour tous les utilisateurs'),
    { supportType: 'bug', criticality: 'bloquant' }
  );
  assert.deepEqual(
    classifySupportFeedback('Le bouton affiche une erreur mais un contournement existe'),
    { supportType: 'bug', criticality: 'genant' }
  );
  assert.deepEqual(
    classifySupportFeedback("Le jeu Emeraude n'est pas jouable pour certains users"),
    { supportType: 'bug', criticality: 'bloquant' }
  );
});

test('normalise un message Graph', () => {
  const result = normalizeGraphMessage({
    id: '42', replyToId: 'root-7', createdDateTime: '2026-09-21T08:00:00Z', messageType: 'message',
    from: { user: { displayName: 'Ada' } }, body: { content: '<p>Pourquoi Emeraude bloque ?</p>' }
  }, { id: 'chat-1', label: 'Chat', url: 'https://teams.example' });
  assert.equal(result.id, 'chat-1:42');
  assert.equal(result.groupId, 'chat-1:thread:root-7');
  assert.equal(result.project, 'academy');
  assert.deepEqual(result.businessTags, ['jeu academy']);
  assert.equal(result.needsReply, true);
});

test('normalise un message lu dans le navigateur Teams', () => {
  const result = normalizeBrowserMessage({
    id: '99', author: 'Ada', createdAt: '2026-09-21T09:00:00Z',
    threadId: 'root-9', content: 'Pourquoi la campagne phishing est bloquée ?'
  }, { id: 'chat-1', label: 'Chat', url: 'https://teams.example' });
  assert.equal(result.id, 'chat-1:99');
  assert.equal(result.groupId, 'chat-1:thread:root-9');
  assert.equal(result.project, 'coach');
  assert.equal(result.needsReply, true);
});

test('déduit la date d’un message navigateur depuis son identifiant epoch', () => {
  assert.equal(browserMessageDate({ id: '1788443551035', createdAt: '' }), '2026-09-03T13:52:31.035Z');
  assert.equal(browserMessageDate({ id: '1788443551035', createdAt: '2026-09-22T08:16:58.016Z' }), '2026-09-03T13:52:31.035Z');
  assert.equal(browserMessageDate({ id: 'abc', createdAt: '2026-09-21T09:00:00Z' }), '2026-09-21T09:00:00.000Z');
  assert.equal(browserMessageDate({ id: 'abc', createdAt: '' }), null);
});

test('ne demande pas de réponse aux questions posées par soi-même', () => {
  const source = { id: 'chat-1', label: 'Chat', url: 'https://teams.example', selfAuthors: ['Moi'] };
  const mine = normalizeBrowserMessage({ id: '1788443551035', author: 'Moi', content: 'Tu peux vérifier la campagne ?' }, source);
  const theirs = normalizeBrowserMessage({ id: '1788443551036', author: 'Ada', content: 'Tu peux vérifier la campagne ?' }, source);
  assert.equal(mine.needsReply, false);
  assert.equal(theirs.needsReply, true);
  assert.equal(normalizeBrowserMessage({ id: '1788443551037', author: 'botcards_sent_on_behalf_of_user_display_name', content: 'x' }, source).author, 'Microsoft Teams');
});
