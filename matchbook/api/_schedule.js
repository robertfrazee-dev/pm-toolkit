// Wakes a deck up at a set time (2-minute warning, time's up) through Upstash QStash, so reminders go out
// even when nobody has the app open. Needs QSTASH_TOKEN. Without it, timers still run whenever anyone in the
// deck has Matchbook open (every refresh checks the clock), but pushes can't arrive while everyone's away.
export const schedulerOn = () => !!process.env.QSTASH_TOKEN;

const site = () => process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export async function scheduleTick(code, at) {
  if (!schedulerOn() || !site()) return;
  const delay = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  try {
    const r = await fetch(`${process.env.QSTASH_URL || "https://qstash.upstash.io"}/v2/publish/${site()}/api/action`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}`, "Content-Type": "application/json", "Upstash-Delay": `${delay}s`, "Upstash-Retries": "2" },
      body: JSON.stringify({ type: "tick", code }),
    });
    if (!r.ok) console.error("qstash", r.status, await r.text().catch(() => ""));
  } catch (e) { console.error("qstash", e); }
}

// The two wake-ups for a timer: two minutes before it ends (if there's time for that) and when it ends.
export async function scheduleTimer(code, endsAt) {
  if (!endsAt) return;
  if (endsAt - Date.now() > 150e3) await scheduleTick(code, endsAt - 120e3);
  await scheduleTick(code, endsAt + 1000);
}
