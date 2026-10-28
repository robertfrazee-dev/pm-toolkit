// GET  /api/deck?code=ABCDE  -> the deck plus everyone's swipes and rankings
// POST /api/deck             -> look up places with Google and start a new deck
import { parseMood } from "./_mood.js";
import { track } from "./_events.js";
import { CATEGORIES, PRICE_LEVELS, CHAINS, google, shape, findPlaces } from "./_places.js";
export { CATEGORIES };
import { timerDue, tickDeck } from "./action.js";
import { scheduleTimer } from "./_schedule.js";
import { CREW_RE, getCrew, saveCrew, memberPids } from "./_crew.js";
import { pushToPlayers } from "./_push.js";
import { TTL, CODE_RE, PLAYER_RE, bump, underDailyCap, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig } from "./_lib.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

async function create(req, res) {
  const b = body(req);
  if (Array.isArray(b.saved)) return createFromSaved(req, res, b);
  const radius = Math.min(Math.max(Number(b.radiusMi) || 3, 0.5), 25);
  const count = Math.min(Math.max(Math.round(Number(b.count) || 15), 5), 40);
  const cat = CATEGORIES[b.category] ? b.category : "any";
  // A sentence like "cheap wings at a sports bar in Hoboken" becomes the search, the area and the filters.
  // With a category chip it narrows that category; with "Anything" it is the whole search.
  const raw = String(b.mood ?? b.custom ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const parsed = parseMood(raw);
  const mood = (parsed.query || raw).slice(0, 80);
  if (cat === "any" && !mood) return send(res, 400, { error: "Type what you're in the mood for, or pick a kind of place." });

  if (!(await allow(`rl:create:${clientIp(req)}`, 20, 3600))) {
    return send(res, 429, { error: "Too many new decks from this connection. Try again in an hour." });
  }
  // Every Google-backed deck costs money, so there's a ceiling per day (DAILY_DECK_LIMIT, default 300).
  if (!(await underDailyCap("decks", Number(process.env.DAILY_DECK_LIMIT) || 300))) {
    return send(res, 503, { error: "Matchbook hit its limit for new searches today. Try again tomorrow, or swipe your saved places." });
  }

  // Where to search: the phone's location, or the place the person typed.
  let center, areaLabel;
  const lat = Number(b.lat), lng = Number(b.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && b.lat !== null && b.lng !== null) {
    // Round to about 100 m: plenty for a search radius, and we don't keep anyone's exact position.
    center = { latitude: Math.round(lat * 1000) / 1000, longitude: Math.round(lng * 1000) / 1000 };
    areaLabel = String(b.areaLabel || "your location").slice(0, 80);
  } else {
    const area = (String(b.area || "").trim() || parsed.area).slice(0, 120);
    if (!area) return send(res, 400, { error: "Where should we look? Add a neighborhood or city (or say \"in Hoboken\"), or tap Near me." });
    const found = await google({ textQuery: area, pageSize: 1 });
    const hit = found.places?.[0];
    if (!hit?.location) return send(res, 404, { error: `Couldn't find "${area}" on the map. Try adding the city or state.` });
    center = hit.location;
    areaLabel = area;
  }

  const when = parseWhen(b);
  const textQuery = cat === "any" ? mood : mood ? `${mood} ${CATEGORIES[cat].query}` : CATEGORIES[cat].query;
  const maxPrice = Math.round(Number(b.maxPrice) || parsed.maxPrice || 0);
  // Kept with the deck so "Deal 10 more" can run the same search again.
  const search = {
    textQuery, center, radius, openNow: !when && !!(b.openNow || parsed.openNow), when: when ? { day: when.day, min: when.min } : undefined,
    priceLevels: maxPrice >= 1 && maxPrice <= 4 ? PRICE_LEVELS.slice(0, maxPrice) : [],
    skipChains: !CHAINS.test(mood),
  };
  const kept = await findPlaces(search, { want: count });
  if (!kept.length) return send(res, 404, { error: "Google found nothing that fits. Try a bigger radius or turn off filters." });

  const places = kept.map((p, i) => shape(p, i, center));
  const deck = {
    category: cat, mood, label: mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : CATEGORIES[cat].label,
    area: areaLabel, radius, center, places, phase: "swiping", matches: [], createdAt: Date.now(), search, deals: 0, when: when || undefined,
    hostId: PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null,
  };
  await bump("decks_google");
  return saveDeck(res, withTimers(deck, b));
}

// When the group is going: the phone sends its local weekday and minute (the places' hours are local too),
// the moment itself, and a label like "Tonight 9pm". Up to two weeks out.
function parseWhen(b) {
  const day = Math.round(Number(b.whenDay)), min = Math.round(Number(b.whenMin)), at = Number(b.whenAt);
  if (b.whenDay == null || b.whenDay === "" || !(day >= 0 && day <= 6 && min >= 0 && min < 1440) || !Number.isFinite(at)) return null;
  if (at < Date.now() - 3 * 3600e3 || at > Date.now() + 14 * 864e5) return null;
  return { day, min, at, label: text(b.whenLabel, 30) || "Later" };
}

// The host's timers: how long swiping stays open (starts now) and how long ranking gets once it starts.
const MINUTES = [0, 2, 5, 10, 15, 30, 60];
function withTimers(deck, b) {
  const pick = (v, d) => (MINUTES.includes(Math.round(Number(v))) ? Math.round(Number(v)) : d);
  const swipeMinutes = pick(b.swipeMinutes, 0), rankMinutes = pick(b.rankMinutes, 5);
  return { ...deck, swipeMinutes, rankMinutes, swipeEndsAt: swipeMinutes ? Date.now() + swipeMinutes * 60e3 : null, warned: {}, crew: CREW_RE.test(String(b.crewId || "")) ? b.crewId : undefined };
}

// A deck started for a crew: it's the crew's live deck, and everyone in the crew gets the link pushed to them.
async function announceCrewDeck(deck, code) {
  try {
    const crew = await getCrew(deck.crew); if (!crew) return;
    crew.liveCode = code; crew.lastAt = Date.now();
    await saveCrew(crew);
    const host = Object.values(crew.members).find((m) => m.pids.includes(deck.hostId))?.name || "Someone";
    const where = deck.category === "saved" ? "" : deck.area === "you" ? " nearby" : ` near ${deck.area}`;
    await pushToPlayers(memberPids(crew).filter((p) => p !== deck.hostId), { title: `${crew.name}: new deck 🔥`, body: `${host} wants to pick ${deck.label.toLowerCase()}${where}. Start swiping.`, code });
  } catch (e) { console.error("crew deck", e); }
}

async function saveDeck(res, deck) {
  for (let tries = 0; tries < 5; tries++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const ok = await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, code }), "EX", TTL, "NX");
    if (ok === "OK") {
      await track("session_created", { pid: deck.hostId || "", code, crew: deck.crew || "" });
      if (deck.swipeEndsAt) await scheduleTimer(code, deck.swipeEndsAt);
      if (deck.crew) await announceCrewDeck(deck, code);
      return send(res, 201, { code });
    }
  }
  return send(res, 500, { error: "Couldn't save the deck. Try again." });
}

// A deck made from someone's saved places: no Google search, so it costs nothing.
// The places come from the phone, so keep only plain text and https links.
const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const https = (v) => (/^https:\/\/[^\s"'<>]+$/i.test(String(v || "")) ? String(v).slice(0, 500) : "");
const coord = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi && v !== null && v !== "" ? Math.round(+v * 1e5) / 1e5 : null);

async function createFromSaved(req, res, b) {
  const seen = new Set();
  const places = b.saved.slice(0, 40).map((f) => ({
    gid: text(f?.gid, 200), name: text(f?.name, 80), kind: text(f?.kind, 40), address: text(f?.address, 100),
    price: /^\${1,4}$/.test(f?.price) ? f.price : "", maps: https(f?.maps), website: https(f?.website),
    phone: text(f?.phone, 30).replace(/[^\d+()\-. ]/g, ""), lat: coord(f?.lat, -90, 90), lng: coord(f?.lng, -180, 180),
    cat: CATEGORIES[f?.category] ? f.category : "", rating: null, ratings: 0, summary: "", openNow: null, photo: "", photoBy: "", distance: null,
  })).filter((p) => p.name && !seen.has(p.gid || p.name) && seen.add(p.gid || p.name)).map((p, i) => ({ id: "p" + (i + 1), ...p }));
  if (places.length < 2) return send(res, 400, { error: "Save at least two places to swipe on them." });
  if (!(await allow(`rl:create:${clientIp(req)}`, 20, 3600))) return send(res, 429, { error: "Too many new decks from this connection. Try again in an hour." });
  const pts = places.filter((p) => p.lat != null);
  const center = pts.length ? { latitude: pts.reduce((a, p) => a + p.lat, 0) / pts.length, longitude: pts.reduce((a, p) => a + p.lng, 0) / pts.length } : null;
  await bump("decks_saved");
  // The same kind of deck can come from the hot list; it's labeled for where it came from.
  const hot = b.source === "hot" || b.source === "board", near = text(b.area, 60);
  return saveDeck(res, withTimers({
    category: "saved", mood: "", label: b.source === "quest" ? text(b.label, 60) || "Our quest" : b.source === "board" ? text(b.label, 60) || "Best of Manhattan" : hot ? text(b.label, 60) || (near ? `Hot near ${near}` : "Hot nearby") : "Our saved places", area: b.source === "quest" ? "a crew quest" : b.source === "board" ? "Best of Manhattan" : hot ? "the hot list" : "your saved list", radius: 0, center, places,
    phase: "swiping", matches: [], createdAt: Date.now(), hostId: PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null, when: parseWhen(b) || undefined,
  }, b));
}

// Affiliate IDs are public by nature (they end up in links), so the page gets them with the deck.
// Leave them unset to send people to the booking sites without a partner tag.
function bookingConfig() {
  return {
    opentableWrap: process.env.OPENTABLE_LINK_TEMPLATE || "", // e.g. an affiliate network link with {url} where the OpenTable URL goes
    viatorPid: process.env.VIATOR_PID || "",
    viatorMcid: process.env.VIATOR_MCID || "",
  };
}

async function read(req, res) {
  const code = String(req.query?.code || new URL(req.url, "http://x").searchParams.get("code") || "").toUpperCase();
  if (!CODE_RE.test(code)) return send(res, 400, { error: "Deck codes are 5 letters and numbers." });
  const q = new URL(req.url, "http://x").searchParams;
  // Phones say they're here every so often, so the group can tell "ranking now" from "hasn't opened it".
  const me = q.get("me") || "", view = q.get("v") || "";
  if (PLAYER_RE.test(me) && /^[a-z]{2,10}$/.test(view)) await pipeline([["HSET", `deck:${code}:seen`, me, JSON.stringify({ at: Date.now(), view })], ["EXPIRE", `deck:${code}:seen`, TTL]]).catch(() => {});
  let [deck, swipes, ranks, seen, rsvp] = await pipeline([["GET", `deck:${code}`], ["HGETALL", `deck:${code}:swipes`], ["HGETALL", `deck:${code}:ranks`], ["HGETALL", `deck:${code}:seen`], ["HGETALL", `deck:${code}:rsvp`]]);
  if (!deck) return send(res, 404, { error: `No deck with code ${code}. It may have expired after a week.` });
  // A timer that ran out (or hit its 2-minute warning) acts now, even without the scheduler.
  if (timerDue(JSON.parse(deck))) {
    await tickDeck(code);
    [deck, swipes, ranks] = await pipeline([["GET", `deck:${code}`], ["HGETALL", `deck:${code}:swipes`], ["HGETALL", `deck:${code}:ranks`]]);
  }
  const d = JSON.parse(deck);
  return send(res, 200, { deck: d, ...blind(d, hashToObject(swipes), hashToObject(ranks), me), rsvp: hashToObject(rsvp), seen: hashToObject(seen), now: Date.now(), booking: bookingConfig() });
}

// Blind vote: until the winner is in, nobody sees anyone else's yeses, vetoes or ranking, only that they're done.
// The group still gets the yes count per place (to see what's matching) and which places were vetoed (not by whom).
// (It keeps an honest group honest; it isn't a secret: the data is someone's own picks, and nothing else rides on it.)
function blind(deck, swipes, ranks, me) {
  const vetoed = [...new Set(Object.values(swipes).map((s) => s.veto).filter(Boolean))];
  if (deck.phase === "done" || deck.announced) return { swipes, ranks, vetoed, yes: null };
  const yes = {}, sw = {}, rk = {};
  for (const [pid, s] of Object.entries(swipes)) {
    if (pid === me) { sw[pid] = s; continue; }
    for (const id of s.likes || []) yes[id] = (yes[id] || 0) + 1;
    sw[pid] = { name: s.name, done: !!s.done, n: (s.likes?.length || 0) + (s.passes?.length || 0), at: s.at, hidden: true };
  }
  for (const [pid, r] of Object.entries(ranks)) rk[pid] = pid === me ? r : { name: r.name, at: r.at, hidden: true };
  return { swipes: sw, ranks: rk, vetoed, yes };
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  try {
    if (req.method === "GET") return await read(req, res);
    if (req.method === "POST") return await create(req, res);
    return send(res, 405, { error: "Use GET or POST." });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: e.friendly || "Something went wrong on our end. Try again in a minute." });
  }
}
