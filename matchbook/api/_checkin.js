// Check-ins: you're at a place (your phone's location says so), your crews get told, you earn points and keep a
// weekly streak, and everyone sees anonymous "N out here tonight" counts. Places come from Google (nearby search);
// Matchbook keeps only Google place IDs and its own counts.
import { redis, pipeline, hashToObject, bump, underDailyCap } from "./_lib.js";
import { getCrew, memberPids, personKey } from "./_crew.js";
import { pushToPlayers } from "./_push.js";
import { details, hoodOf } from "./_best.js";
import { track } from "./_events.js";

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
export const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 84300);

// Places around you, nearest first (Google nearby search). Kept in memory briefly so checking in doesn't search again.
const TYPES = ["restaurant", "bar", "cafe", "night_club", "bakery", "meal_takeaway", "bowling_alley", "museum", "park", "tourist_attraction", "movie_theater", "art_gallery"];
const near = new Map();
export async function nearby(lat, lng) {
  if (!(await underDailyCap("checkin_search", Number(process.env.CHECKIN_DAILY_LIMIT) || 1000))) return [];
  const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.primaryTypeDisplayName,places.shortFormattedAddress,places.photos,places.googleMapsUri" },
    body: JSON.stringify({ includedTypes: TYPES, maxResultCount: 20, rankPreference: "DISTANCE", locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: VERIFY_M } } }),
  });
  await bump("google_nearby");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("nearby", r.status, j.error?.message); return []; }
  const out = (j.places || []).filter((p) => p.location && p.displayName?.text).map((p) => {
    const place = { gid: p.id, name: p.displayName.text, kind: p.primaryTypeDisplayName?.text || "", address: p.shortFormattedAddress || "", maps: p.googleMapsUri || "", lat: p.location.latitude, lng: p.location.longitude, photo: p.photos?.[0]?.name || "", hood: hoodOf(p.location.latitude, p.location.longitude) };
    near.set(p.id, { at: Date.now(), place });
    return { ...place, m: Math.round(meters({ lat, lng }, place)) };
  });
  if (near.size > 3000) near.delete(near.keys().next().value);
  return out.filter((p) => p.m <= VERIFY_M).sort((a, b) => a.m - b.m);
}
async function placeOf(gid) {
  const hit = near.get(gid);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.place;
  return (await details([gid]))[gid] || null;
}

export async function myStats(pid) {
  const [h, top, log] = await pipeline([["HGETALL", `ci:me:${pid}`], ["ZREVRANGE", `ci:places:${pid}`, 0, 4, "WITHSCORES"], ["LRANGE", `ci:log:${pid}`, 0, 19]]);
  const s = Object.fromEntries(Object.entries(hashToObject(h)).map(([k, v]) => [k, Number(v) || 0]));
  const thisWeek = weekOf(nightOf());
  const recentRaw = (log || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter((x) => x?.gid);
  const topIds = []; for (let i = 0; i + 1 < (top || []).length; i += 2) topIds.push([top[i], Number(top[i + 1])]);
  const names = await details([...topIds.map(([g]) => g), ...recentRaw.map((x) => x.gid)]);
  return {
    points: s.points || 0, checkins: s.count || 0, spots: s.spots || 0, best: s.best || 0,
    streak: s.week >= thisWeek - 1 ? s.streak || 0 : 0, thisWeek: s.week === thisWeek,
    top: topIds.filter(([g]) => names[g]).map(([g, n]) => ({ ...names[g], n })),
    recent: recentRaw.filter((x) => names[x.gid]).map((x) => ({ ...names[x.gid], at: x.at, pts: x.pts })),
  };
}

// Where people are out tonight (only places with enough people, so nobody's singled out).
export async function tonight(limit = 50) {
  const flat = await redis("ZREVRANGE", `ci:hot:${nightOf()}`, 0, limit - 1, "WITHSCORES");
  const out = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) if (Number(flat[i + 1]) >= tonightMin()) out.push([flat[i], Number(flat[i + 1])]);
  return out;
}
export async function tonightCounts(gids) {
  if (!gids.length) return {};
  const night = nightOf();
  const rows = await pipeline(gids.map((id) => ["SCARD", `ci:tn:${night}:${id}`]));
  return Object.fromEntries(gids.map((id, i) => [id, Number(rows[i]) || 0]).filter(([, n]) => n >= tonightMin()));
}

export class CheckinError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

export async function checkIn({ pid, name, gid, lat, lng, tell = true }) {
  const p = await placeOf(gid);
  if (!p) throw new CheckinError("Couldn't find that place. Try again.", 404);
  const d = meters({ lat, lng }, p);
  if (d > VERIFY_M) throw new CheckinError(`You're about ${d < 1600 ? Math.round(d / 10) * 10 + " m" : (d / 1609).toFixed(1) + " mi"} from ${p.name}. Check in when you're there.`, 403);
  const night = nightOf(), week = weekOf(night);
  if ((await redis("SET", `ci:once:${pid}:${night}:${gid}`, "1", "EX", NIGHT_KEEP, "NX")) !== "OK") throw new CheckinError(`You already checked in at ${p.name} tonight.`, 409);
  const [n] = await pipeline([["INCR", `ci:n:${pid}:${night}`], ["EXPIRE", `ci:n:${pid}:${night}`, NIGHT_KEEP]]);
  if (Number(n) > PER_NIGHT) throw new CheckinError("That's a big night. Check-ins are capped for tonight.", 429);

  const tnKey = `ci:tn:${night}:${gid}`;
  const [visits, stRaw, here, crewIds] = await pipeline([["ZINCRBY", `ci:places:${pid}`, 1, gid], ["HGETALL", `ci:me:${pid}`], ["SMEMBERS", tnKey], ["SMEMBERS", `pcrews:${pid}`]]);
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
  const pk = personKey(name);
  const cmds = [
    ["HINCRBY", `ci:me:${pid}`, "points", pts], ["HINCRBY", `ci:me:${pid}`, "count", 1], ["HINCRBY", `ci:me:${pid}`, "spots", newSpot ? 1 : 0],
    ["HSET", `ci:me:${pid}`, "week", week, "streak", streak, "best", best], ["EXPIRE", `ci:me:${pid}`, KEEP], ["EXPIRE", `ci:places:${pid}`, KEEP],
    ["LPUSH", `ci:log:${pid}`, JSON.stringify({ gid, at: Date.now(), pts })], ["LTRIM", `ci:log:${pid}`, 0, 99], ["EXPIRE", `ci:log:${pid}`, KEEP],
    ["SADD", tnKey, pid], ["EXPIRE", tnKey, NIGHT_KEEP],
    ["ZINCRBY", "bx:grp", 2, gid], // a check-in is a small real-world vote on every list the place is on
  ];
  for (const cr of crews) {
    cmds.push(["LPUSH", `crew:${cr.id}:feed`, JSON.stringify({ k: pk, name, gid, at: Date.now() })], ["LTRIM", `crew:${cr.id}:feed`, 0, 49], ["EXPIRE", `crew:${cr.id}:feed`, KEEP]);
    cmds.push(["ZINCRBY", `crewci:${cr.id}:${monthOf(night)}`, pts, pk], ["EXPIRE", `crewci:${cr.id}:${monthOf(night)}`, MONTH_KEEP]);
  }
  await pipeline(cmds);
  const count = Number(await redis("SCARD", tnKey)) || 1;
  await pipeline([["ZADD", `ci:hot:${night}`, count, gid], ["EXPIRE", `ci:hot:${night}`, NIGHT_KEEP]]);

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
    await Promise.all([...byCrew].map(([cr, ids]) => pushToPlayers(ids, { title: cr.name, body: `📍 ${name} checked in at ${p.name}${p.hood ? ` in ${p.hood}` : ""}`, url: `/c/${cr.id}` })));
  }
  await bump("checkins");
  await track("checked_in", { pid, crew: crews[0]?.id || "" });
  return { place: p, pts, newSpot, linked: [...linked], streak, best, tonight: count >= tonightMin() ? count : null, told, stats: await myStats(pid) };
}

// What a crew's been up to: who's out (last two days), and who's out the most this month.
export async function crewActivity(crew) {
  const night = nightOf();
  const [feed, month] = await pipeline([["LRANGE", `crew:${crew.id}:feed`, 0, 29], ["ZREVRANGE", `crewci:${crew.id}:${monthOf(night)}`, 0, 9, "WITHSCORES"]]);
  const items = (feed || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter((x) => x?.gid && Date.now() - x.at < 48 * 3600e3).slice(0, 8);
  const names = await details(items.map((x) => x.gid));
  const out = items.filter((x) => names[x.gid]).map((x) => ({ name: crew.members[x.k]?.name || x.name, place: names[x.gid], at: x.at, tonight: nightOf(x.at) === night }));
  const leaders = []; for (let i = 0; i + 1 < (month || []).length; i += 2) leaders.push({ name: crew.members[month[i]]?.name || month[i], pts: Number(month[i + 1]) });
  return { feed: out, leaders };
}
