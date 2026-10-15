// Push notifications for the iPhone app, sent straight to Apple (APNs) with no extra packages.
// Needs APNS_KEY (the .p8 file's contents), APNS_KEY_ID and APNS_TEAM_ID. Without them, pushes are skipped.
import http2 from "node:http2";
import crypto from "node:crypto";
import { redis, hashToObject } from "./_lib.js";
import { sendWebPush } from "./_webpush.js";

export const PUSH_TTL = 90 * 24 * 60 * 60;
const BUNDLE_ID = () => process.env.APNS_BUNDLE_ID || "com.robertfrazee.matchbook";
const HOST = () => process.env.APNS_HOST || (process.env.APNS_SANDBOX === "true" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");

export const pushConfigured = () => !!(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);

const b64url = (buf) => Buffer.from(buf).toString("base64url");
let cachedJwt = null;

// Apple accepts a signed token for up to an hour; reuse it for 50 minutes.
export function apnsJwt(now = Date.now()) {
  if (cachedJwt && now - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.token;
  const key = process.env.APNS_KEY.replace(/\\n/g, "\n").trim();
  const head = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(now / 1000) }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  cachedJwt = { token: `${head}.${claims}.${b64url(sig)}`, at: now };
  return cachedJwt.token;
}

function sendOne(client, token, payload) {
  return new Promise((resolve) => {
    const req = client.request({
      ":method": "POST", ":path": `/3/device/${token}`,
      authorization: `bearer ${apnsJwt()}`, "apns-topic": BUNDLE_ID(), "apns-push-type": "alert", "apns-priority": "10",
    });
    let status = 0, body = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (d) => { body += d; });
    req.on("end", () => resolve({ token, status, body }));
    req.on("error", () => resolve({ token, status: 0, body: "" }));
    req.setTimeout(4000, () => { req.close(); resolve({ token, status: 0, body: "timeout" }); });
    req.end(JSON.stringify(payload));
  });
}

// Send one alert to these players: the iPhone app (APNs) and any browsers they turned notifications on in.
// Never throws: a failed push must not break the request. Returns how many players were reached.
// url (optional) opens a page other than a deck, e.g. a crew's page.
export async function pushToPlayers(playerIds, { title, body, code, url }) {
  if (!playerIds.length) return 0;
  const [apns, web] = await Promise.all([pushApns(playerIds, { title, body, code, url }), pushWeb(playerIds, { title, body, code, url })]);
  return new Set([...apns, ...web]).size;
}

async function pushApns(playerIds, { title, body, code, url }) {
  if (!pushConfigured()) return [];
  let client;
  try {
    const tokens = (await Promise.all(playerIds.map((id) => redis("GET", `push:${id}`)))).map((t, i) => [playerIds[i], t]).filter(([, t]) => t);
    if (!tokens.length) return [];
    client = http2.connect(HOST());
    client.on("error", () => {});
    const payload = { aps: { alert: { title, body }, sound: "default" }, code, ...(url ? { url } : {}) };
    const results = await Promise.all(tokens.map(([, t]) => sendOne(client, t, payload)));
    // Forget phones Apple says are gone (app deleted or token replaced).
    await Promise.all(results.map((r, i) => (r.status === 410 || /BadDeviceToken|Unregistered/.test(r.body) ? redis("DEL", `push:${tokens[i][0]}`) : null)));
    return tokens.filter((_, i) => results[i].status === 200).map(([id]) => id);
  } catch (e) {
    console.error("push failed", e);
    return [];
  } finally {
    client?.close();
  }
}

async function pushWeb(playerIds, { title, body, code, url }) {
  try {
    const rows = await Promise.all(playerIds.map((id) => redis("HGETALL", `wpush:${id}`)));
    const reached = new Set();
    await Promise.all(rows.flatMap((flat, i) => {
      const subs = hashToObject(flat);
      return Object.entries(subs).map(async ([key, sub]) => {
        const status = await sendWebPush(sub, { title, body, url: url || (code ? `/j/${code}` : "/"), tag: code || url || "matchbook" }).catch(() => 0);
        if (status >= 200 && status < 300) reached.add(playerIds[i]);
        else if (status === 404 || status === 410) await redis("HDEL", `wpush:${playerIds[i]}`, key);
      });
    }));
    return [...reached];
  } catch (e) {
    console.error("web push failed", e);
    return [];
  }
}

export async function deckPlayers(code) {
  const [swipes, ranks] = await Promise.all([redis("HGETALL", `deck:${code}:swipes`), redis("HGETALL", `deck:${code}:ranks`)]);
  return [...new Set([...Object.keys(hashToObject(swipes)), ...Object.keys(hashToObject(ranks))])];
}
