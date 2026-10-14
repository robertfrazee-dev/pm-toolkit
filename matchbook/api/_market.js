// Group deals: venues list offers, groups book a time and each person pays their share.
// Cards are only authorized when people pay; the money is captured once every share is in.
import { redis, pipeline, bump } from "./_lib.js";
import { stripe } from "./_stripe.js";
import { pushToPlayers, deckPlayers } from "./_push.js";
import { miles } from "./_places.js";
import { newId } from "./_auth.js";

export const FEE_RATE = () => Math.min(Math.max(Number(process.env.MATCHBOOK_FEE_PERCENT) || 10, 0), 50) / 100;
export const BOOST_CENTS = () => Math.round(Number(process.env.BOOST_DAILY_CENTS) || 500);
const HOLD_MAX = 48 * 3600e3; // a group has up to 2 days to fill its shares
const HOLD_BEFORE = 2 * 3600e3; // and must be fully paid 2 hours before the time
const PENDING_MAX = 35 * 60e3; // an unfinished checkout gives its share back after 35 minutes

export const fail = (status, message) => Object.assign(new Error(message), { status, friendly: message });
export const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
export const KINDS = { restaurant: "Restaurant", bar: "Bar", activity: "Activity", other: "Other" };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- storage ----------
export const getJson = async (key) => { const v = await redis("GET", key); return v ? JSON.parse(v) : null; };
export const putJson = (key, obj) => redis("SET", key, JSON.stringify(obj));
export async function getMany(keys) {
  if (!keys.length) return [];
  return (await pipeline(keys.map((k) => ["GET", k]))).map((v) => (v ? JSON.parse(v) : null));
}
export async function withLock(key, fn) {
  for (let i = 0; i < 40; i++) {
    if ((await redis("SET", `lock:${key}`, "1", "PX", 8000, "NX")) === "OK") {
      try { return await fn(); } finally { await redis("DEL", `lock:${key}`).catch(() => {}); }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw fail(503, "That's busy right now. Try again in a moment.");
}
// Small JSON id lists (fine at launch scale): all venues, live offers, bookings waiting on payment.
export async function listEdit(key, fn) {
  return withLock(key, async () => { const list = (await getJson(key)) || []; const next = fn(list); await putJson(key, next); return next; });
}

// ---------- time ----------
function tzOffset(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(t).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}
// "2026-10-17" at "19:30" in the venue's time zone, as a timestamp.
export function slotTime(date, time, tz) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - tzOffset(t, tz);
  return t;
}
export const validTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
export const weekday = (date) => new Date(date + "T12:00:00Z").getUTCDay();
export function todayIn(tz, plusDays = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(Date.now() + plusDays * 864e5).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// ---------- venues and offers ----------
export const publicVenue = (v) => v && { id: v.id, name: v.name, kind: v.kind, address: v.address, lat: v.lat, lng: v.lng, tz: v.tz, gid: v.gid || "", about: v.about || "", phone: v.phone || "" };
export const publicOffer = (o) => o && {
  id: o.id, venueId: o.venueId, title: o.title, about: o.about, includes: o.includes, ppp: o.ppp, minGroup: o.minGroup, maxGroup: o.maxGroup,
  duration: o.duration, days: o.days, times: o.times, leadHours: o.leadHours, boosted: (o.boostUntil || 0) > Date.now(),
};

export function cleanOffer(b, prev = {}) {
  const title = text(b.title, 60);
  if (title.length < 3) throw fail(400, "Give the offer a name, like \"Group dinner for 6\".");
  const ppp = Math.round(Number(b.price) * 100);
  if (!(ppp >= 100 && ppp <= 200000)) throw fail(400, "Price per person should be between $1 and $2,000.");
  const minGroup = Math.round(Number(b.minGroup)), maxGroup = Math.round(Number(b.maxGroup));
  if (!(minGroup >= 2 && minGroup <= 50)) throw fail(400, "The smallest group should be between 2 and 50 people.");
  if (!(maxGroup >= minGroup && maxGroup <= 100)) throw fail(400, "The largest group should be at least the smallest, and at most 100.");
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!days.length) throw fail(400, "Pick at least one day of the week.");
  const times = [...new Set((Array.isArray(b.times) ? b.times : []).filter((t) => TIME_RE.test(t)))].sort().slice(0, 12);
  if (!times.length) throw fail(400, "Add at least one start time.");
  return {
    ...prev, title, about: text(b.about, 400),
    includes: (Array.isArray(b.includes) ? b.includes : []).map((x) => text(x, 60)).filter(Boolean).slice(0, 8),
    ppp, minGroup, maxGroup, days, times,
    duration: Math.min(Math.max(Math.round(Number(b.duration)) || 120, 30), 600),
    perSlot: Math.min(Math.max(Math.round(Number(b.perSlot)) || 1, 1), 20),
    leadHours: Math.min(Math.max(Math.round(Number(b.leadHours)) || 24, 3), 336),
    active: b.active !== false,
  };
}

export const isLive = (v, o) => v?.status === "approved" && v.payoutsReady && o?.active;
// Keeps the list of offers groups can see in step with approvals, payouts and on/off switches.
export async function syncLive(venue) {
  const offers = await getMany((venue.offers || []).map((id) => `offer:${id}`));
  const live = new Set(offers.filter((o) => isLive(venue, o)).map((o) => o.id)), mine = new Set(venue.offers || []);
  await listEdit("offers:live", (list) => [...list.filter((id) => !mine.has(id)), ...live]);
}

// Open times for one date, after lead time and groups already booked.
export async function availability(offer, venue, date) {
  if (!DATE_RE.test(date) || !offer.days.includes(weekday(date))) return [];
  const now = Date.now();
  const times = offer.times.map((time) => ({ time, at: slotTime(date, time, venue.tz) })).filter((s) => s.at - now >= offer.leadHours * 3600e3);
  if (!times.length) return [];
  const used = await pipeline(times.map((s) => ["GET", `slot:${offer.id}:${date}:${s.time}`]));
  return times.map((s, i) => ({ time: s.time, left: offer.perSlot - (Number(used[i]) || 0) })).filter((s) => s.left > 0);
}

// Offers near a point, boosted ones first.
export async function offersNear(lat, lng, radius) {
  const ids = (await getJson("offers:live")) || [];
  const offers = (await getMany(ids.map((id) => `offer:${id}`))).filter(Boolean);
  const venues = Object.fromEntries((await getMany([...new Set(offers.map((o) => o.venueId))].map((id) => `venue:${id}`))).filter(Boolean).map((v) => [v.id, v]));
  return offers.map((o) => ({ o, v: venues[o.venueId] }))
    .filter(({ o, v }) => isLive(v, o) && v.lat != null)
    .map(({ o, v }) => ({ ...publicOffer(o), venue: publicVenue(v), distance: Math.round(miles({ latitude: lat, longitude: lng }, { latitude: v.lat, longitude: v.lng }) * 10) / 10 }))
    .filter((x) => x.distance <= radius)
    .sort((a, b) => (b.boosted - a.boosted) || a.distance - b.distance);
}

// ---------- bookings ----------
export function publicBooking(b, playerId) {
  return {
    id: b.id, offerId: b.offerId, venueId: b.venueId, title: b.title, venueName: b.venueName, venueAddress: b.venueAddress, date: b.date, time: b.time, slotAt: b.slotAt, duration: b.duration || 120,
    size: b.size, ppp: b.ppp, total: b.total, status: b.status, holdUntil: b.holdUntil, deckCode: b.deckCode || "",
    organizer: { name: b.organizer.name, mine: b.organizer.playerId === playerId },
    shares: b.shares.map((s) => ({ status: s.status, name: s.name || "", mine: !!playerId && s.by === playerId })),
  };
}

export async function createBooking({ offer, venue, date, time, size, playerId, name, deckCode }) {
  if (!isLive(venue, offer)) throw fail(409, "This offer isn't taking bookings right now.");
  if (!(size >= offer.minGroup && size <= offer.maxGroup)) throw fail(400, `This offer is for groups of ${offer.minGroup} to ${offer.maxGroup}.`);
  if (!(await availability(offer, venue, date)).some((s) => s.time === time)) throw fail(409, "That time isn't available anymore. Pick another.");
  const slotKey = `slot:${offer.id}:${date}:${time}`;
  if ((await redis("INCR", slotKey)) > offer.perSlot) { await redis("DECR", slotKey); throw fail(409, "Someone just took that time. Pick another."); }
  await redis("EXPIRE", slotKey, 120 * 86400);
  const slotAt = slotTime(date, time, venue.tz), now = Date.now();
  const id = newId(10);
  const b = {
    id, offerId: offer.id, venueId: venue.id, title: offer.title, venueName: venue.name, venueAddress: venue.address, tz: venue.tz,
    date, time, slotAt, duration: offer.duration, size, ppp: offer.ppp, total: offer.ppp * size, slotKey,
    organizer: { playerId, name }, shares: Array.from({ length: size }, () => ({ status: "open" })),
    status: "holding", holdUntil: Math.min(now + HOLD_MAX, slotAt - HOLD_BEFORE), createdAt: now, deckCode: deckCode || "",
  };
  await putJson(`booking:${id}`, b);
  await listEdit("bookings:holding", (l) => [...l, id]);
  await listEdit(`venue:${venue.id}:bookings`, (l) => [id, ...l].slice(0, 300));
  await bump("bookings_started");
  return b;
}

// Gives back abandoned checkouts and ends bookings that ran out of time. Call under the booking's lock.
export async function tidy(b) {
  const now = Date.now();
  for (const s of b.shares) if (s.status === "pending" && now - (s.at || 0) > PENDING_MAX) Object.assign(s, { status: "open", sessionId: null, by: null, name: "" });
  if (b.status === "holding" && now > b.holdUntil) await endBooking(b, "expired");
  return b;
}

// Ends any held bookings past their deadline, so their times open up without waiting for the daily cleanup.
export async function sweepExpired() {
  const ids = (await getJson("bookings:holding")) || [];
  const late = (await getMany(ids.map((id) => `booking:${id}`))).filter((b) => b && b.status === "holding" && Date.now() > b.holdUntil);
  for (const b of late) {
    await withLock(`booking:${b.id}`, async () => { const cur = await getJson(`booking:${b.id}`); if (cur) { await tidy(cur); await putJson(`booking:${cur.id}`, cur); } });
  }
}

// Cancels a booking that wasn't fully paid: card holds are released, nobody is charged, the time opens up again.
export async function endBooking(b, status) {
  for (const pi of [...new Set(b.shares.filter((s) => s.status === "paid" && s.pi).map((s) => s.pi))]) {
    await stripe("POST", `/v1/payment_intents/${pi}/cancel`, {}).catch((e) => console.error("cancel hold", e.message));
  }
  b.shares.forEach((s) => { if (s.status !== "open") s.status = "released"; });
  b.status = status; b.endedAt = Date.now();
  await redis("DECR", b.slotKey);
  await listEdit("bookings:holding", (l) => l.filter((x) => x !== b.id));
  await bump(`bookings_${status}`);
}

// Everyone has paid: capture each hold so the money moves to the venue (minus Matchbook's cut).
export async function confirm(b) {
  for (const pi of [...new Set(b.shares.map((s) => s.pi).filter(Boolean))]) await stripe("POST", `/v1/payment_intents/${pi}/capture`, {}, { idempotencyKey: `cap-${pi}` });
  b.status = "confirmed"; b.confirmedAt = Date.now();
  await listEdit("bookings:holding", (l) => l.filter((x) => x !== b.id));
  await bump("bookings_confirmed"); await bump("booking_cents", b.total); await bump("fee_cents", Math.round(b.total * FEE_RATE()));
  await redis("HINCRBY", `offerstats:${b.offerId}`, "bookings", 1).catch(() => {});
  const people = new Set([b.organizer.playerId, ...b.shares.map((s) => s.by).filter(Boolean)]);
  if (b.deckCode) for (const pid of await deckPlayers(b.deckCode).catch(() => [])) people.add(pid);
  await pushToPlayers([...people], { title: "You're booked 🎉", body: `${b.title} at ${b.venueName}, ${b.date} ${b.time}. Everyone's paid.`, code: b.deckCode || undefined }).catch(() => {});
}

// Venue cancels a confirmed booking: everyone is refunded in full, including Matchbook's cut.
export async function refundAll(b) {
  for (const pi of [...new Set(b.shares.map((s) => s.pi).filter(Boolean))]) {
    await stripe("POST", "/v1/refunds", { payment_intent: pi, reverse_transfer: true, refund_application_fee: true }, { idempotencyKey: `ref-${pi}` });
  }
  b.status = "canceled_by_venue"; b.endedAt = Date.now();
  b.shares.forEach((s) => { if (s.status === "paid") s.status = "refunded"; });
  await redis("DECR", b.slotKey);
  await bump("bookings_refunded");
}
