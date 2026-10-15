// Web push (browsers, and iPhones that added Matchbook to the Home Screen), with no npm packages.
// The VAPID key pair is made on first use and kept in Redis, so there's nothing to set up.
// Encryption follows RFC 8291 (aes128gcm); the VAPID header follows RFC 8292.
import crypto from "node:crypto";
import { redis } from "./_lib.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

let cached = null;
export async function vapidKeys() {
  if (cached) return cached;
  let raw = await redis("GET", "vapid:keys");
  if (!raw) {
    const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
    const fresh = JSON.stringify({ publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) });
    // If two requests race, the first one saved wins and both use it.
    await redis("SET", "vapid:keys", fresh, "NX");
    raw = await redis("GET", "vapid:keys");
  }
  cached = JSON.parse(raw);
  return cached;
}

function vapidAuth(endpoint, keys) {
  const pub = unb64u(keys.publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || "mailto:hello@matchbook.app" }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), { key: crypto.createPrivateKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

// Encrypts one message for one browser subscription.
export function encrypt(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Returns the HTTP status from the browser's push service (201 = sent, 404/410 = subscription gone).
export async function sendWebPush(sub, message) {
  const keys = await vapidKeys();
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: vapidAuth(sub.endpoint, keys), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" },
    body: encrypt(sub, JSON.stringify(message)),
  });
  return r.status;
}

export const validSub = (s) => !!s && typeof s.endpoint === "string" && /^https:\/\/[^\s]{10,800}$/.test(s.endpoint) && /^[A-Za-z0-9_-]{60,120}$/.test(s.keys?.p256dh || "") && /^[A-Za-z0-9_-]{16,40}$/.test(s.keys?.auth || "");
