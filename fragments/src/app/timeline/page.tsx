import { prisma } from "@/lib/db";
import { getTimezone } from "@/lib/fragments";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = { web: "Web", watch: "Watch", phone: "Phone", api: "API" };

export default async function TimelinePage() {
  const [fragments, timeZone] = await Promise.all([
    prisma.fragment.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    getTimezone(),
  ]);

  const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" });
  const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

  const days: { label: string; fragments: typeof fragments }[] = [];
  for (const fragment of fragments) {
    const label = dayFormat.format(fragment.createdAt);
    const last = days[days.length - 1];
    if (last?.label === label) last.fragments.push(fragment);
    else days.push({ label, fragments: [fragment] });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Timeline</h1>
      {fragments.length === 0 && <p className="text-neutral-500">Nothing captured yet.</p>}
      {days.map((day) => (
        <section key={day.label} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{day.label}</h2>
          <ul className="flex flex-col gap-2">
            {day.fragments.map((fragment) => (
              <li key={fragment.id} className="rounded-2xl border border-white/10 bg-neutral-900 p-4">
                <p className="whitespace-pre-wrap text-lg">{fragment.rawText}</p>
                <div className="mt-2 flex gap-3 text-sm text-neutral-500">
                  <span>{timeFormat.format(fragment.createdAt)}</span>
                  <span>{SOURCE_LABEL[fragment.source] ?? fragment.source}</span>
                  <span>{fragment.error ? "Error" : fragment.processedAt ? "Organized" : "Not organized yet"}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
