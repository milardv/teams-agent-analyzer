import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

export async function writeJson(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  await rename(temp, path);
  if (mode) await chmod(path, mode);
}

const GENERIC_AUTHOR = /^(Microsoft Teams|botcards_.*)$/i;

export function mergeMessages(existing, incoming, now = new Date().toISOString()) {
  const byId = new Map(existing.map((message) => [message.id, message]));
  const inserted = [];
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (previous) {
      const createdAt = message.createdAt || previous.createdAt || now;
      byId.set(message.id, {
        ...previous,
        ...message,
        createdAt,
        updatedAt: message.updatedAt || previous.updatedAt || createdAt,
        author: GENERIC_AUTHOR.test(message.author || '') && previous.author ? previous.author : message.author,
        project: previous.project === 'unknown' ? message.project : previous.project,
        confidence: Math.max(previous.confidence || 0, message.confidence || 0),
        status: previous.status,
        answer: previous.answer,
        evidence: previous.evidence,
        error: previous.error,
        processedAt: previous.processedAt ?? null,
        supportType: previous.supportType || message.supportType,
        criticality: previous.criticality || message.criticality,
        threadId: message.threadId || previous.threadId,
        groupId: message.groupId || previous.groupId,
        businessTags: previous.businessTags?.length ? previous.businessTags : message.businessTags
      });
    } else if (message.content) {
      const createdAt = message.createdAt || now;
      const stored = { ...message, createdAt, updatedAt: message.updatedAt || createdAt };
      byId.set(message.id, stored);
      inserted.push(stored);
    }
  }
  return {
    messages: [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    inserted
  };
}
