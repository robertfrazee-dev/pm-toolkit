"use server";

import { revalidatePath } from "next/cache";
import { saveFragment } from "@/lib/fragments";

export type CaptureResult = { ok: true; id: string } | { ok: false; error: string };

export async function captureFragment(text: string): Promise<CaptureResult> {
  try {
    const fragment = await saveFragment(text, "web");
    revalidatePath("/timeline");
    return { ok: true, id: fragment.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save" };
  }
}
