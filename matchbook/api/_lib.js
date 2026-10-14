// Shared helpers for the Matchbook API routes. Files starting with "_" are not routes on Vercel.

export const TTL = 7 * 24 * 60 * 60; // decks expire after a week
export const CODE_RE = /^[A-Z0-9]{5}$/;
export const PLAYER_RE = /^[A-Za-z0-9]{8,40}$/;

// Vercel's Upstash integration may add a custom prefix (e.g. STORAGE_KV_REST_API_URL), so match on the suffix.
const envEnding = (...suffixes) => {
  for (const s of suffixes) if (process.env[s]) return process.env[s];
  for (const s of suffixes) {
    const key = Object.keys(process.env).find((k) => k.endsWith("_" + s) && !k.includes("READ_ONLY"));
    if (key) return process.env[key];
  }
  return undefined;
};
const redisUrl = () => envEnding("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
const redisToken = () => envEnding("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");

export function missingConfig() {
  const missing = [];
  if (!process.env.GOOGLE_MAPS_API_KEY) missing.push("GOOGLE_MAPS_API_KEY");
  if (!redisUrl() || !redisToken()) missing.push("Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN)");
  return missing;
}

// Upstash Redis over its REST API, so the app needs no npm packages.
export async function redis(...command) {
  const r = await fetch(redisUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (j.error) throw new Error("Redis: " + j.error);
  return j.result;
}

export async function pipeline(commands) {
  const r = await fetch(redisUrl() + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("Redis: " + (j.error || "bad pipeline response"));
  return j.map((x) => {
    if (x.error) throw new Error("Redis: " + x.error);
    return x.result;
  });
}

// HGETALL comes back as a flat [field, value, field, value] list.
export function hashToObject(flat) {
  const out = {};
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* skip a corrupt entry */ }
  }
  return out;
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

// Fixed-window limit so a public link can't burn through the Google quota.
export async function allow(key, limit, windowSec) {
  const n = await redis("INCR", key);
  if (n === 1) await redis("EXPIRE", key, windowSec);
  return n <= limit;
}

export const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 30);
export const cleanIds = (a, valid) => (Array.isArray(a) ? [...new Set(a.filter((x) => valid.has(x)))] : []);
