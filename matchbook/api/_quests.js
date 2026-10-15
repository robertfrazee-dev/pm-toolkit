// Quests: a crew takes on a list (a Top list snapshot, or its own list of places) and tries them together.
// Progress comes from crew check-ins; the quest's ranking is the crew's Tier It marks on those places
// (checked-in votes count double). Kept by Google place ID (allowed) plus Matchbook's own data.
import { redis, pipeline } from "./_lib.js";
import { memberPids } from "./_crew.js";

const KEEP = 400 * 86400;
const CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
export const QUEST_RE = /^[a-z0-9]{6}$/;
export const MAX_SPOTS = 30;
const key = (crew, id) => `quest:${crew}:${id}`;

export async function createQuest(crew, { slug, where, title, gids, by }) {
  let id = ""; for (let i = 0; i < 6; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
  const q = { id, crew: crew.id, slug, where, title, gids: [...new Set(gids)].slice(0, MAX_SPOTS), by, at: Date.now() };
  await pipeline([["SET", key(crew.id, id), JSON.stringify(q), "EX", KEEP], ["LPUSH", `crewquests:${crew.id}`, id], ["LTRIM", `crewquests:${crew.id}`, 0, 49], ["EXPIRE", `crewquests:${crew.id}`, KEEP]]);
  return q;
}
export async function getQuest(crewId, id) {
  if (!QUEST_RE.test(id || "")) return null;
  return JSON.parse((await redis("GET", key(crewId, id))) || "null");
}
export async function crewQuests(crewId) {
  const ids = (await redis("LRANGE", `crewquests:${crewId}`, 0, 19)) || [];
  if (!ids.length) return [];
  return (await pipeline(ids.map((id) => ["GET", key(crewId, id)]))).map((r) => (r ? JSON.parse(r) : null)).filter(Boolean);
}

// Who in the crew has checked in where: gid → [names]. A quest spot is "tried" once anyone in the crew checks in there.
export async function crewCheckins(crew) {
  const people = Object.values(crew.members);
  const pids = memberPids(crew);
  if (!pids.length) return {};
  const rows = await pipeline(pids.map((p) => ["ZRANGE", `ci:places:${p}`, 0, -1]));
  const nameOf = Object.fromEntries(people.flatMap((m) => m.pids.map((p) => [p, m.name])));
  const out = {};
  pids.forEach((p, i) => { for (const g of rows[i] || []) { const s = (out[g] ||= []); if (!s.includes(nameOf[p])) s.push(nameOf[p]); } });
  return out;
}
export function progressOf(q, tried) {
  const done = q.gids.filter((g) => tried[g]?.length);
  return { tried: done.length, total: q.gids.length };
}
