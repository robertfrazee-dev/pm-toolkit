// POST /api/action  { code, playerId, name, type, ... }
//   type "swipe": { likes, passes, done }  saves this player's swipes; when everyone is done, ranking starts on its own
//   type "rank":  { order }                 saves this player's ranking
//   type "bar":   { minYes }                host only: how many yeses make a match
//   type "phase": { minYes }                host only: start ranking now, without waiting for everyone
//   type "close": {}                        host only: ends ranking so the result is final
import { TTL, CODE_RE, PLAYER_RE, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig, cleanName, cleanIds } from "./_lib.js";
import { pushToPlayers, deckPlayers } from "./_push.js";

const MAX_RANKED = 10; // more than this is a chore to drag around on a phone

// Everyone for small groups; two-thirds once the group is bigger than three.
export const defaultBar = (n) => (n <= 3 ? n : Math.ceil((n * 2) / 3));

function qualifying(deck, swipes, bar) {
  const valid = new Set(deck.places.map((p) => p.id));
  const yes = {};
  for (const s of swipes) for (const id of s.likes || []) if (valid.has(id)) yes[id] = (yes[id] || 0) + 1;
  return deck.places.map((p) => p.id).filter((id) => (yes[id] || 0) >= bar).sort((x, y) => yes[y] - yes[x]).slice(0, MAX_RANKED);
}

// Same scoring as the results screen: a list of n places gives n points to its top pick, n-1 to the next...
function winnerOf(deck, ranks) {
  const n = deck.matches.length, pts = Object.fromEntries(deck.matches.map((id) => [id, 0]));
  for (const r of ranks) (r.order || []).forEach((id, pos) => { if (id in pts) pts[id] += n - pos; });
  const best = deck.matches.slice().sort((a, b) => pts[b] - pts[a] || deck.matches.indexOf(a) - deck.matches.indexOf(b))[0];
  return deck.places.find((p) => p.id === best);
}

async function announceWinner(code, deck, exceptId) {
  const ranks = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:ranks`)));
  const top = winnerOf(deck, ranks);
  if (!top) return;
  const others = (await deckPlayers(code)).filter((id) => id !== exceptId);
  await pushToPlayers(others, { title: "It's decided", body: `You're going to ${top.name}.`, code });
}

async function announceRanking(code, deck, count, exceptId) {
  const others = (await deckPlayers(code)).filter((id) => id !== exceptId);
  await pushToPlayers(others, { title: "Time to rank", body: `${count} place${count === 1 ? "" : "s"} made the cut for ${deck.label.toLowerCase()} near ${deck.area}. Put them in order.`, code });
}

async function startRanking(code, deck, swipes, bar, { relax }) {
  const voters = Math.max(swipes.length, 1);
  bar = Math.min(Math.max(Math.round(bar) || defaultBar(voters), 1), voters);
  let matches = qualifying(deck, swipes, bar);
  // Starting on its own, lower the bar until there are at least two places worth ranking.
  while (relax && matches.length < 2 && bar > 1) matches = qualifying(deck, swipes, --bar);
  if (!matches.length) return null;
  await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "ranking", matches, minYes: bar, voters, rankingAt: Date.now() }), "KEEPTTL");
  return matches;
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    const code = String(b.code || "").toUpperCase();
    const playerId = String(b.playerId || "");
    if (!CODE_RE.test(code) || !PLAYER_RE.test(playerId)) return send(res, 400, { error: "Bad deck code or player." });
    if (!(await allow(`rl:act:${clientIp(req)}`, 600, 600))) return send(res, 429, { error: "Slow down a little and try again." });

    const raw = await redis("GET", `deck:${code}`);
    if (!raw) return send(res, 404, { error: `No deck with code ${code}.` });
    const deck = JSON.parse(raw);
    const valid = new Set(deck.places.map((p) => p.id));
    const name = cleanName(b.name) || "Someone";
    const isHost = !deck.hostId || deck.hostId === playerId;

    if (b.type === "swipe") {
      const likes = cleanIds(b.likes, valid);
      const passes = cleanIds(b.passes, valid).filter((id) => !likes.includes(id));
      const entry = { playerId, name, likes, passes, done: !!b.done, at: Date.now() };
      const [added] = await pipeline([["HSET", `deck:${code}:swipes`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:swipes`, TTL]]);
      if (added === 1 && deck.hostId && playerId !== deck.hostId) {
        await pushToPlayers([deck.hostId], { title: `${name} joined your deck`, body: `${deck.label} near ${deck.area}`, code });
      }
      // The last person to finish starts the ranking round for everyone. A lone swiper waits for friends.
      if (entry.done && deck.phase === "swiping") {
        const swipes = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:swipes`)));
        if (swipes.length >= 2 && swipes.every((s) => s.done)) {
          const matches = await startRanking(code, deck, swipes, deck.minYes ?? defaultBar(swipes.length), { relax: true });
          if (matches) {
            await announceRanking(code, deck, matches.length, playerId);
            return send(res, 200, { ok: true, phase: "ranking" });
          }
        }
      }
      return send(res, 200, { ok: true, phase: deck.phase });
    }

    if (b.type === "rank") {
      if (deck.phase !== "ranking") return send(res, 409, { error: deck.phase === "done" ? "Voting is closed for this deck." : "Ranking hasn't started for this deck." });
      const order = cleanIds(b.order, new Set(deck.matches));
      if (order.length !== deck.matches.length) return send(res, 400, { error: "Rank every match before submitting." });
      const entry = { playerId, name, order, at: Date.now() };
      await pipeline([["HSET", `deck:${code}:ranks`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:ranks`, TTL]]);
      // Once the last ranking is in, tell everyone where they're going (only once per deck).
      if (!deck.announced) {
        const [players, ranked] = await Promise.all([deckPlayers(code), redis("HKEYS", `deck:${code}:ranks`)]);
        if (players.every((id) => ranked.includes(id))) {
          await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, announced: true }), "KEEPTTL");
          await announceWinner(code, deck, playerId);
        }
      }
      return send(res, 200, { ok: true });
    }

    if (b.type === "bar") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can change this." });
      const minYes = Math.max(1, Math.min(Math.round(Number(b.minYes)) || 1, 100));
      if (deck.phase === "swiping") await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, minYes }), "KEEPTTL");
      return send(res, 200, { ok: true, minYes });
    }

    if (b.type === "phase") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can start ranking." });
      if (deck.phase !== "swiping") return send(res, 200, { ok: true, matches: deck.matches });
      const swipes = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:swipes`)));
      const matches = await startRanking(code, deck, swipes, Number(b.minYes), { relax: false });
      if (!matches) return send(res, 400, { error: "Nothing has that many yeses yet. Lower the bar or wait for more swipes." });
      await announceRanking(code, deck, matches.length, playerId);
      return send(res, 200, { ok: true, matches });
    }

    if (b.type === "close") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can close voting." });
      if (deck.phase === "ranking") {
        await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "done", closedAt: Date.now(), announced: true }), "KEEPTTL");
        if (!deck.announced) await announceWinner(code, deck, playerId);
      }
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Something went wrong on the server. Try again." });
  }
}
