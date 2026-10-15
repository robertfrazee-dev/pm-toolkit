// Matchbook's own read on places: how often groups swipe yes on them, send them to the final vote and pick them.
// Kept by Google place ID (the one piece of Google data that may be stored indefinitely) plus our own counts.
import { pipeline, hashToObject } from "./_lib.js";
import { CATEGORIES } from "./_places.js";
import { inManhattan } from "./_nyc.js";

const KEEP = 400 * 86400; // a place's lifetime counts
const BOARD_KEEP = 70 * 86400; // monthly area boards: this month and last are read
const CELL = 0.02; // about 2 km squares
const POINTS = { yes: 1, match: 3, win: 8 }; // what moves a place up its area's hot list
export const GID_RE = /^[A-Za-z0-9_-]{6,300}$/;

export const minSwipes = () => Number(process.env.HOT_MIN_SWIPES) || 20;
export const minGroups = () => Number(process.env.HOT_MIN_GROUPS) || 3;
export const cellOf = (lat, lng) => [Math.floor(lat / CELL), Math.floor(lng / CELL)];
export const month = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
export const boardKey = (cat, [x, y], m) => `hot:${cat}:${x}:${y}:${m}`;

// changes: [{ place, field, n }] with field one of seen, yes, groups, match, win (n may be negative after an undo).
export async function recordPlaces(deck, changes) {
  const cmds = [];
  for (const { place: p, field, n } of changes) {
    if (!n || !p?.gid || !GID_RE.test(p.gid)) continue;
    cmds.push(["HINCRBY", `place:${p.gid}`, field, n], ["EXPIRE", `place:${p.gid}`, KEEP]);
    // Manhattan places also feed the "Best of Manhattan" boards (matched to the list later, in boards.js).
    if (POINTS[field] && p.lat != null && inManhattan(p.lat, p.lng)) {
      cmds.push(["LPUSH", "nyc:queue", JSON.stringify({ name: p.name, lat: p.lat, lng: p.lng, kind: p.kind || "", field, n })], ["LTRIM", "nyc:queue", 0, 4999], ["EXPIRE", "nyc:queue", 2 * 86400]);
    }
    if (POINTS[field] && p.lat != null && p.lng != null) {
      const cell = cellOf(p.lat, p.lng), cat = CATEGORIES[deck.category] ? deck.category : CATEGORIES[p.cat] ? p.cat : null;
      for (const c of cat ? ["all", cat] : ["all"]) {
        const key = boardKey(c, cell, month());
        cmds.push(["ZINCRBY", key, POINTS[field] * n, p.gid], ["EXPIRE", key, BOARD_KEEP]);
      }
    }
  }
  if (!cmds.length) return;
  try { await pipeline(cmds); } catch (e) { console.error("hot", e); } // never let counting break a swipe
}

// What one person's swipe save changed, compared with their last save on this deck.
export function swipeChanges(deck, allSwipes, playerId, likes, passes) {
  const prev = allSwipes[playerId] || {};
  const was = { yes: new Set(prev.likes || []), no: new Set(prev.passes || []) };
  const now = { yes: new Set(likes), no: new Set(passes) };
  const others = Object.entries(allSwipes).filter(([id]) => id !== playerId).map(([, s]) => new Set([...(s.likes || []), ...(s.passes || [])]));
  const changes = [];
  for (const p of deck.places) {
    const seen = (now.yes.has(p.id) || now.no.has(p.id) ? 1 : 0) - (was.yes.has(p.id) || was.no.has(p.id) ? 1 : 0);
    const yes = (now.yes.has(p.id) ? 1 : 0) - (was.yes.has(p.id) ? 1 : 0);
    if (seen) changes.push({ place: p, field: "seen", n: seen });
    if (yes) changes.push({ place: p, field: "yes", n: yes });
    // The first person in a deck to decide on a place counts it as one more group that saw it.
    if (seen && !others.some((s) => s.has(p.id))) changes.push({ place: p, field: "groups", n: seen });
  }
  return changes;
}

// Lifetime counts for a set of places, plus whether each has enough swipes from enough groups to show.
export async function placeStats(gids) {
  const ids = [...new Set(gids.filter((g) => GID_RE.test(g)))].slice(0, 60);
  if (!ids.length) return {};
  const rows = await pipeline(ids.map((g) => ["HGETALL", `place:${g}`]));
  const out = {};
  ids.forEach((g, i) => {
    const r = Object.fromEntries(Object.entries(hashToObject(rows[i])).map(([k, v]) => [k, Number(v) || 0]));
    const seen = r.seen || 0, yes = r.yes || 0;
    if (seen < minSwipes() || (r.groups || 0) < minGroups()) return;
    const rate = Math.round((yes / seen) * 100);
    out[g] = { rate, groups: r.groups || 0, matches: r.match || 0, wins: r.win || 0, hot: rate >= 60 };
  });
  return out;
}

// The area's leaderboard: the 3×3 squares around a point, this month and last, highest points first.
export async function areaBoard(lat, lng, cat, limit = 25) {
  const [cx, cy] = cellOf(lat, lng), months = [month(), month(Date.now() - 31 * 86400 * 1000)];
  const keys = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const m of months) keys.push(boardKey(cat, [cx + dx, cy + dy], m));
  const rows = await pipeline(keys.map((k) => ["ZREVRANGE", k, 0, 29, "WITHSCORES"]));
  const score = {};
  for (const flat of rows) for (let i = 0; i + 1 < (flat || []).length; i += 2) score[flat[i]] = (score[flat[i]] || 0) + Number(flat[i + 1]);
  return Object.entries(score).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([gid, s]) => ({ gid, score: s }));
}

