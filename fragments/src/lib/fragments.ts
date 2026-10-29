import { prisma } from "@/lib/db";

export const FRAGMENT_SOURCES = ["web", "watch", "phone", "api"] as const;
export type FragmentSource = (typeof FRAGMENT_SOURCES)[number];

export const MAX_FRAGMENT_LENGTH = 5000;

/**
 * The single entry point for every captured thought. Saves the raw text
 * immediately so nothing is lost, even if organizing fails later.
 */
export async function saveFragment(rawText: string, source: FragmentSource = "web") {
  const text = rawText.trim();
  if (!text) throw new Error("Fragment is empty");
  if (text.length > MAX_FRAGMENT_LENGTH) throw new Error("Fragment is too long");
  return prisma.fragment.create({ data: { rawText: text, source } });
}

export async function getTimezone() {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  return settings?.timezone ?? "America/New_York";
}
