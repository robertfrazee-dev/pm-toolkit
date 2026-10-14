// Stripe over its plain HTTP API, so there's still nothing to npm install.
// Needs STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for the webhook). Without them, paying is switched off.
import crypto from "node:crypto";

export const stripeReady = () => !!process.env.STRIPE_SECRET_KEY;
const BASE = () => process.env.STRIPE_API_BASE || "https://api.stripe.com";

// Stripe wants form encoding with brackets for nested fields: a[b][0]=c.
function form(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

export async function stripe(method, path, params, { idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` };
  let url = BASE() + path, body;
  if (method === "GET") { if (params) url += "?" + form(params); }
  else { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = form(params || {}); }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await fetch(url, { method, headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error?.message || `Stripe returned ${r.status}`);
    err.status = 502; err.friendly = "Payments are having trouble right now. Try again in a minute.";
    err.stripeCode = j.error?.code;
    throw err;
  }
  return j;
}

// Checks the Stripe-Signature header against the raw request body (tolerance 5 minutes).
export function verifyWebhook(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const t = Number(parts.t), sigs = String(header).split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}
