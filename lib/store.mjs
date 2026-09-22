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

export function mergeMessages(existing, incoming) {
  const byId = new Map(existing.map((message) => [message.id, message]));
  const inserted = [];
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (previous) {
      byId.set(message.id, {
        ...previous,
        ...message,
        project: previous.project === 'unknown' ? message.project : previous.project,
        confidence: Math.max(previous.confidence || 0, message.confidence || 0),
        status: previous.status,
        answer: previous.answer,
        evidence: previous.evidence,
        error: previous.error
      });
    } else if (message.content) {
      byId.set(message.id, message);
      inserted.push(message);
    }
  }
  return {
    messages: [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    inserted
  };
}
