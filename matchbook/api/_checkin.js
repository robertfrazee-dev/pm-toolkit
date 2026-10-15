// Check-ins: you're at a place on the NYC list (your phone's location says so), your crews get told,
// you earn points and keep a weekly streak, and everyone sees anonymous "N out here tonight" counts.
import { redis, pipeline, hashToObject, bump } from "./_lib.js";
import { catalog, BOARDS, meters, kindLabel, mapsUrl } from "./_nyc.js";
import { getCrew, memberPids, personKey } from "./_crew.js";
import { pushToPlayers } from "./_push.js";

export const VERIFY_M = 250; // how close you have to be to check in
const PER_NIGHT = 12;
const NIGHT_KEEP = 36 * 3600, KEEP = 400 * 86400, MONTH_KEEP = 70 * 86400;
export const POINTS = { checkin: 10, newSpot: 10, linkUp: 5 };
export const tonightMin = () => Number(process.env.TONIGHT_MIN) || 2; // a place shows on "out tonight" from this many people

// A "night" runs 5am to 5am New York time, so 1am still counts as tonight.
const nyDate = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
export const nightOf = (t = Date.now()) => nyDate(t - 5 * 3600e3);
export const weekOf = (night) => Math.floor((Date.parse(night + "T12:00:00Z") / 864e5 + 3) / 7); // Monday to Sunday
const monthOf = (night) => night.slice(0, 7);

const brief = (p) => p && { id: p.id, name: p.n, hood: p.hood, borough: p.b || "", kind: kindLabel(p), maps: mapsUrl(p) };

export async function myStats(pid) {
  const [h, top, log] = await pipeline([["HGETALL", `ci:me:${pid}`], ["ZREVRANGE", `ci:places:${pid}`, 0, 4, "WITHSCORES"], ["LRANGE", `ci:log:${pid}`, 0, 19]]);
  const s = Object.fromEntries(Object.entries(hashToObject(h)).map(([k, v]) => [k, Number(v) || 0]));
  const thisWeek = weekOf(nightOf());
  const c = await catalog();
  const tops = []; for (let i = 0; i + 1 < (top || []).length; i += 2) { const p = c.byId.get(top[i]); if (p) tops.push({ ...brief(p), n: Number(top[i + 1]) }); }
  const recent = (log || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean).map((x) => ({ ...brief(c.byId.get(x.id)), at: x.at, pts: x.pts })).filter((x) => x.id);
  return {
    points: s.points || 0, checkins: s.count || 0, spots: s.spots || 0, best: s.best || 0,
    streak: s.week >= thisWeek - 1 ? s.streak || 0 : 0, thisWeek: s.week === thisWeek, top: tops, recent,
  };
}

// How many people are out at each place tonight (only places with enough people, so nobody's singled out).
export async function tonight(limit = 50) {
  const flat = await redis("ZREVRANGE", `ci:hot:${nightOf()}`, 0, limit - 1, "WITHSCORES");
  const out = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) if (Number(flat[i + 1]) >= tonightMin()) out.push([flat[i], Number(flat[i + 1])]);
  return out;
}
export async function tonightCounts(ids) {
  if (!ids.length) return {};
  const night = nightOf();
  const rows = await pipeline(ids.map((id) => ["SCARD", `ci:tn:${night}:${id}`]));
  return Object.fromEntries(ids.map((id, i) => [id, Number(rows[i]) || 0]).filter(([, n]) => n >= tonightMin()));
}

export class CheckinError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

export async function checkIn({ pid, name, placeId, lat, lng, tell = true }) {
  const c = await catalog(), p = c.byId.get(placeId);
  if (!p) throw new CheckinError("That place isn't on the list.", 404);
  const d = meters({ lat, lng }, p);
  if (d > VERIFY_M) throw new CheckinError(`You're about ${d < 1600 ? Math.round(d / 10) * 10 + " m" : (d / 1609).toFixed(1) + " mi"} from ${p.n}. Check in when you're there.`, 403);
  const night = nightOf(), week = weekOf(night);
  if ((await redis("SET", `ci:once:${pid}:${night}:${p.id}`, "1", "EX", NIGHT_KEEP, "NX")) !== "OK") throw new CheckinError(`You already checked in at ${p.n} tonight.`, 409);
  const [n] = await pipeline([["INCR", `ci:n:${pid}:${night}`], ["EXPIRE", `ci:n:${pid}:${night}`, NIGHT_KEEP]]);
  if (Number(n) > PER_NIGHT) throw new CheckinError("That's a big night. Check-ins are capped for tonight.", 429);

  const tnKey = `ci:tn:${night}:${p.id}`;
  const [visits, stRaw, here, crewIds] = await pipeline([
    ["ZINCRBY", `ci:places:${pid}`, 1, p.id], ["HGETALL", `ci:me:${pid}`], ["SMEMBERS", tnKey], ["SMEMBERS", `pcrews:${pid}`],
  ]);
  const newSpot = Number(visits) === 1;
  const crews = (await Promise.all((crewIds || []).slice(0, 8).map(getCrew))).filter(Boolean);
  // Same crew, same place, same night: you linked up.
  const mine = new Set([pid]);
  for (const cr of crews) for (const m of Object.values(cr.members)) if (m.pids.includes(pid)) m.pids.forEach((x) => mine.add(x));
  const hereSet = new Set(here || []), linked = new Set();
  for (const cr of crews) for (const m of Object.values(cr.members)) if (!m.pids.some((x) => mine.has(x)) && m.pids.some((x) => hereSet.has(x))) linked.add(m.name);
  const pts = POINTS.checkin + (newSpot ? POINTS.newSpot : 0) + (linked.size ? POINTS.linkUp : 0);

  // Weekly streak: at least one check-in every week.
  const st = Object.fromEntries(Object.entries(hashToObject(stRaw)).map(([k, v]) => [k, Number(v) || 0]));
  const streak = st.week === week ? st.streak || 1 : st.week === week - 1 ? (st.streak || 0) + 1 : 1;
  const best = Math.max(st.best || 0, streak);
  const pk = personKey(name), boards = BOARDS.filter((b) => b.test(p));
  const cmds = [
    ["HINCRBY", `ci:me:${pid}`, "points", pts], ["HINCRBY", `ci:me:${pid}`, "count", 1], ["HINCRBY", `ci:me:${pid}`, "spots", newSpot ? 1 : 0],
    ["HSET", `ci:me:${pid}`, "week", week, "streak", streak, "best", best], ["EXPIRE", `ci:me:${pid}`, KEEP], ["EXPIRE", `ci:places:${pid}`, KEEP],
    ["LPUSH", `ci:log:${pid}`, JSON.stringify({ id: p.id, at: Date.now(), pts })], ["LTRIM", `ci:log:${pid}`, 0, 99], ["EXPIRE", `ci:log:${pid}`, KEEP],
    ["SADD", tnKey, pid], ["EXPIRE", tnKey, NIGHT_KEEP],
    // A check-in is a real-world vote: a little credit on the city boards and a bit more on your crews' boards.
    ...boards.map((b) => ["ZINCRBY", `bd:${b.slug}:grp`, 2, p.id]),
  ];
  for (const cr of crews) {
    cmds.push(["LPUSH", `crew:${cr.id}:feed`, JSON.stringify({ k: pk, name, id: p.id, at: Date.now() })], ["LTRIM", `crew:${cr.id}:feed`, 0, 49], ["EXPIRE", `crew:${cr.id}:feed`, KEEP]);
    cmds.push(["ZINCRBY", `crewci:${cr.id}:${monthOf(night)}`, pts, pk], ["EXPIRE", `crewci:${cr.id}:${monthOf(night)}`, MONTH_KEEP]);
    for (const b of boards) cmds.push(["ZINCRBY", `crewbd:${cr.id}:${b.slug}`, 2, p.id], ["EXPIRE", `crewbd:${cr.id}:${b.slug}`, KEEP]);
  }
  await pipeline(cmds);
  const count = Number(await redis("SCARD", tnKey)) || 1;
  await redis("ZADD", `ci:hot:${night}`, count, p.id); await redis("EXPIRE", `ci:hot:${night}`, NIGHT_KEEP);

  // Tell the crews (one push per person even if you share several crews; not more than one every 15 minutes per crew).
  const told = [];
  if (tell) {
    const sendTo = new Map();
    for (const cr of crews) {
      if ((await redis("SET", `ci:push:${cr.id}:${pid}`, "1", "EX", 900, "NX")) !== "OK") continue;
      told.push(cr.name);
      for (const x of memberPids(cr)) if (!mine.has(x) && !sendTo.has(x)) sendTo.set(x, cr);
    }
    const byCrew = new Map();
    for (const [x, cr] of sendTo) (byCrew.get(cr) || byCrew.set(cr, []).get(cr)).push(x);
    await Promise.all([...byCrew].map(([cr, ids]) => pushToPlayers(ids, { title: cr.name, body: `📍 ${name} checked in at ${p.n}${p.hood ? ` in ${p.hood}` : ""}`, url: `/c/${cr.id}` })));
  }
  await bump("checkins");
  return { place: brief(p), pts, newSpot, linked: [...linked], streak, best, tonight: count >= tonightMin() ? count : null, told, stats: await myStats(pid) };
}

// What a crew's been up to: who's out tonight, and who's out the most this month.
export async function crewActivity(crew) {
  const night = nightOf();
  const [feed, month] = await pipeline([["LRANGE", `crew:${crew.id}:feed`, 0, 29], ["ZREVRANGE", `crewci:${crew.id}:${monthOf(night)}`, 0, 9, "WITHSCORES"]]);
  const c = await catalog();
  const items = (feed || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter((x) => x && Date.now() - x.at < 48 * 3600e3);
  const out = items.map((x) => ({ name: crew.members[x.k]?.name || x.name, place: brief(c.byId.get(x.id)), at: x.at, tonight: nightOf(x.at) === night })).filter((x) => x.place);
  const leaders = []; for (let i = 0; i + 1 < (month || []).length; i += 2) leaders.push({ name: crew.members[month[i]]?.name || month[i], pts: Number(month[i + 1]) });
  return { feed: out, leaders };
}
