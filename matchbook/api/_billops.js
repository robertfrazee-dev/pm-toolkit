// Settle-up operations, served by /api/action (no extra function).
// GET  /api/action?bill=CODE&me=PID                          the bill, people, claims, everyone's share, who's paid
// POST /api/action { type: "billstart", playerId, name, deck?, crew?, place? }      the person who taps it is the payer
// POST /api/action { type: "billjoin", code, playerId, name?, k? }                  "that's me" / add myself
// POST /api/action { type: "billpeople", code, playerId, add?: name, remove?: k }   payer adds or removes people
// POST /api/action { type: "billedit", code, playerId, patch }                       payer edits items, totals, tip, place
// POST /api/action { type: "billreceipt", code, playerId, image, mediaType }        payer's receipt photo → items
// POST /api/action { type: "billclaim", code, playerId, item, on }                  claim / unclaim an item
// POST /api/action { type: "billshare", code, playerId, item, keys }                split an item among chosen people
// POST /api/action { type: "billhandles", playerId, venmo, cashtag, code? }         payer's Venmo / Cash App (kept per player)
// POST /api/action { type: "billfinish", code, playerId, open? }                    payer finishes (leftovers split evenly) / reopens
// POST /api/action { type: "billpaid", code, playerId, k?, paid }                   "I paid" (or the payer marks someone)
// POST /api/action { type: "billping", code, playerId, what: "claim"|"pay" }        payer nudges the group (rate-limited)
import { PLAYER_RE, CODE_RE, redis, pipeline, hashToObject, send, clientIp, allow, underDailyCap, bump, cleanName } from "./_lib.js";
import { BILL_RE, BILL_TTL, newBillCode, loadBill, saveBill, addPerson, removePerson, setClaim, setShare, expandItems, computeShares, cents } from "./_bill.js";
import { readReceipt } from "./_receipt.js";
import { getCrew, personKey } from "./_crew.js";
import { pushToPlayers } from "./_push.js";
import { track } from "./_events.js";

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const VENMO_RE = /^[A-Za-z0-9_-]{2,30}$/, CASHTAG_RE = /^[A-Za-z][A-Za-z0-9]{0,19}$/;
const money = (x, max = 1e6) => { const c = cents(x); return Number.isFinite(c) && c >= 0 && c <= max * 100 ? c : null; };

function view(state, me) {
  const { bill, people, claimed, paid } = state;
  const you = people.find((p) => p.pids.includes(me))?.k || null;
  const calc = computeShares(state);
  return {
    code: bill.code, deck: bill.deck || null, crew: bill.crew || null, place: bill.place, status: bill.status, mode: bill.mode, even: !!bill.even,
    payer: { k: bill.payerKey, name: people.find((p) => p.k === bill.payerKey)?.name || bill.payerName, venmo: bill.venmo || "", cashtag: bill.cashtag || "" },
    you, isPayer: bill.payerId === me || (you && you === bill.payerKey),
    people: people.map((p) => ({ k: p.k, name: p.name, joined: p.pids.length > 0 })),
    items: (bill.items || []).map((i) => ({ ...i, by: claimed[i.id] || [] })),
    subtotal: bill.subtotal ?? null, tax: bill.tax ?? 0, tip: bill.tip ?? null, tipPct: bill.tipPct ?? null, manualTotal: bill.manualTotal ?? null, receiptRead: !!bill.receiptRead,
    calc, paid: Object.fromEntries(Object.entries(paid).map(([k, v]) => [k, { at: v.at }])), createdAt: bill.createdAt,
  };
}

export async function billGet(res, q) {
  const code = String(q.get("bill") || "").toUpperCase(), me = q.get("me") || "";
  const state = await loadBill(code);
  if (!state) return send(res, 404, { error: "That bill wasn't found. Bills last 30 days." });
  return send(res, 200, view(state, me));
}

export async function billPost(req, res, b) {
  const me = String(b.playerId || "");
  if (!PLAYER_RE.test(me)) return send(res, 400, { error: "Bad player." });
  if (!(await allow(`rl:bill:${clientIp(req)}`, 600, 600))) return send(res, 429, { error: "Slow down a little and try again." });

  if (b.type === "billhandles") {
    const venmo = clean(b.venmo, 31).replace(/^@/, ""), cashtag = clean(b.cashtag, 21).replace(/^\$/, "");
    if ((venmo && !VENMO_RE.test(venmo)) || (cashtag && !CASHTAG_RE.test(cashtag))) return send(res, 400, { error: "Check your Venmo username and $cashtag." });
    await redis("SET", `payh:${me}`, JSON.stringify({ venmo, cashtag }), "EX", 400 * 86400);
    const code = String(b.code || "").toUpperCase();
    if (BILL_RE.test(code)) { const st = await loadBill(code); if (st && st.bill.payerId === me) await saveBill({ ...st.bill, venmo, cashtag }); }
    return send(res, 200, { ok: true });
  }

  if (b.type === "billstart") {
    const name = cleanName(b.name); if (!name) return send(res, 400, { error: "Add your name first." });
    if (!(await allow(`rl:billnew:${clientIp(req)}`, 30, 86400))) return send(res, 429, { error: "That's a lot of bills for one day." });
    const code = await newBillCode();
    const handles = JSON.parse((await redis("GET", `payh:${me}`)) || "null") || {};
    let place = clean(b.place, 60), deck = "", crewId = "";
    const people = new Map([[personKey(name), { name, pids: [me] }]]);
    // Pre-fill people from the deck (everyone who swiped or ranked) or the crew.
    const dc = String(b.deck || "").toUpperCase();
    if (CODE_RE.test(dc)) {
      const [d, sw, rk] = await pipeline([["GET", `deck:${dc}`], ["HGETALL", `deck:${dc}:swipes`], ["HGETALL", `deck:${dc}:ranks`]]);
      if (d) {
        deck = dc; const dj = JSON.parse(d); crewId = dj.crew || "";
        for (const [pid, s] of [...Object.entries(hashToObject(sw)), ...Object.entries(hashToObject(rk))]) { const k = personKey(s.name); if (!k) continue; const cur = people.get(k) || { name: s.name, pids: [] }; if (!cur.pids.includes(pid)) cur.pids.push(pid); people.set(k, cur); }
      }
    }
    const cr = String(b.crew || crewId || "").toUpperCase();
    if (/^[A-Z0-9]{8}$/.test(cr)) {
      const crew = await getCrew(cr);
      if (crew) { crewId = cr; if (!deck) for (const [k, m] of Object.entries(crew.members)) { const cur = people.get(k) || { name: m.name, pids: [] }; cur.pids = [...new Set([...cur.pids, ...m.pids])].slice(-6); people.set(k, cur); } }
    }
    const bill = { code, deck, crew: crewId, payerId: me, payerKey: personKey(name), payerName: name, place, status: "open", mode: "items", items: [], subtotal: null, tax: 0, tip: null, tipPct: null, manualTotal: null, even: false, venmo: handles.venmo || "", cashtag: handles.cashtag || "", createdAt: Date.now() };
    let t = 0;
    await pipeline([...[...people].map(([k, p]) => ["HSET", `bill:${code}:ppl`, k, JSON.stringify({ name: p.name, pids: p.pids.slice(-6), at: Date.now() + t++ })]), ["EXPIRE", `bill:${code}:ppl`, BILL_TTL]]);
    await saveBill(bill);
    await bump("bills"); await track("tab_started", { pid: me, code: deck, crew: crewId });
    return send(res, 201, { code });
  }

  const code = String(b.code || "").toUpperCase();
  const state = await loadBill(code);
  if (!state) return send(res, 404, { error: "That bill wasn't found." });
  const { bill, people } = state;
  const you = people.find((p) => p.pids.includes(me))?.k || null;
  const isPayer = bill.payerId === me || you === bill.payerKey;
  const ok = async () => send(res, 200, view(await loadBill(code), me));
  const payerOnly = () => send(res, 403, { error: "Only the person who paid can change the bill." });

  if (b.type === "billjoin") {
    // "That's me" (an existing name) or "I'm not listed" (a new name).
    const k = b.k && people.some((p) => p.k === b.k) ? b.k : null;
    const name = k ? people.find((p) => p.k === k).name : cleanName(b.name);
    if (!name) return send(res, 400, { error: "Add your name." });
    if (!k && bill.status === "final") return send(res, 409, { error: "This bill is already finished. Ask the payer to reopen it." });
    await addPerson(code, name, me);
    return ok();
  }
  if (b.type === "billclaim" || b.type === "billshare") {
    if (bill.status === "final") return send(res, 409, { error: "The bill is finished. Ask the payer to reopen it to change items." });
    const item = (bill.items || []).find((i) => i.id === b.item); if (!item) return send(res, 404, { error: "That item is gone." });
    if (b.type === "billclaim") {
      if (!you) return send(res, 400, { error: "Tell us which one you are first." });
      await setClaim(code, item.id, you, !!b.on);
    } else {
      if (!you) return send(res, 400, { error: "Tell us which one you are first." });
      await setShare(code, item.id, Array.isArray(b.keys) ? b.keys.map(String) : [], people.map((p) => p.k));
    }
    if ((await redis("SET", `billsplit:${code}:${you}`, "1", "EX", BILL_TTL, "NX")) === "OK") await track("tab_split", { pid: me, code: bill.deck, crew: bill.crew }); // once per person per bill
    return ok();
  }
  if (b.type === "billpaid") {
    if (b.k && !isPayer && b.k !== you) return send(res, 403, { error: "Only the payer can mark someone else paid." });
    const k = isPayer && b.k ? String(b.k) : you;
    if (!k || !people.some((p) => p.k === k)) return send(res, 400, { error: "Tell us which one you are first." });
    if (b.paid) { await pipeline([["HSET", `bill:${code}:paid`, k, JSON.stringify({ at: Date.now(), by: me })], ["EXPIRE", `bill:${code}:paid`, BILL_TTL]]); await track("tab_paid", { pid: me, code: bill.deck, crew: bill.crew }); }
    else await redis("HDEL", `bill:${code}:paid`, k);
    return ok();
  }

  // Everything below is the payer's.
  if (!isPayer) return payerOnly();
  if (b.type === "billpeople") {
    if (b.add) { if (!(await addPerson(code, b.add))) return send(res, 400, { error: "Add a name." }); }
    if (b.remove && b.remove !== bill.payerKey) await removePerson(code, String(b.remove));
    return ok();
  }
  if (b.type === "billedit") {
    const p = b.patch || {}, next = { ...bill };
    if ("place" in p) next.place = clean(p.place, 60);
    if ("mode" in p && ["items", "total"].includes(p.mode)) next.mode = p.mode;
    if ("even" in p) next.even = !!p.even;
    if ("manualTotal" in p) next.manualTotal = p.manualTotal === null ? null : money(p.manualTotal);
    if ("subtotal" in p) next.subtotal = p.subtotal === null || p.subtotal === "" ? null : money(p.subtotal);
    if ("tax" in p) next.tax = money(p.tax || 0) ?? 0;
    if ("tip" in p) { next.tip = p.tip === null || p.tip === "" ? null : money(p.tip); if (next.tip != null) next.tipPct = null; }
    if ("tipPct" in p) { const v = Number(p.tipPct); next.tipPct = v > 0 && v <= 50 ? v : null; if (next.tipPct) next.tip = null; }
    if (Array.isArray(p.items)) {
      // Keep ids for items that stay, so claims stay with them; new rows get new ids.
      let n = Math.max(0, ...(bill.items || []).map((i) => Number(i.id.slice(1)) || 0));
      next.items = p.items.slice(0, 200).map((i) => ({ id: /^i\d{1,4}$/.test(i.id || "") && (bill.items || []).some((x) => x.id === i.id) ? i.id : `i${++n}`, name: clean(i.name, 60) || "Item", cents: money(i.price, 10000) ?? 0 })).filter((i) => i.cents > 0);
    }
    await saveBill(next);
    return ok();
  }
  if (b.type === "billreceipt") {
    const image = String(b.image || ""), mediaType = ["image/jpeg", "image/png", "image/webp"].includes(b.mediaType) ? b.mediaType : "image/jpeg";
    if (!/^[A-Za-z0-9+/=]{1000,}$/.test(image) || image.length > 4_000_000) return send(res, 400, { error: "That photo didn't come through. Try again, or type the total." });
    if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: "Receipt reading isn't set up. Type the total instead." });
    if (!(await allow(`rl:receipt:${clientIp(req)}`, 15, 3600))) return send(res, 429, { error: "That's a lot of receipts. Type the total instead." });
    if (!(await underDailyCap("receipts", Number(process.env.DAILY_RECEIPT_LIMIT) || 100))) return send(res, 503, { error: "Receipt reading is resting for today. Type the total instead." });
    let r;
    try { r = await readReceipt(image, mediaType); } // the photo is only in this request; it isn't saved anywhere
    catch (e) { console.error("receipt", e?.message); return send(res, 502, { error: e.friendly || "Couldn't read that receipt. Try a clearer photo, or type the total." }); }
    await bump("receipts_read");
    if (!r?.readable || !r.items?.length) return send(res, 422, { error: "Couldn't find items on that photo. Try again closer up, or type the total." });
    const items = expandItems(r.items);
    const next = { ...bill, mode: "items", items, subtotal: money(r.subtotal) || items.reduce((a, i) => a + i.cents, 0), tax: money(r.tax) ?? 0, tip: r.tipIncluded && r.tip > 0 ? money(r.tip) : null, tipPct: null, receiptRead: true, place: bill.place || clean(r.merchant, 60) };
    // New items mean old claims no longer apply.
    await redis("DEL", `bill:${code}:claims`);
    await saveBill(next);
    return ok();
  }
  if (b.type === "billfinish") {
    await saveBill({ ...bill, status: b.open ? "open" : "final", finishedAt: b.open ? null : Date.now() });
    if (!b.open) {
      const fin = await loadBill(code), calc = computeShares(fin);
      const owe = fin.people.filter((p) => p.k !== bill.payerKey && p.pids.length);
      await Promise.all(owe.map((p) => { const s = calc.shares.find((x) => x.k === p.k); return s?.total ? pushToPlayers(p.pids, { title: `You owe ${bill.payerName} $${(s.total / 100).toFixed(2)}`, body: `${bill.place || "Tonight"}: tap to pay back with Venmo or Cash App.`, url: `/s/${code}` }) : null; }));
    }
    return ok();
  }
  if (b.type === "billping") {
    if ((await redis("SET", `rl:billping:${code}`, "1", "EX", 120, "NX")) !== "OK") return send(res, 429, { error: "You just pinged everyone. Give it a couple of minutes." });
    const calc = computeShares(state);
    const targets = b.what === "pay"
      ? people.filter((p) => p.k !== bill.payerKey && !state.paid[p.k])
      : people.filter((p) => p.k !== bill.payerKey);
    const pids = targets.flatMap((p) => p.pids);
    const sent = await pushToPlayers(pids, b.what === "pay"
      ? { title: `${bill.payerName} is waiting to be paid back`, body: `${bill.place || "Tonight"}: tap to pay with Venmo or Cash App.`, url: `/s/${code}` }
      : { title: `Claim what you had`, body: `${calc.unclaimed} item${calc.unclaimed === 1 ? "" : "s"} still unclaimed on ${bill.place || "the bill"}. Tap yours.`, url: `/s/${code}` });
    return send(res, 200, { ...view(state, me), pinged: sent });
  }
  return send(res, 400, { error: "Unknown bill action." });
}
