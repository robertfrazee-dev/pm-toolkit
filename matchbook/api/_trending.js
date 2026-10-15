// Trending: what's actually happening on Matchbook, tonight and this week. Computed only from real activity:
// swipe yeses, places groups send to the final vote, group wins, and check-ins. Never ratings, never paid.
// Kept by Google place ID (allowed) plus Matchbook's own counts; coordinates kept 30 days (allowed) to sort by area.
import { pipeline, hashToObject } from "./_lib.js";
import { inManhattan, hoodOf, details } from "./_best.js";
import { cellOf, month, boardKey } from "./_hot.js";

export const POINTS = { yes: 1, match: 3, win: 8, checkin: 5 };
const N_KEEP = 3 * 86400, W_KEEP = 21 * 86400, LOC_KEEP = 30 * 86400;
const nyDate = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
export const nightOf = (t = Date.now()) => nyDate(t - 5 * 3600e3); // 5am to 5am New York time
export const weekOf = (night) => Math.floor((Date.parse(night + "T12:00:00Z") / 864e5 + 3) / 7);
const periods = () => { const n = nightOf(); return [[`tr:n:${n}`, N_KEEP], [`tr:w:${weekOf(n)}`, W_KEEP]]; };

// Redis commands that count one bit of activity on a place (n may be negative after an undo).
export function trendCmds(p, field, n = 1) {
  if (!POINTS[field] || !n || !p?.gid || !inManhattan(p.lat, p.lng)) return [];
  const hood = hoodOf(p.lat, p.lng), cmds = [["HSET", "tr:loc", p.gid, `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)},${hood}`], ["EXPIRE", "tr:loc", LOC_KEEP]];
  for (const [key, ttl] of periods()) {
    cmds.push(["ZINCRBY", key, POINTS[field] * n, p.gid], ["HINCRBY", `${key}:c`, `${p.gid}|${field}`, n], ["ZINCRBY", `${key}:h`, POINTS[field] * n, hood]);
    cmds.push(["EXPIRE", key, ttl], ["EXPIRE", `${key}:c`, ttl], ["EXPIRE", `${key}:h`, ttl]);
  }
  return cmds;
}

const pairs = (f) => { const o = []; for (let i = 0; i + 1 < (f || []).length; i += 2) o.push([f[i], Number(f[i + 1])]); return o; };
const MI = (a, b) => Math.hypot((a.lat - b.lat) * 69.05, (a.lng - b.lng) * 52.4);
// Manhattan's ~2 km squares, for this month's hot lists (already kept for every deck).
let cells; // built on first use (this module and _hot.js import each other)
const CELLS = () => { if (!cells) { cells = []; const [x0, y0] = cellOf(40.70, -74.02), [x1, y1] = cellOf(40.88, -73.90); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push([x, y]); } return cells; };

async function ranked(window) {
  if (window === "month") {
    const rows = await pipeline(CELLS().map((c) => ["ZREVRANGE", boardKey("all", c, month()), 0, 49, "WITHSCORES"]));
    const score = {}; for (const r of rows) for (const [g, s] of pairs(r)) score[g] = (score[g] || 0) + s;
    return { list: Object.entries(score).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 200), counts: null, hoodsKey: null };
  }
  const [key] = window === "week" ? periods()[1] : periods()[0];
  const [flat, counts, hoods] = await pipeline([["ZREVRANGE", key, 0, 199, "WITHSCORES"], ["HGETALL", `${key}:c`], ["ZREVRANGE", `${key}:h`, 0, 9, "WITHSCORES"]]);
  const c = {}; for (const [f, v] of Object.entries(hashToObject(counts))) { const i = f.lastIndexOf("|"); ((c[f.slice(0, i)] ||= {})[f.slice(i + 1)] = Number(v) || 0); }
  return { list: pairs(flat).filter(([, s]) => s > 0), counts: c, hoods: pairs(hoods).filter(([, s]) => s > 0) };
}

// The trending list for a window and a where ({kind, label, lat, lng, mi} from whereFrom).
export async function trending(window, where, { limit = 10, checkinMin = 2 } = {}) {
  const r = await ranked(window);
  if (!r.list.length) return { window, places: [], hoods: [] };
  const locRows = await pipeline([["HMGET", "tr:loc", ...r.list.map(([g]) => g)]]);
  const loc = {}; (locRows[0] || []).forEach((v, i) => { if (v) { const [lat, lng, hood] = String(v).split(","); loc[r.list[i][0]] = { lat: +lat, lng: +lng, hood }; } });
  // Places counted before coordinates were kept: look them up (names come from Google anyway).
  const missing = r.list.slice(0, 40).map(([g]) => g).filter((g) => !loc[g]);
  const found = missing.length ? await details(missing) : {};
  for (const [g, p] of Object.entries(found)) if (p.lat != null) loc[g] = { lat: p.lat, lng: p.lng, hood: hoodOf(p.lat, p.lng), manhattan: inManhattan(p.lat, p.lng) };
  const inWhere = (g) => {
    const l = loc[g]; if (!l || l.manhattan === false) return false;
    if (where.kind === "hood") return l.hood === where.label;
    if (where.lat != null) return MI(where, l) <= where.mi;
    return true;
  };
  const top = r.list.filter(([g]) => inWhere(g)).slice(0, limit);
  const names = await details(top.map(([g]) => g));
  // Lifetime counts for this month's view (the monthly lists keep points only).
  let life = {};
  if (window === "month" && top.length) { const rows = await pipeline(top.map(([g]) => ["HGETALL", `place:${g}`])); top.forEach(([g], i) => { life[g] = Object.fromEntries(Object.entries(hashToObject(rows[i])).map(([k, v]) => [k, Number(v) || 0])); }); }
  const places = top.filter(([g]) => names[g]).map(([g, pts]) => {
    const c = r.counts ? r.counts[g] || {} : life[g] || {};
    return { ...names[g], hood: loc[g]?.hood || names[g].hood, points: pts, yes: Math.max(0, c.yes || 0), match: Math.max(0, c.match || 0), win: Math.max(0, c.win || 0), checkin: (c.checkin || 0) >= checkinMin ? c.checkin : 0 };
  });
  // Hottest neighborhoods (tonight / this week), or worked out from the places (this month).
  let hoods = r.hoods || [];
  if (window === "month") { const h = {}; for (const [g, s] of r.list) if (loc[g]?.hood && loc[g].manhattan !== false) h[loc[g].hood] = (h[loc[g].hood] || 0) + s; hoods = Object.entries(h).sort((a, b) => b[1] - a[1]); }
  return { window, places, hoods: hoods.slice(0, 5).map(([hood, points]) => ({ hood, points })) };
}
