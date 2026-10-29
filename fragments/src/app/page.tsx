import { redirect } from "next/navigation";

// Today view arrives in Phase 3; until then, home is Capture.
export default function Home() {
  redirect("/capture");
}
