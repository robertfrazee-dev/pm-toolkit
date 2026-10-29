import { CaptureForm } from "@/components/CaptureForm";

export default function CapturePage() {
  return (
    <div className="flex flex-col gap-8 pt-6">
      <h1 className="text-center text-2xl font-semibold text-neutral-300">What&apos;s on your mind?</h1>
      <CaptureForm />
    </div>
  );
}
