// A plan is a whole night out: a few stops (dinner, then drinks...), each its own deck the same group swipes.
// POST /api/plan
//   { type: "create", stops: [{ cat, label }], title, dates, ...the composer's fields }  -> { code, id } for the first stop's deck
//   { type: "next", id, playerId, name, skip }  anyone once a stop has a winner (host may skip): deals the next stop near it
//   { type: "dates", id, playerId, name, picks } saves which of the suggested nights this person can do
//   { type: "lock", id, playerId, date }         host only: settles the night (date is an index, or -1 to reopen)
import { CATEGORIES } from "./_places.js";
import { readSearch, locate, buildDeck, searchAllowed, storeDeck, countHost } from "./deck.js";
import { winnerOf } from "./action.js";
import { pushToPlayers, deckPlayers } from "./_push.js";
import { TTL, PLAYER_RE, bump, redis, pipeline, hashToObject, send, body, allow, clientIp, missingConfig, cleanName } from "./_lib.js";

const PLAN_RE = /^[A-Z0-9]{8}$/;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_STOPS = 4, MAX_DATES = 5;
const NEAR_MI = 1; // later stops stay walkable from where the group just was
const STOP_LABEL = { restaurants: "Dinner", bars: "Drinks", coffee: "Coffee & brunch", activities: "Something fun", sights: "Sightseeing", outdoors: "Outdoors", music: "Live music", dessert: "Dessert" };

const fail = (status, message) => Object.assign(new Error(message), { status, friendly: message });
const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

// What later stops and the itinerary need to know about a stop's winner.
const keep = (p) => p && {
  id: p.id, name: p.name, kind: p.kind || "", address: p.address || "", lat: p.lat ?? null, lng: p.lng ?? null, maps: p.maps || "",
  website: p.website || "", phone: p.phone || "", photo: p.photo || "", rating: p.rating ?? null, price: p.price || "", cat: p.cat || "",
};

async function create(req, res, b) {
  const stops = (Array.isArray(b.stops) ? b.stops : []).slice(0, MAX_STOPS)
    .filter((s) => CATEGORIES[s?.cat])
    .map((s) => ({ cat: s.cat, label: text(s.label, 24) || STOP_LABEL[s.cat] }));
  if (stops.length < 2) throw fail(400, "A night out needs at least two stops.");
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const dates = [...new Set((Array.isArray(b.dates) ? b.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= yesterday))].sort().slice(0, MAX_DATES);
  const q = readSearch({ ...b, category: stops[0].cat, mood: "" });
  const title = text(b.title, 40) || stops.map((s) => s.label).join(" + ");
  await searchAllowed(req);
  const where = await locate(q);
  const deck = await buildDeck(q, where);

  let id = "";
  for (let i = 0; i < 8; i++) id += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  const code = await storeDeck({ ...deck, label: stops[0].label, plan: { id, stop: 0 }, planTitle: title });
  const plan = {
    id, title, hostId: q.hostId, createdAt: Date.now(), center: where.center, area: where.areaLabel,
    filters: { radius: q.radius, count: q.count, maxPrice: q.maxPrice, openNow: q.openNow },
    stops: stops.map((s, i) => ({ ...s, code: i ? null : code, winner: null })),
    dates, date: dates.length === 1 ? dates[0] : null,
  };
  await redis("SET", `plan:${id}`, JSON.stringify(plan), "EX", TTL);
  await bump("plans"); await bump("decks_google"); await countHost(q.hostId);
  return send(res, 201, { code, id });
}

async function loadPlan(id) {
  if (!PLAN_RE.test(id)) throw fail(400, "Bad plan.");
  const raw = await redis("GET", `plan:${id}`);
  if (!raw) throw fail(404, "This plan has expired.");
  return JSON.parse(raw);
}

async function next(req, res, b, playerId, name) {
  const plan = await loadPlan(b.id);
  const i = plan.stops.findLastIndex((s) => s.code);
  if (i < 0 || i >= plan.stops.length - 1) throw fail(409, "That was the last stop.");
  const cur = plan.stops[i], upcoming = plan.stops[i + 1];

  const [raw, ranksFlat] = await pipeline([["GET", `deck:${cur.code}`], ["HGETALL", `deck:${cur.code}:ranks`]]);
  if (!raw) throw fail(404, "The last stop's deck has expired.");
  const deck = JSON.parse(raw);
  const decided = deck.phase === "done" || deck.announced;
  const isHost = !plan.hostId || plan.hostId === playerId;
  if (!decided && !(b.skip && isHost)) throw fail(409, `Pick a winner for ${cur.label.toLowerCase()} first.`);
  const top = decided ? winnerOf(deck, Object.values(hashToObject(ranksFlat))) : null;
  const winner = top ? keep({ ...top, cat: top.cat || deck.category }) : null;

  // Several phones can ask at once; one of them deals, the rest pick up the code on their next refresh.
  const lock = await redis("SET", `plan:${plan.id}:next:${i}`, playerId, "EX", 60, "NX");
  if (lock !== "OK") return send(res, 202, { pending: true });
  try {
    await searchAllowed(req);
    // Search around the last winner (or wherever the night started) so the group isn't crossing town.
    const prev = plan.stops.slice(0, i + 1).reverse().find((s) => s.winner?.lat != null)?.winner;
    const anchor = winner?.lat != null ? winner : prev;
    const center = anchor ? { latitude: anchor.lat, longitude: anchor.lng } : plan.center;
    const areaLabel = anchor ? anchor.name : plan.area;
    const q = { ...plan.filters, cat: upcoming.cat, mood: "", hostId: plan.hostId, radius: anchor ? Math.min(NEAR_MI, plan.filters.radius) : plan.filters.radius };
    let built;
    try { built = await buildDeck(q, { center, areaLabel }); }
    catch (e) {
      // Nothing that close: widen to the night's original radius before giving up.
      if (e.status !== 404 || q.radius >= Math.max(plan.filters.radius, 3)) throw e;
      built = await buildDeck({ ...q, radius: Math.max(plan.filters.radius, 3) }, { center, areaLabel });
    }
    const code = await storeDeck({ ...built, label: upcoming.label, plan: { id: plan.id, stop: i + 1 }, planTitle: plan.title, near: anchor ? anchor.name : "" });
    plan.stops[i] = { ...cur, winner, skipped: !decided };
    plan.stops[i + 1] = { ...upcoming, code };
    await redis("SET", `plan:${plan.id}`, JSON.stringify(plan), "KEEPTTL");
    await bump("plan_stops"); await bump("decks_google");
    const others = (await deckPlayers(cur.code)).filter((pid) => pid !== playerId);
    await pushToPlayers(others, { title: `Next up: ${upcoming.label.toLowerCase()}`, body: anchor ? `${name} dealt places near ${anchor.name}. Start swiping.` : `${name} dealt the next deck. Start swiping.`, code });
    return send(res, 201, { code });
  } catch (e) {
    await redis("DEL", `plan:${plan.id}:next:${i}`).catch(() => {});
    throw e;
  }
}

async function dates(res, b, playerId, name) {
  const plan = await loadPlan(b.id);
  const picks = [...new Set((Array.isArray(b.picks) ? b.picks : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < plan.dates.length))];
  await pipeline([["HSET", `plan:${plan.id}:dates`, playerId, JSON.stringify({ name, picks, at: Date.now() })], ["EXPIRE", `plan:${plan.id}:dates`, TTL]]);
  return send(res, 200, { ok: true, picks });
}

async function lock(res, b, playerId) {
  const plan = await loadPlan(b.id);
  if (plan.hostId && plan.hostId !== playerId) throw fail(403, "Only the person who started this plan can lock the night.");
  const idx = Math.round(Number(b.date));
  const date = idx >= 0 && idx < plan.dates.length ? plan.dates[idx] : null;
  await redis("SET", `plan:${plan.id}`, JSON.stringify({ ...plan, date }), "KEEPTTL");
  if (date && date !== plan.date) {
    const day = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    const code = plan.stops.findLast((s) => s.code)?.code;
    const players = new Set();
    for (const s of plan.stops.filter((x) => x.code)) for (const pid of await deckPlayers(s.code)) players.add(pid);
    players.delete(playerId);
    if (code) await pushToPlayers([...players], { title: `${plan.title}: it's on`, body: `${day}. See you there.`, code });
  }
  return send(res, 200, { ok: true, date });
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    if (b.type === "create") return await create(req, res, b);
    const playerId = String(b.playerId || "");
    if (!PLAYER_RE.test(playerId)) return send(res, 400, { error: "Bad player." });
    if (!(await allow(`rl:plan:${clientIp(req)}`, 300, 600))) return send(res, 429, { error: "Slow down a little and try again." });
    const name = cleanName(b.name) || "Someone";
    if (b.type === "next") return await next(req, res, b, playerId, name);
    if (b.type === "dates") return await dates(res, b, playerId, name);
    if (b.type === "lock") return await lock(res, b, playerId);
    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 502, { error: e.friendly || "Something went wrong on our end. Try again in a minute." });
  }
}
