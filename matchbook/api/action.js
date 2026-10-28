// POST /api/action  { code, playerId, name, type, ... }
//   type "swipe": { likes, passes, done }  saves this player's swipes; swiping stays open until the host closes it
//   type "rank":  { order }                 saves this player's ranking
//   type "bar":   { minYes }                host only: how many yeses make a match
//   type "phase": { minYes }                host only: close swiping and start ranking for everyone
//   type "close": {}                        host only: ends ranking so the result is final
//   type "more":  {}                        host only: deal 10 more cards (same search, new places)
//   type "nudge": {}                        anyone: remind people still swiping or ranking (push where possible)
//   type "timer": { stage, minutes }        host only: set or clear the swiping or ranking timer (0 = no limit)
//   type "rsvp":  { going }                 anyone, once the winner is in: "I'm in" / "can't make it"
//   type "remove": { target }               host only: take someone out of the deck (a duplicate or someone who left)
//   type "tick":  { code }                  anyone (and the scheduler): runs anything that's due (2-minute warnings, time's up)
import { TTL, CODE_RE, PLAYER_RE, bump, underDailyCap, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig, cleanName, cleanIds } from "./_lib.js";
import { track } from "./_events.js";
import { billGet, billPost } from "./_billops.js";
import { pushToPlayers, deckPlayers } from "./_push.js";
import { findPlaces, shape } from "./_places.js";
import { recordPlaces, swipeChanges } from "./_hot.js";
import { scheduleTimer } from "./_schedule.js";
import { recordCrewDeck, getCrew, addMember, saveCrew } from "./_crew.js";
import { trendCmds } from "./_trending.js";

export const TIMER_CHOICES = [0, 2, 5, 10, 15, 30, 60];
const cleanMinutes = (m) => (TIMER_CHOICES.includes(Math.round(Number(m))) ? Math.round(Number(m)) : null);

const MAX_CARDS = 40, MAX_DEALS = 2, DEAL = 10;
const canDeal = (deck) => !!deck.search && (deck.deals || 0) < MAX_DEALS && deck.places.length < MAX_CARDS;

const MAX_RANKED = 10; // more than this is a chore to drag around on a phone

// Everyone for small groups; two-thirds once the group is bigger than three.
export const defaultBar = (n) => (n <= 3 ? n : Math.ceil((n * 2) / 3));

// A place anyone vetoed (one veto each) can't make the cut, however many yeses it has.
function qualifying(deck, swipes, bar) {
  const vetoed = new Set(swipes.map((s) => s.veto).filter(Boolean));
  const valid = new Set(deck.places.map((p) => p.id).filter((id) => !vetoed.has(id)));
  const yes = {};
  for (const s of swipes) for (const id of s.likes || []) if (valid.has(id)) yes[id] = (yes[id] || 0) + 1;
  return deck.places.map((p) => p.id).filter((id) => valid.has(id) && (yes[id] || 0) >= bar).sort((x, y) => yes[y] - yes[x]).slice(0, MAX_RANKED);
}

// Same scoring as the results screen: a list of n places gives n points to its top pick, n-1 to the next...
export function winnerOf(deck, ranks) {
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
  await pushToPlayers(others, { title: "It's decided 🎉", body: `You're going to ${top.name}${deck.when?.label ? `, ${deck.when.label}` : ""}. Tap to say you're in.`, code });
}

// Counts the winner toward the place's lifetime picks and its area's hot list.
// Every way a deck can finish comes through here: count the winner, and file the night in the crew's history.
async function recordWinner(code, deck) {
  const [sw, rk] = await pipeline([["HGETALL", `deck:${code}:swipes`], ["HGETALL", `deck:${code}:ranks`]]);
  const swipes = hashToObject(sw), ranks = hashToObject(rk), winner = winnerOf(deck, Object.values(ranks));
  await recordPlaces(deck, [{ place: winner, field: "win", n: 1 }]);
  await track("revealed", { pid: deck.hostId || "", code, crew: deck.crew || "" });
  if (deck.crew) await recordCrewDeck(code, deck, winner, swipes, ranks).catch((e) => console.error("crew", e));
}

async function announceRanking(code, deck, count, exceptId, title = "Time to rank") {
  const others = (await deckPlayers(code)).filter((id) => id !== exceptId);
  await pushToPlayers(others, { title, body: `${count} place${count === 1 ? "" : "s"} made the cut ${deck.category === "saved" ? "from your saved places" : `for ${deck.label.toLowerCase()} near ${deck.area}`}. Put them in order.`, code });
}

async function startRanking(code, deck, swipes, bar, { relax }) {
  const voters = Math.max(swipes.length, 1);
  bar = Math.min(Math.max(Math.round(bar) || defaultBar(voters), 1), voters);
  let matches = qualifying(deck, swipes, bar);
  // Starting on its own, lower the bar until there are at least two places worth ranking.
  while (relax && matches.length < 2 && bar > 1) matches = qualifying(deck, swipes, --bar);
  if (!matches.length) return null;
  // One match is simply the winner; there's nothing to rank.
  const single = matches.length === 1;
  const rankMinutes = deck.rankMinutes ?? 5;
  const rankEndsAt = !single && rankMinutes > 0 ? Date.now() + rankMinutes * 60e3 : null;
  await redis("SET", `deck:${code}`, JSON.stringify({
    ...deck, phase: single ? "done" : "ranking", needsMore: false, matches, minYes: bar, voters, rankingAt: Date.now(), announced: single || deck.announced,
    swipeEndsAt: null, rankEndsAt, warned: { ...(deck.warned || {}), rank: false },
  }), "KEEPTTL");
  if (rankEndsAt) await scheduleTimer(code, rankEndsAt);
  await bump(single ? "winners" : "ranking_started");
  await track("matched", { code, crew: deck.crew || "", n: matches.length });
  await recordPlaces(deck, matches.map((id) => ({ place: deck.places.find((p) => p.id === id), field: "match", n: 1 })));
  if (single) await recordWinner(code, { ...deck, matches });
  return matches;
}

// Ranking is over once everyone still in the deck has ranked: tell them where they're going (once).
async function finishIfAllRanked(code, deck, exceptId) {
  if (deck.announced || deck.phase !== "ranking") return false;
  const [players, ranked] = await Promise.all([deckPlayers(code), redis("HKEYS", `deck:${code}:ranks`)]);
  if (!ranked.length || !players.every((id) => ranked.includes(id))) return false;
  await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, announced: true, rankEndsAt: null }), "KEEPTTL");
  await bump("winners");
  await recordWinner(code, deck);
  await announceWinner(code, deck, exceptId);
  return true;
}

// Runs whatever a timer says is due. Safe to call any time from anywhere: it only acts when the clock says so.
export const timerDue = (deck, now = Date.now()) =>
  (deck.phase === "swiping" && deck.swipeEndsAt && (now >= deck.swipeEndsAt || (!deck.warned?.swipe && now >= deck.swipeEndsAt - 120e3))) ||
  (deck.phase === "ranking" && deck.rankEndsAt && !deck.announced && (now >= deck.rankEndsAt || (!deck.warned?.rank && now >= deck.rankEndsAt - 120e3)));

export async function tickDeck(code) {
  if ((await redis("SET", `tick:${code}`, "1", "EX", 5, "NX")) !== "OK") return; // another request is already on it
  try {
    const raw = await redis("GET", `deck:${code}`);
    if (!raw) return;
    const deck = JSON.parse(raw), now = Date.now();
    if (!timerDue(deck, now)) return;
    const what = deck.category === "saved" ? deck.label : deck.label.toLowerCase();
    if (deck.phase === "swiping") {
      const swipes = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:swipes`)));
      if (now >= deck.swipeEndsAt) {
        const n = Math.max(swipes.length, 1);
        const matches = swipes.length >= 1 ? await startRanking(code, deck, swipes, Math.min(deck.minYes ?? defaultBar(n), n), { relax: true }) : null;
        if (matches?.length === 1) await announceWinner(code, { ...deck, matches });
        else if (matches) await announceRanking(code, deck, matches.length, null, "Time's up! Time to rank");
        else {
          await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, swipeEndsAt: null }), "KEEPTTL");
          if (deck.hostId) await pushToPlayers([deck.hostId], { title: "Time's up, but no matches yet", body: "Nobody said yes to the same places. Deal more cards or start a new deck.", code });
        }
        await bump("timer_closed");
        return;
      }
      await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, warned: { ...(deck.warned || {}), swipe: true } }), "KEEPTTL");
      const late = Object.entries(hashToObject(await redis("HGETALL", `deck:${code}:swipes`))).filter(([, s]) => !s.done).map(([id]) => id);
      await pushToPlayers(late, { title: "⏳ 2 minutes left to swipe", body: `Get your swipes in for ${what} before swiping closes.`, code });
      return;
    }
    if (now >= deck.rankEndsAt) {
      await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "done", closedAt: now, announced: true, rankEndsAt: null }), "KEEPTTL");
      await bump("winners"); await bump("timer_closed");
      await recordWinner(code, deck);
      await announceWinner(code, deck, null);
      return;
    }
    await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, warned: { ...(deck.warned || {}), rank: true } }), "KEEPTTL");
    const ranked = await redis("HKEYS", `deck:${code}:ranks`);
    const late = (await deckPlayers(code)).filter((id) => !ranked.includes(id));
    await pushToPlayers(late, { title: "⏳ 2 minutes left to rank", body: `Put the places in order before voting closes on ${what}.`, code });
  } finally {
    await redis("DEL", `tick:${code}`).catch(() => {});
  }
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  // Settle up (bills) lives here too, so it needs no function of its own.
  if (req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    if (q.get("bill")) { try { return await billGet(res, q); } catch (e) { console.error(e); return send(res, 500, { error: "Couldn't load the bill." }); } }
    return send(res, 405, { error: "Use POST." });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    if (String(b.type || "").startsWith("bill")) return await billPost(req, res, b);
    const code = String(b.code || "").toUpperCase();
    if (b.type === "tick") {
      if (!CODE_RE.test(code)) return send(res, 400, { error: "Bad deck code." });
      await tickDeck(code);
      return send(res, 200, { ok: true });
    }
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
      const veto = valid.has(String(b.veto || "")) ? String(b.veto) : "";
      const likes = cleanIds(b.likes, valid).filter((id) => id !== veto);
      const passes = [...new Set([...cleanIds(b.passes, valid), ...(veto ? [veto] : [])])].filter((id) => !likes.includes(id));
      const entry = { playerId, name, likes, passes, done: !!b.done, at: Date.now(), ...(veto ? { veto } : {}) };
      const before = hashToObject(await redis("HGETALL", `deck:${code}:swipes`));
      const [added] = await pipeline([["HSET", `deck:${code}:swipes`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:swipes`, TTL]]);
      if (added === 1) { await bump("joins"); await track("joined", { pid: playerId, code, crew: deck.crew || "" }); }
      const was = before[playerId], decided = likes.length + passes.length - ((was?.likes?.length || 0) + (was?.passes?.length || 0));
      if (decided > 0) await track("swiped", { pid: playerId, code, crew: deck.crew || "", n: decided });
      // Joining a crew's deck makes you part of the crew.
      if (added === 1 && deck.crew) { const crew = await getCrew(deck.crew); if (crew && addMember(crew, playerId, name)) await saveCrew(crew); if (crew) await redis("SADD", `pcrews:${playerId}`, crew.id); }
      await recordPlaces(deck, swipeChanges(deck, before, playerId, likes, passes));
      if (added === 1 && deck.hostId && playerId !== deck.hostId) {
        await pushToPlayers([deck.hostId], { title: `${name} joined your deck`, body: deck.category === "saved" ? deck.label : `${deck.label} near ${deck.area}`, code });
      }
      // Swiping stays open until the host closes it, however many people have the link.
      // When everyone who's joined so far is done, the host gets a nudge to close it (once per head count).
      if (entry.done && deck.phase === "swiping") {
        const swipes = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:swipes`)));
        const n = swipes.length;
        if (n >= 2 && swipes.every((s) => s.done) && deck.doneNotified !== n) {
          const bar = Math.min(deck.minYes ?? defaultBar(n), n);
          // Too few real matches (most of the group said yes)? The host is offered more cards.
          const few = canDeal(deck) && qualifying(deck, swipes, Math.min(bar, Math.floor(n / 2) + 1)).length < 3;
          await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, needsMore: few, doneNotified: n }), "KEEPTTL");
          if (deck.hostId && deck.hostId !== playerId) {
            await pushToPlayers([deck.hostId], few
              ? { title: "Everyone's done swiping", body: "Only a few matches. Deal 10 more cards, or close swiping and rank.", code }
              : { title: "Everyone's done swiping", body: "Close swiping when you're ready, and ranking starts for everyone.", code });
          }
          return send(res, 200, { ok: true, phase: "swiping", allDone: true, needsMore: few });
        }
      }
      return send(res, 200, { ok: true, phase: deck.phase });
    }

    if (b.type === "rank") {
      if (deck.phase !== "ranking") return send(res, 409, { error: deck.phase === "done" ? "Voting is closed for this deck." : "Ranking hasn't started for this deck." });
      const order = cleanIds(b.order, new Set(deck.matches));
      if (order.length !== deck.matches.length) return send(res, 400, { error: "Rank every match before submitting." });
      const entry = { playerId, name, order, at: Date.now() };
      const [newRank] = await pipeline([["HSET", `deck:${code}:ranks`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:ranks`, TTL]]);
      if (newRank === 1) await bump("rankings");
      // Once the last ranking is in, tell everyone where they're going (only once per deck).
      await finishIfAllRanked(code, deck, playerId);
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
      if (matches.length === 1) await announceWinner(code, { ...deck, matches }, playerId);
      else await announceRanking(code, deck, matches.length, playerId);
      return send(res, 200, { ok: true, matches });
    }

    if (b.type === "close") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can close voting." });
      if (deck.phase === "ranking") {
        await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "done", closedAt: Date.now(), announced: true, rankEndsAt: null }), "KEEPTTL");
        if (!deck.announced) { await bump("winners"); await recordWinner(code, deck); await announceWinner(code, deck, playerId); }
      }
      return send(res, 200, { ok: true });
    }

    if (b.type === "more") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can deal more cards." });
      if (deck.phase !== "swiping" || !deck.search) return send(res, 409, { error: "More cards can't be added to this deck." });
      if (!canDeal(deck)) return send(res, 409, { error: "This deck already has all the cards it can take. Rank what you have." });
      if (!(await underDailyCap("decks", Number(process.env.DAILY_DECK_LIMIT) || 300))) {
        return send(res, 503, { error: "Matchbook hit its limit for new searches today. Rank what you have." });
      }
      const kept = await findPlaces(deck.search, { want: Math.min(DEAL, MAX_CARDS - deck.places.length), exclude: new Set(deck.places.map((p) => p.gid)) });
      if (!kept.length) return send(res, 404, { error: "No more places nearby fit this search. Rank what you have." });
      const added = kept.map((p, i) => shape(p, deck.places.length + i, deck.search.center));
      const swipes = hashToObject(await redis("HGETALL", `deck:${code}:swipes`));
      // Everyone has new cards to swipe, so nobody is "done" anymore.
      await pipeline([
        ["SET", `deck:${code}`, JSON.stringify({ ...deck, places: [...deck.places, ...added], deals: (deck.deals || 0) + 1, needsMore: false, doneNotified: 0 }), "KEEPTTL"],
        ...Object.entries(swipes).map(([id, sw]) => ["HSET", `deck:${code}:swipes`, id, JSON.stringify({ ...sw, done: false })]),
      ]);
      await bump("deals");
      const others = Object.keys(swipes).filter((id) => id !== playerId);
      await pushToPlayers(others, { title: `${name} dealt ${added.length} more cards`, body: `Back to swiping: ${deck.label}.`, code });
      return send(res, 200, { ok: true, added: added.length });
    }

    if (b.type === "nudge") {
      // Swiping: everyone not done. Ranking: everyone who hasn't sent their list.
      let waiting;
      if (deck.phase === "swiping") {
        waiting = Object.entries(hashToObject(await redis("HGETALL", `deck:${code}:swipes`))).filter(([id, sw]) => id !== playerId && !sw.done).map(([id, sw]) => [id, sw.name]);
      } else if (deck.phase === "ranking" && !deck.announced) {
        const [players, ranked, swipes] = await Promise.all([deckPlayers(code), redis("HKEYS", `deck:${code}:ranks`), redis("HGETALL", `deck:${code}:swipes`)]);
        const names = hashToObject(swipes);
        waiting = players.filter((id) => id !== playerId && !ranked.includes(id)).map((id) => [id, names[id]?.name]);
      } else return send(res, 409, { error: "There's nobody left to nudge." });
      if (!waiting.length) return send(res, 200, { ok: true, waiting: [], pushed: 0 });
      if (!(await allow(`rl:nudge:${code}:${deck.phase}`, 1, 120))) return send(res, 429, { error: "Someone just nudged. Give them a couple of minutes." });
      const pushed = await pushToPlayers(waiting.map(([id]) => id), deck.phase === "swiping"
        ? { title: `${name} is waiting on you 👀`, body: `Finish swiping so the group can pick: ${deck.label}.`, code }
        : { title: `${name} is waiting on your ranking 👀`, body: "Put the places in order so the group can pick.", code });
      await bump("nudges");
      return send(res, 200, { ok: true, waiting: waiting.map(([, n]) => n || "Someone"), pushed });
    }

    if (b.type === "timer") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can set the timer." });
      const minutes = cleanMinutes(b.minutes);
      if (minutes == null || !["swipe", "rank"].includes(b.stage)) return send(res, 400, { error: "Pick a time." });
      let next = deck;
      if (b.stage === "swipe" && deck.phase === "swiping") next = { ...deck, swipeMinutes: minutes, swipeEndsAt: minutes ? Date.now() + minutes * 60e3 : null, warned: { ...(deck.warned || {}), swipe: false } };
      else if (b.stage === "rank" && deck.phase === "swiping") next = { ...deck, rankMinutes: minutes };
      else if (b.stage === "rank" && deck.phase === "ranking" && !deck.announced) next = { ...deck, rankMinutes: minutes, rankEndsAt: minutes ? Date.now() + minutes * 60e3 : null, warned: { ...(deck.warned || {}), rank: false } };
      else return send(res, 409, { error: "That step is already over." });
      await redis("SET", `deck:${code}`, JSON.stringify(next), "KEEPTTL");
      const endsAt = b.stage === "swipe" ? next.swipeEndsAt : next.phase === "ranking" ? next.rankEndsAt : null;
      if (endsAt) await scheduleTimer(code, endsAt);
      return send(res, 200, { ok: true, endsAt });
    }

    if (b.type === "rsvp") {
      if (!(deck.phase === "done" || deck.announced)) return send(res, 409, { error: "The group hasn't picked yet." });
      const going = !!b.going, key = `deck:${code}:rsvp`;
      const was = hashToObject(await redis("HGETALL", key))[playerId];
      await pipeline([["HSET", key, playerId, JSON.stringify({ name, going, at: Date.now() })], ["EXPIRE", key, TTL]]);
      // Someone saying they're going counts toward what's popping tonight (and comes back off if they drop out).
      if (!!was?.going !== going) {
        const ranks = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:ranks`)));
        const top = deck.matches.length === 1 ? deck.places.find((p) => p.id === deck.matches[0]) : winnerOf(deck, ranks);
        if (top) await pipeline(trendCmds(top, "commit", going ? 1 : -1));
        if (going) await track("rsvp", { pid: playerId, code, crew: deck.crew || "" });
      }
      return send(res, 200, { ok: true, going });
    }

    if (b.type === "remove") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can remove people." });
      const target = String(b.target || "");
      if (!PLAYER_RE.test(target) || target === playerId) return send(res, 400, { error: "Pick someone else to remove." });
      await pipeline([["HDEL", `deck:${code}:swipes`, target], ["HDEL", `deck:${code}:ranks`, target], ["HDEL", `deck:${code}:seen`, target]]);
      await bump("removed");
      // They might have been the last one everybody was waiting on.
      if (deck.phase === "ranking") await finishIfAllRanked(code, deck, playerId);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.friendly || "Something went wrong on the server. Try again." });
  }
}
