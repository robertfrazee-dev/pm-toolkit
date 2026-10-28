// Venue accounts: email + password (scrypt), and a session cookie that only the server can read.
import crypto from "node:crypto";
import { redis } from "./_lib.js";

const SESSION_DAYS = 30;
export const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,}$/;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function checkPassword(pw, stored) {
  const [kind, salt, hex] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hex, "hex");
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}

export const newId = (n = 12) => crypto.randomBytes(n).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, n) || crypto.randomUUID().slice(0, n);

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const secure = (req) => (req.headers["x-forwarded-proto"] || "https") === "https" && !/^localhost|^127\./.test(req.headers.host || "");
const cookie = (req, value, maxAge) => `mbv=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? "; Secure" : ""}`;

export async function startSession(req, res, venueId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await redis("SET", `vsess:${token}`, venueId, "EX", SESSION_DAYS * 86400);
  res.setHeader("Set-Cookie", cookie(req, token, SESSION_DAYS * 86400));
}

export async function endSession(req, res) {
  const token = cookies(req).mbv;
  if (token) await redis("DEL", `vsess:${token}`);
  res.setHeader("Set-Cookie", cookie(req, "", 0));
}

export async function sessionVenueId(req) {
  const token = cookies(req).mbv;
  if (!token || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  return redis("GET", `vsess:${token}`);
}
