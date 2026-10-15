// "Settle up": split a bill, then each person pays whoever paid with a pre-filled Venmo or Cash App link.
// Matchbook never touches money; it does the math. Everything is in cents and the shares add up exactly to the total.
//
// Redis (all expire after 30 days):
//   bill:{code}          the bill (payer, place, items, subtotal/tax/tip, status, payer's handles)
//   bill:{code}:ppl      people: personKey → { name, pids }   (a hash, so joining never races the payer's edits)
//   bill:{code}:claims   "{itemId}|{personKey}" → 1           (one field per claim, so two taps at once both land)
//   bill:{code}:paid     personKey → { at, by }
import { redis, pipeline, hashToObject } from "./_lib.js";
import { personKey } from "./_crew.js";

export const BILL_RE = /^[A-Z0-9]{6}$/;
export const BILL_TTL = 30 * 86400;
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const keys = (code) => ({ bill: `bill:${code}`, ppl: `bill:${code}:ppl`, claims: `bill:${code}:claims`, paid: `bill:${code}:paid` });
export const cents = (x) => Math.round(Number(x) * 100);
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);

export async function newBillCode() {
  for (let t = 0; t < 6; t++) {
    let c = ""; for (let i = 0; i < 6; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
    if (!(await redis("EXISTS", `bill:${c}`))) return c;
  }
  throw new Error("Couldn't make a bill code.");
}

export async function loadBill(code) {
  if (!BILL_RE.test(code || "")) return null;
  const k = keys(code);
  const [raw, ppl, claims, paid] = await pipeline([["GET", k.bill], ["HGETALL", k.ppl], ["HKEYS", k.claims], ["HGETALL", k.paid]]);
  if (!raw) return null;
  const bill = JSON.parse(raw);
  const people = Object.entries(hashToObject(ppl)).map(([key, v]) => ({ k: key, name: v.name, pids: v.pids || [], at: v.at || 0 })).sort((a, b) => (a.k === bill.payerKey ? -1 : b.k === bill.payerKey ? 1 : a.at - b.at));
  const claimed = {}; // itemId → [personKey]
  for (const f of claims || []) { const i = f.indexOf("|"); if (i > 0) (claimed[f.slice(0, i)] ||= []).push(f.slice(i + 1)); }
  return { bill, people, claimed, paid: hashToObject(paid) };
}
export const saveBill = (bill) => pipeline([["SET", `bill:${bill.code}`, JSON.stringify(bill), "EX", BILL_TTL], ...["ppl", "claims", "paid"].map((x) => ["EXPIRE", `bill:${bill.code}:${x}`, BILL_TTL])]);

export async function addPerson(code, name, pid = "") {
  const k = personKey(name); if (!k) return null;
  const cur = hashToObject(await redis("HGETALL", `bill:${code}:ppl`))[k];
  const pids = [...new Set([...(cur?.pids || []), ...(pid ? [pid] : [])])].slice(-6);
  await pipeline([["HSET", `bill:${code}:ppl`, k, JSON.stringify({ name: cur?.name || clean(name, 30), pids, at: cur?.at || Date.now() })], ["EXPIRE", `bill:${code}:ppl`, BILL_TTL]]);
  return k;
}
export const removePerson = (code, k) => pipeline([["HDEL", `bill:${code}:ppl`, k], ["HDEL", `bill:${code}:paid`, k]]);
export const setClaim = (code, itemId, k, on) => pipeline(on ? [["HSET", `bill:${code}:claims`, `${itemId}|${k}`, "1"], ["EXPIRE", `bill:${code}:claims`, BILL_TTL]] : [["HDEL", `bill:${code}:claims`, `${itemId}|${k}`]]);
export async function setShare(code, itemId, ks, everyone) {
  const fields = ((await redis("HKEYS", `bill:${code}:claims`)) || []).filter((f) => f.startsWith(itemId + "|"));
  return pipeline([...(fields.length ? [["HDEL", `bill:${code}:claims`, ...fields]] : []), ...ks.filter((k) => everyone.includes(k)).map((k) => ["HSET", `bill:${code}:claims`, `${itemId}|${k}`, "1"]), ["EXPIRE", `bill:${code}:claims`, BILL_TTL]]);
}

// Expand "4 × Bud Light $28" into four $7 chips (cents shared out so the line still adds up).
export function expandItems(lines) {
  const out = []; let n = 0;
  for (const l of lines) {
    const name = clean(l.name, 60) || "Item", qty = Math.max(1, Math.min(30, Math.round(Number(l.qty) || 1)));
    const unit = cents(l.unitPrice), lineTotal = cents(l.lineTotal ?? Number(l.unitPrice) * qty);
    if (!Number.isFinite(unit) && !Number.isFinite(lineTotal)) continue;
    const total = Number.isFinite(lineTotal) && lineTotal > 0 ? lineTotal : unit * qty;
    for (let i = 0; i < qty; i++) out.push({ id: `i${++n}`, name, cents: Math.floor(total / qty) + (i < total % qty ? 1 : 0) });
  }
  return out;
}

// Split `total` cents by weights so the parts add up exactly (largest remainder; ties go to the earlier person).
export function allocate(total, weights) {
  const W = weights.reduce((a, w) => a + w, 0);
  if (!W) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / W), base = raw.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
  return base;
}

// The math. Returns each person's items, their share of tax and tip, and their total; plus the bill's totals.
export function computeShares({ bill, people, claimed }) {
  const ks = people.map((p) => p.k), n = ks.length;
  const items = bill.items || [];
  const itemsSum = items.reduce((a, i) => a + i.cents, 0);
  const subtotal = bill.mode === "total" ? bill.manualTotal || 0 : bill.subtotal ?? itemsSum;
  const tax = bill.mode === "total" ? 0 : bill.tax || 0;
  const tip = bill.tip != null ? bill.tip : bill.tipPct ? Math.round((subtotal * bill.tipPct) / 100) : 0;
  const total = subtotal + tax + tip;
  const per = Object.fromEntries(ks.map((k) => [k, { items: [], itemCents: 0 }]));
  let unclaimed = 0, unclaimedCents = 0;
  const final = bill.status === "final";
  if (bill.mode !== "total" && !bill.even) {
    for (const it of items) {
      let who = (claimed[it.id] || []).filter((k) => per[k]);
      if (!who.length) { unclaimed++; unclaimedCents += it.cents; if (!final) continue; who = ks; } // leftovers split evenly at Finish
      who = ks.filter((k) => who.includes(k)); // stable order
      allocate(it.cents, who.map(() => 1)).forEach((c, i) => { const p = per[who[i]]; p.items.push({ id: it.id, name: it.name, cents: c, shared: who.length > 1 }); p.itemCents += c; });
    }
  }
  // Shares of the whole bill: by items (tax and tip ride along proportionally), or evenly.
  const evenly = bill.mode === "total" || bill.even || !itemsSum;
  const weights = evenly ? ks.map(() => 1) : ks.map((k) => per[k].itemCents);
  // Before Finish, unclaimed items aren't anyone's yet: scale to what's claimed so the running totals stay honest.
  const claimedSum = weights.reduce((a, w) => a + w, 0);
  const pot = evenly ? total : final ? total : itemsSum ? Math.round((total * claimedSum) / itemsSum) : 0;
  const totals = allocate(pot, weights);
  const shares = ks.map((k, i) => ({ k, items: per[k].items, itemCents: per[k].itemCents, extraCents: evenly ? 0 : totals[i] - per[k].itemCents, total: totals[i] }));
  return { subtotal, tax, tip, total, itemsSum, unclaimed: evenly || final ? 0 : unclaimed, unclaimedCents: evenly || final ? 0 : unclaimedCents, leftover: final && !evenly ? unclaimedCents : 0, evenly, mismatch: bill.mode !== "total" && bill.subtotal != null && Math.abs(itemsSum - bill.subtotal) > 1 ? itemsSum - bill.subtotal : 0, shares };
}
