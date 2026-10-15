// Tier It: tap S, A, B, C or D on a place (or ♥ want to try, or skip). Your tiers make your own ranking; a crew's
// tiers merged make the crew's ranking. Places someone has actually checked in at count double in the crew's merge.
// Kept per person by Google place ID (allowed) plus the tier.
import { redis, pipeline, hashToObject } from "./_lib.js";
import { memberPids } from "./_crew.js";

export const TIERS = ["S", "A", "B", "C", "D"];
export const VALUE = { S: 5, A: 4, B: 3, C: 2, D: 1 };
export const MARKS = [...TIERS, "want", "skip"];
const KEEP = 400 * 86400;
export const tierOf = (v) => (v >= 4.5 ? "S" : v >= 3.5 ? "A" : v >= 2.5 ? "B" : v >= 1.5 ? "C" : "D");
const key = (pid, slug) => `tier:${pid}:${slug}`;

// One person's marks on one list: { gid: { t, at } }.
export async function marksOf(pid, slug) {
  const h = hashToObject(await redis("HGETALL", key(pid, slug)));
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v?.t)); // hashToObject already parsed each entry
}
export async function setMark(pid, slug, gid, t) {
  if (t === "clear") return pipeline([["HDEL", key(pid, slug), gid]]);
  return pipeline([["HSET", key(pid, slug), gid, JSON.stringify({ t, at: Date.now() })], ["EXPIRE", key(pid, slug), KEEP], ["SADD", `tierslugs:${pid}`, slug], ["EXPIRE", `tierslugs:${pid}`, KEEP]]);
}
export async function checkedIn(pids) {
  const rows = await pipeline(pids.map((p) => ["ZRANGE", `ci:places:${p}`, 0, -1]));
  return pids.map((_, i) => new Set(rows[i] || []));
}

// A crew's merged tier list on one category, plus its hottest take and what it says you should try.
export async function crewTier(crew, slug, me = "") {
  const people = Object.values(crew.members).map((m) => ({ name: m.name, pids: m.pids, me: m.pids.includes(me) }));
  const pids = people.flatMap((p) => p.pids);
  if (!pids.length) return { list: [], hotTake: null, sayGo: [] };
  const rows = await pipeline(pids.map((p) => ["HGETALL", key(p, slug)]));
  const been = await checkedIn(pids);
  const byPid = Object.fromEntries(pids.map((p, i) => [p, { marks: hashToObject(rows[i]), been: been[i] }]));
  // Each person counts once per place (their latest mark across their devices).
  const votes = {}; // gid → [{ name, me, v, been }]
  const wants = {};
  for (const person of people) {
    const latest = {}, wasThere = new Set();
    for (const p of person.pids) {
      for (const [g, m] of Object.entries(byPid[p].marks)) { if (!m?.t) continue; if (!latest[g] || m.at > latest[g].at) latest[g] = m; }
      byPid[p].been.forEach((g) => wasThere.add(g));
    }
    for (const [g, m] of Object.entries(latest)) {
      if (VALUE[m.t]) (votes[g] ||= []).push({ name: person.name, me: person.me, v: VALUE[m.t], t: m.t, been: wasThere.has(g) });
      else if (m.t === "want") (wants[g] ||= []).push(person.name);
    }
  }
  const list = Object.entries(votes).map(([gid, vs]) => {
    const w = vs.reduce((a, x) => a + (x.been ? 2 : 1), 0), avg = vs.reduce((a, x) => a + x.v * (x.been ? 2 : 1), 0) / w;
    return { gid, avg: Math.round(avg * 100) / 100, tier: tierOf(avg), n: vs.length, been: vs.filter((x) => x.been).length, votes: vs };
  }).sort((a, b) => b.avg - a.avg || b.n - a.n);
  // Hot take: the biggest gap between one person and everyone else (two tiers or more, with at least two others).
  let hotTake = null;
  for (const row of list) {
    if (row.votes.length < 3) continue;
    for (const x of row.votes) {
      const others = row.votes.filter((o) => o !== x), mean = others.reduce((a, o) => a + o.v, 0) / others.length, gap = Math.abs(x.v - mean);
      if (gap >= 2 && (!hotTake || gap > hotTake.gap)) hotTake = { gid: row.gid, name: x.name, me: x.me, theirs: x.t, crew: tierOf(mean), gap };
    }
  }
  // Your crew says go: places the crew puts in S or A that you haven't tiered or been to (a ♥ want-to-try still shows).
  const mine = people.find((p) => p.me);
  const myBeen = new Set(mine ? mine.pids.flatMap((p) => [...byPid[p].been]) : []);
  const sayGo = list.filter((r) => r.avg >= 3.5 && r.votes.filter((v) => !v.me).length >= 1 && !myBeen.has(r.gid) && !r.votes.some((v) => v.me)).slice(0, 5).map((r) => ({ gid: r.gid, tier: r.tier, by: r.votes.filter((v) => !v.me).map((v) => v.name) }));
  return { list: list.map(({ votes, ...r }) => ({ ...r, people: votes.map((v) => ({ name: v.name, t: v.t, been: v.been, me: v.me })) })), hotTake, sayGo, wants: Object.entries(wants).map(([gid, names]) => ({ gid, names })) };
}
