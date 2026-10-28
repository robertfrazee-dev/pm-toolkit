// /api/market?op=...  Group deals: venue accounts, offers, split-payment bookings, boosts, admin, Stripe webhook.
// One route for all of it keeps the app inside Vercel's function limit.
//
// Groups:  GET offers (lat, lng, radius) · GET offer (id, date) · GET booking (id, playerId)
//          POST book · POST pay · POST cancel · POST adlog
// Venues:  POST signup · POST login · POST logout · GET me · POST profile · POST placesearch · POST offer · POST offerdelete
//          POST payouts · POST boost · POST vcancel
// Admin:   GET admin · POST adminset  (header x-admin-key: ADMIN_KEY)
// Stripe:  POST stripe  (webhook: checkout.session.completed / expired, account.updated)
// Cron:    GET cron  (Authorization: Bearer CRON_SECRET) ends bookings that ran out of time
import { send, body, clientIp, allow, redis, pipeline, hashToObject, bump, PLAYER_RE, CODE_RE, cleanName, missingConfig } from "./_lib.js";
import { google } from "./_places.js";
import { pushToPlayers } from "./_push.js";
import { stripe, stripeReady, verifyWebhook } from "./_stripe.js";
import { hashPassword, checkPassword, startSession, endSession, sessionVenueId, newId, EMAIL_RE } from "./_auth.js";
import {
  fail, text, KINDS, DATE_RE, FEE_RATE, BOOST_CENTS, getJson, putJson, getMany, withLock, listEdit, validTz, todayIn,
  publicVenue, publicOffer, cleanOffer, isLive, syncLive, availability, offersNear, publicBooking, createBooking, tidy, endBooking, confirm, refundAll, sweepExpired,
} from "./_market.js";

const origin = (req) => process.env.SITE_URL || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
const ID_RE = /^[A-Za-z0-9]{6,24}$/;

// ---------- places on a map (for a venue's address) ----------
async function geocode(address) {
  // OpenStreetMap's geocoder is free and its results may be stored; Google is the fallback.
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: { "User-Agent": "Matchbook (group deals)" } });
    const j = await r.json();
    if (j?.[0]) return { lat: Math.round(+j[0].lat * 1e5) / 1e5, lng: Math.round(+j[0].lon * 1e5) / 1e5 };
  } catch { /* fall through */ }
  const g = await google({ textQuery: address, pageSize: 1 }).catch(() => null);
  const loc = g?.places?.[0]?.location;
  return loc ? { lat: Math.round(loc.latitude * 1e5) / 1e5, lng: Math.round(loc.longitude * 1e5) / 1e5 } : null;
}

// ---------- venue side ----------
async function venueFromSession(req) {
  const id = await sessionVenueId(req);
  const v = id && (await getJson(`venue:${id}`));
  if (!v) throw fail(401, "Log in to your venue account.");
  return v;
}
const ownView = (v) => { const { passHash, ...rest } = v; return rest; };

async function signup(req, res, b) {
  if (!(await allow(`rl:signup:${clientIp(req)}`, 5, 3600))) throw fail(429, "Too many sign-ups from this connection. Try again later.");
  const email = text(b.email, 254).toLowerCase(), name = text(b.name, 80), address = text(b.address, 160);
  if (!EMAIL_RE.test(email)) throw fail(400, "Enter a valid email.");
  if (String(b.password || "").length < 8) throw fail(400, "Use a password of at least 8 characters.");
  if (name.length < 2) throw fail(400, "Enter your business name.");
  if (address.length < 5) throw fail(400, "Enter your business address so groups nearby can find you.");
  const tz = validTz(b.tz) ? b.tz : "America/New_York";
  const where = await geocode(address);
  if (!where) throw fail(400, "Couldn't find that address on the map. Add the city and state.");
  const id = newId(12);
  if ((await redis("SET", `venue:email:${email}`, id, "NX")) !== "OK") throw fail(409, "There's already an account with that email. Log in instead.");
  const v = {
    id, email, passHash: hashPassword(b.password), name, kind: KINDS[b.kind] ? b.kind : "other", address, ...where, tz,
    phone: text(b.phone, 30), contact: text(b.contact, 60), about: "", gid: /^[A-Za-z0-9_-]{6,300}$/.test(b.gid || "") ? b.gid : "",
    status: "pending", payoutsReady: false, stripeAccount: "", offers: [], createdAt: Date.now(),
  };
  await putJson(`venue:${id}`, v);
  await listEdit("venues:all", (l) => [id, ...l]);
  await bump("venue_signups");
  await startSession(req, res, id);
  return send(res, 201, { venue: ownView(v) });
}

async function login(req, res, b) {
  if (!(await allow(`rl:login:${clientIp(req)}`, 20, 900))) throw fail(429, "Too many tries. Wait 15 minutes and try again.");
  const email = text(b.email, 254).toLowerCase();
  const id = await redis("GET", `venue:email:${email}`);
  const v = id && (await getJson(`venue:${id}`));
  if (!v || !checkPassword(b.password, v.passHash)) throw fail(401, "That email and password don't match.");
  await startSession(req, res, id);
  return send(res, 200, { venue: ownView(v) });
}

async function me(req, res) {
  let v = await venueFromSession(req);
  // Back from Stripe's payout setup: check whether the account can take payments yet.
  if (v.stripeAccount && !v.payoutsReady && stripeReady()) {
    const acct = await stripe("GET", `/v1/accounts/${v.stripeAccount}`).catch(() => null);
    if (acct?.charges_enabled) { v = await withLock(`venue:${v.id}`, async () => { const cur = await getJson(`venue:${v.id}`); cur.payoutsReady = true; await putJson(`venue:${v.id}`, cur); return cur; }); await syncLive(v); }
  }
  const offers = (await getMany(v.offers.map((id) => `offer:${id}`))).filter(Boolean);
  const stats = await pipeline(offers.map((o) => ["HGETALL", `offerstats:${o.id}`]));
  const ids = ((await getJson(`venue:${v.id}:bookings`)) || []).slice(0, 60);
  const bookings = (await getMany(ids.map((id) => `booking:${id}`))).filter(Boolean)
    .map((b) => ({ ...publicBooking(b), paid: b.shares.filter((s) => s.status === "paid").length, organizerName: b.organizer.name }));
  return send(res, 200, {
    venue: ownView(v), feePercent: Math.round(FEE_RATE() * 100), boostDaily: BOOST_CENTS(), paymentsOn: stripeReady(),
    offers: offers.map((o, i) => ({ ...o, live: isLive(v, o), stats: Object.fromEntries(Object.entries(hashToObject(stats[i])).map(([k, n]) => [k, Number(n) || 0])) })),
    bookings,
  });
}

async function profile(req, res, b) {
  const v = await venueFromSession(req);
  const updated = await withLock(`venue:${v.id}`, async () => {
    const cur = await getJson(`venue:${v.id}`);
    const address = text(b.address, 160) || cur.address;
    if (address !== cur.address) { const where = await geocode(address); if (!where) throw fail(400, "Couldn't find that address on the map."); Object.assign(cur, where, { address }); }
    Object.assign(cur, {
      name: text(b.name, 80) || cur.name, phone: text(b.phone, 30), contact: text(b.contact, 60), about: text(b.about, 400),
      kind: KINDS[b.kind] ? b.kind : cur.kind, tz: validTz(b.tz) ? b.tz : cur.tz,
      gid: b.gid === "" ? "" : /^[A-Za-z0-9_-]{6,300}$/.test(b.gid || "") ? b.gid : cur.gid,
    });
    await putJson(`venue:${v.id}`, cur);
    return cur;
  });
  return send(res, 200, { venue: ownView(updated) });
}

// Lets a venue link its Google Maps listing, so its deal shows on its card when groups swipe.
async function placesearch(req, res, b) {
  await venueFromSession(req);
  if (!(await allow(`rl:vsearch:${clientIp(req)}`, 20, 3600))) throw fail(429, "Too many searches. Try again later.");
  const q = text(b.q, 120); if (q.length < 3) throw fail(400, "Type your business name and city.");
  const r = await google({ textQuery: q, pageSize: 5 });
  return send(res, 200, { places: (r.places || []).map((p) => ({ gid: p.id, name: p.displayName?.text || "", address: p.shortFormattedAddress || p.formattedAddress || "" })) });
}

async function saveOffer(req, res, b) {
  const v = await venueFromSession(req);
  const result = await withLock(`venue:${v.id}`, async () => {
    const cur = await getJson(`venue:${v.id}`);
    let prev = null;
    if (b.id) { if (!cur.offers.includes(b.id)) throw fail(404, "That offer isn't yours."); prev = await getJson(`offer:${b.id}`); }
    if (!prev && cur.offers.length >= 20) throw fail(400, "You can have up to 20 offers.");
    const offer = cleanOffer(b, prev || { id: newId(10), venueId: cur.id, createdAt: Date.now(), boostUntil: 0 });
    await putJson(`offer:${offer.id}`, offer);
    if (!prev) { cur.offers.push(offer.id); await putJson(`venue:${cur.id}`, cur); }
    return { offer, venue: cur };
  });
  await syncLive(result.venue);
  return send(res, 200, { offer: result.offer });
}

async function deleteOffer(req, res, b) {
  const v = await venueFromSession(req);
  const cur = await withLock(`venue:${v.id}`, async () => {
    const c = await getJson(`venue:${v.id}`);
    if (!c.offers.includes(b.id)) throw fail(404, "That offer isn't yours.");
    c.offers = c.offers.filter((x) => x !== b.id);
    await putJson(`venue:${c.id}`, c);
    await redis("DEL", `offer:${b.id}`);
    return c;
  });
  await listEdit("offers:live", (l) => l.filter((x) => x !== b.id));
  await syncLive(cur);
  return send(res, 200, { ok: true });
}

// Stripe-hosted setup for getting paid (bank account, identity). Matchbook never sees those details.
async function payouts(req, res) {
  const v = await venueFromSession(req);
  if (!stripeReady()) throw fail(503, "Payments aren't switched on yet. We'll email you when they are.");
  let acct = v.stripeAccount;
  if (!acct) {
    const a = await stripe("POST", "/v1/accounts", {
      type: "express", country: "US", email: v.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: v.name, product_description: "Group bookings through Matchbook" }, metadata: { venue: v.id },
    }, { idempotencyKey: `acct-${v.id}` });
    acct = a.id;
    await withLock(`venue:${v.id}`, async () => { const cur = await getJson(`venue:${v.id}`); cur.stripeAccount = acct; await putJson(`venue:${v.id}`, cur); });
  }
  const link = await stripe("POST", "/v1/account_links", { account: acct, refresh_url: `${origin(req)}/venue.html?payouts=retry`, return_url: `${origin(req)}/venue.html?payouts=done`, type: "account_onboarding" });
  return send(res, 200, { url: link.url });
}

async function boost(req, res, b) {
  const v = await venueFromSession(req);
  if (!stripeReady()) throw fail(503, "Payments aren't switched on yet.");
  if (!v.offers.includes(b.offerId)) throw fail(404, "That offer isn't yours.");
  const offer = await getJson(`offer:${b.offerId}`);
  if (!isLive(v, offer)) throw fail(409, "Only live offers can be boosted. It goes live once Matchbook approves your venue and payouts are set up.");
  const days = [1, 3, 7, 14, 30].includes(Number(b.days)) ? Number(b.days) : 7;
  const s = await stripe("POST", "/v1/checkout/sessions", {
    mode: "payment", customer_email: v.email,
    line_items: [{ quantity: days, price_data: { currency: "usd", unit_amount: BOOST_CENTS(), product_data: { name: `Boost: ${offer.title}`, description: "Shown between swipes to groups nearby, per day" } } }],
    metadata: { kind: "boost", offer: offer.id, venue: v.id, days },
    success_url: `${origin(req)}/venue.html?boost=done`, cancel_url: `${origin(req)}/venue.html`,
  });
  return send(res, 200, { url: s.url });
}

async function venueCancel(req, res, b) {
  const v = await venueFromSession(req);
  if (!ID_RE.test(b.bookingId || "")) throw fail(400, "Bad booking.");
  const out = await withLock(`booking:${b.bookingId}`, async () => {
    const bk = await getJson(`booking:${b.bookingId}`);
    if (!bk || bk.venueId !== v.id) throw fail(404, "That booking isn't yours.");
    if (bk.status === "confirmed") await refundAll(bk);
    else if (bk.status === "holding") await endBooking(bk, "canceled_by_venue");
    else throw fail(409, "That booking is already closed.");
    await putJson(`booking:${bk.id}`, bk);
    return bk;
  });
  const people = [out.organizer.playerId, ...out.shares.map((s) => s.by).filter(Boolean)];
  await pushToPlayers([...new Set(people)], { title: `${out.venueName} canceled your booking`, body: "Everyone has been refunded in full.", code: out.deckCode || undefined }).catch(() => {});
  return send(res, 200, { ok: true });
}

// ---------- group side ----------
async function listOffers(res, q) {
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw fail(400, "Pick an area first.");
  const radius = Math.min(Math.max(Number(q.get("radius")) || 10, 1), 30);
  return send(res, 200, { offers: (await offersNear(lat, lng, radius)).slice(0, 40), feePercent: Math.round(FEE_RATE() * 100) });
}

async function oneOffer(res, q) {
  const id = q.get("id") || "";
  if (!ID_RE.test(id)) throw fail(400, "Bad offer.");
  const o = await getJson(`offer:${id}`), v = o && (await getJson(`venue:${o.venueId}`));
  if (!o || !v || !isLive(v, o)) throw fail(404, "This offer isn't available anymore.");
  await sweepExpired().catch((e) => console.error("sweep", e));
  // Which of the next three weeks' days have any open time, and the open times for the chosen day.
  const days = Array.from({ length: 21 }, (_, i) => todayIn(v.tz, i)).filter((d) => o.days.includes(new Date(d + "T12:00:00Z").getUTCDay()));
  const open = [];
  for (const d of days) if ((await availability(o, v, d)).length) open.push(d);
  const date = DATE_RE.test(q.get("date") || "") ? q.get("date") : open[0] || "";
  return send(res, 200, { offer: publicOffer(o), venue: publicVenue(v), openDays: open, date, times: date ? await availability(o, v, date) : [], paymentsOn: stripeReady(), feePercent: Math.round(FEE_RATE() * 100) });
}

async function getBooking(res, q) {
  const id = q.get("id") || "", playerId = q.get("playerId") || "";
  if (!ID_RE.test(id)) throw fail(400, "Bad booking.");
  const b = await withLock(`booking:${id}`, async () => {
    const bk = await getJson(`booking:${id}`); if (!bk) throw fail(404, "That booking wasn't found.");
    const before = JSON.stringify(bk); await tidy(bk);
    if (JSON.stringify(bk) !== before) await putJson(`booking:${id}`, bk);
    return bk;
  });
  return send(res, 200, { booking: publicBooking(b, PLAYER_RE.test(playerId) ? playerId : "") });
}

async function book(req, res, b, playerId, name) {
  if (!stripeReady()) throw fail(503, "Booking isn't switched on yet.");
  if (!(await allow(`rl:book:${clientIp(req)}`, 20, 3600))) throw fail(429, "Too many bookings from this connection. Try again later.");
  const o = ID_RE.test(b.offerId || "") && (await getJson(`offer:${b.offerId}`));
  const v = o && (await getJson(`venue:${o.venueId}`));
  if (!o || !v) throw fail(404, "This offer isn't available anymore.");
  if (!DATE_RE.test(b.date || "")) throw fail(400, "Pick a date.");
  await sweepExpired().catch((e) => console.error("sweep", e));
  const bk = await createBooking({ offer: o, venue: v, date: b.date, time: String(b.time || ""), size: Math.round(Number(b.size)), playerId, name, deckCode: CODE_RE.test(b.deckCode || "") ? b.deckCode : "" });
  return send(res, 201, { id: bk.id });
}

// One person pays their share (or the organizer covers everyone who hasn't paid). The card is only authorized now.
async function pay(req, res, b, playerId, name) {
  if (!ID_RE.test(b.id || "")) throw fail(400, "Bad booking.");
  const out = await withLock(`booking:${b.id}`, async () => {
    const bk = await getJson(`booking:${b.id}`); if (!bk) throw fail(404, "That booking wasn't found.");
    await tidy(bk);
    if (bk.status !== "holding") { await putJson(`booking:${bk.id}`, bk); throw fail(409, bk.status === "confirmed" ? "Everyone's already paid. You're booked!" : "This booking has ended. Nobody was charged."); }
    const rest = !!b.rest && bk.organizer.playerId === playerId;
    // Started a checkout and came back without finishing: close that one and start fresh.
    for (const sid of [...new Set(bk.shares.filter((s) => s.by === playerId && s.status === "pending").map((s) => s.sessionId))]) {
      await stripe("POST", `/v1/checkout/sessions/${sid}/expire`, {}).catch(() => {});
      for (const s of bk.shares) if (s.sessionId === sid && s.status === "pending") Object.assign(s, { status: "open", sessionId: null, by: null, name: "" });
    }
    if (!rest && bk.shares.some((s) => s.by === playerId && (s.status === "paid" || s.status === "pending"))) throw fail(409, "You've already paid your share.");
    const open = bk.shares.map((s, i) => (s.status === "open" ? i : -1)).filter((i) => i >= 0);
    if (!open.length) throw fail(409, "Every share is paid or being paid right now.");
    const take = rest ? open : open.slice(0, 1);
    const v = await getJson(`venue:${bk.venueId}`);
    if (!v?.stripeAccount || !v.payoutsReady) throw fail(409, "This venue can't take payments right now.");
    const amount = bk.ppp * take.length;
    const session = await stripe("POST", "/v1/checkout/sessions", {
      mode: "payment",
      line_items: [{ quantity: take.length, price_data: { currency: "usd", unit_amount: bk.ppp, product_data: { name: `${take.length > 1 ? `${take.length} shares` : "Your share"}: ${bk.title}`, description: `${bk.venueName} · ${bk.date} at ${bk.time} · charged only once everyone has paid` } } }],
      payment_intent_data: {
        capture_method: "manual", application_fee_amount: Math.round(amount * FEE_RATE()),
        transfer_data: { destination: v.stripeAccount }, metadata: { booking: bk.id, shares: take.join(",") },
      },
      metadata: { kind: "share", booking: bk.id, shares: take.join(",") },
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: `${origin(req)}/b/${bk.id}?paid=1`, cancel_url: `${origin(req)}/b/${bk.id}`,
    });
    for (const i of take) Object.assign(bk.shares[i], { status: "pending", by: playerId, name, sessionId: session.id, at: Date.now() });
    await putJson(`booking:${bk.id}`, bk);
    return session.url;
  });
  return send(res, 200, { url: out });
}

async function cancelByOrganizer(res, b, playerId) {
  if (!ID_RE.test(b.id || "")) throw fail(400, "Bad booking.");
  await withLock(`booking:${b.id}`, async () => {
    const bk = await getJson(`booking:${b.id}`); if (!bk) throw fail(404, "That booking wasn't found.");
    if (bk.organizer.playerId !== playerId) throw fail(403, "Only the person who started this booking can cancel it.");
    if (bk.status !== "holding") throw fail(409, bk.status === "confirmed" ? "This booking is confirmed. Contact the venue to change it." : "This booking has already ended.");
    await endBooking(bk, "canceled");
    await putJson(`booking:${bk.id}`, bk);
  });
  return send(res, 200, { ok: true });
}

async function adlog(req, res, b) {
  if (!ID_RE.test(b.offerId || "") || !["view", "tap"].includes(b.kind)) throw fail(400, "Bad.");
  if (!(await allow(`rl:ad:${clientIp(req)}`, 300, 3600))) return send(res, 200, { ok: true });
  await redis("HINCRBY", `offerstats:${b.offerId}`, b.kind === "view" ? "views" : "taps", 1);
  await bump(b.kind === "view" ? "ad_views" : "ad_taps");
  return send(res, 200, { ok: true });
}

// ---------- Stripe webhook ----------
async function readRaw(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  let raw = ""; for await (const c of req) raw += c; return raw;
}
async function webhook(req, res) {
  const raw = await readRaw(req);
  if (!verifyWebhook(raw, req.headers["stripe-signature"])) return send(res, 400, { error: "Bad signature." });
  const ev = JSON.parse(raw), obj = ev.data?.object || {}, meta = obj.metadata || {};
  if (ev.type === "checkout.session.completed" && meta.kind === "share" && ID_RE.test(meta.booking || "")) {
    await withLock(`booking:${meta.booking}`, async () => {
      const bk = await getJson(`booking:${meta.booking}`); if (!bk) return;
      const idx = String(meta.shares || "").split(",").map(Number).filter((i) => Number.isInteger(i) && bk.shares[i]);
      // Paid after the booking ended: release this card hold straight away.
      if (bk.status !== "holding") { if (obj.payment_intent) await stripe("POST", `/v1/payment_intents/${obj.payment_intent}/cancel`, {}).catch(() => {}); return; }
      for (const i of idx) Object.assign(bk.shares[i], { status: "paid", pi: obj.payment_intent, sessionId: obj.id });
      if (bk.shares.every((s) => s.status === "paid")) await confirm(bk);
      await putJson(`booking:${bk.id}`, bk);
    });
  } else if (ev.type === "checkout.session.expired" && meta.kind === "share" && ID_RE.test(meta.booking || "")) {
    await withLock(`booking:${meta.booking}`, async () => {
      const bk = await getJson(`booking:${meta.booking}`); if (!bk) return;
      for (const s of bk.shares) if (s.status === "pending" && s.sessionId === obj.id) Object.assign(s, { status: "open", sessionId: null, by: null, name: "" });
      await putJson(`booking:${bk.id}`, bk);
    });
  } else if (ev.type === "checkout.session.completed" && meta.kind === "boost" && ID_RE.test(meta.offer || "")) {
    await withLock(`boost:${obj.id}`, async () => {
      if ((await redis("SET", `boosted:${obj.id}`, "1", "EX", 90 * 86400, "NX")) !== "OK") return; // Stripe can deliver an event twice
      const o = await getJson(`offer:${meta.offer}`); if (!o) return;
      o.boostUntil = Math.max(o.boostUntil || 0, Date.now()) + Number(meta.days || 1) * 864e5;
      await putJson(`offer:${o.id}`, o);
      await listEdit("boosts:log", (l) => [{ offer: o.id, venue: meta.venue, days: Number(meta.days || 1), cents: obj.amount_total || 0, at: Date.now() }, ...l].slice(0, 200));
      await bump("boost_cents", obj.amount_total || 0);
    });
  } else if (ev.type === "account.updated" && obj.metadata?.venue && ID_RE.test(obj.metadata.venue)) {
    const v = await withLock(`venue:${obj.metadata.venue}`, async () => {
      const cur = await getJson(`venue:${obj.metadata.venue}`); if (!cur) return null;
      cur.payoutsReady = !!obj.charges_enabled; await putJson(`venue:${cur.id}`, cur); return cur;
    });
    if (v) await syncLive(v);
  }
  return send(res, 200, { received: true });
}

// ---------- admin ----------
function isAdmin(req) { const k = process.env.ADMIN_KEY; return !!k && req.headers["x-admin-key"] === k; }
async function admin(req, res) {
  if (!isAdmin(req)) throw fail(401, "Wrong admin key.");
  const ids = (await getJson("venues:all")) || [];
  const venues = (await getMany(ids.slice(0, 300).map((id) => `venue:${id}`))).filter(Boolean).map(({ passHash, ...v }) => v);
  const holding = (await getJson("bookings:holding")) || [];
  return send(res, 200, { venues, holding: holding.length, boosts: (await getJson("boosts:log")) || [], live: ((await getJson("offers:live")) || []).length });
}
async function adminSet(req, res, b) {
  if (!isAdmin(req)) throw fail(401, "Wrong admin key.");
  if (!["approved", "rejected", "pending"].includes(b.status) || !ID_RE.test(b.venueId || "")) throw fail(400, "Bad request.");
  const v = await withLock(`venue:${b.venueId}`, async () => {
    const cur = await getJson(`venue:${b.venueId}`); if (!cur) throw fail(404, "No such venue.");
    cur.status = b.status; cur.reviewedAt = Date.now(); await putJson(`venue:${cur.id}`, cur); return cur;
  });
  await syncLive(v);
  return send(res, 200, { ok: true });
}

async function cron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw fail(401, "No.");
  let ended = 0;
  for (const id of (await getJson("bookings:holding")) || []) {
    await withLock(`booking:${id}`, async () => {
      const bk = await getJson(`booking:${id}`);
      if (!bk) { await listEdit("bookings:holding", (l) => l.filter((x) => x !== id)); return; }
      const was = bk.status; await tidy(bk); if (bk.status !== was) ended++;
      await putJson(`booking:${id}`, bk);
    });
  }
  return send(res, 200, { ended });
}

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "The app isn't set up yet." });
  const q = new URL(req.url, "http://x").searchParams, op = q.get("op") || "";
  try {
    if (op === "stripe" && req.method === "POST") return await webhook(req, res);
    if (req.method === "GET") {
      if (op === "offers") return await listOffers(res, q);
      if (op === "offer") return await oneOffer(res, q);
      if (op === "booking") return await getBooking(res, q);
      if (op === "me") return await me(req, res);
      if (op === "admin") return await admin(req, res);
      if (op === "cron") return await cron(req, res);
      return send(res, 404, { error: "Unknown." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req);
    if (!(await allow(`rl:market:${clientIp(req)}`, 300, 600))) throw fail(429, "Slow down a little and try again.");
    const venueOps = { signup, login, profile, placesearch, offer: saveOffer, offerdelete: deleteOffer, payouts, boost, vcancel: venueCancel, adminset: adminSet };
    if (op === "logout") { await endSession(req, res); return send(res, 200, { ok: true }); }
    if (venueOps[op]) return await venueOps[op](req, res, b);
    if (op === "adlog") return await adlog(req, res, b);
    const playerId = String(b.playerId || "");
    if (!PLAYER_RE.test(playerId)) throw fail(400, "Bad player.");
    const name = cleanName(b.name) || "Someone";
    if (op === "book") return await book(req, res, b, playerId, name);
    if (op === "pay") return await pay(req, res, b, playerId, name);
    if (op === "cancel") return await cancelByOrganizer(res, b, playerId);
    return send(res, 404, { error: "Unknown." });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.friendly || "Something went wrong on our end. Try again in a minute." });
  }
}

