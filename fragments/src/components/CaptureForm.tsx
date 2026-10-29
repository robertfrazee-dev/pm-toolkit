"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { captureFragment } from "@/app/actions";

// Minimal typing for the browser Web Speech API (not in TS's DOM lib).
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function CaptureForm() {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Text that existed before dictation started, so new speech appends to it.
  const baseTextRef = useRef("");

  useEffect(() => {
    setSpeechSupported(getRecognition() !== null);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  function startListening() {
    const recognition = getRecognition();
    if (!recognition) return;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    baseTextRef.current = text.trim() ? text.trim() + " " : "";
    let finalText = "";

    recognition.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      setText(baseTextRef.current + finalText.trim());
      setInterim(interimText);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setToast({ kind: "error", message: `Mic error: ${event.error}` });
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function save() {
    const value = text.trim();
    if (!value || pending) return;
    stopListening();
    startTransition(async () => {
      const result = await captureFragment(value);
      if (result.ok) {
        setText("");
        setInterim("");
        setToast({ kind: "ok", message: "Saved" });
      } else {
        setToast({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {speechSupported ? (
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          aria-pressed={listening}
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          className={`flex h-40 w-40 items-center justify-center rounded-full text-6xl transition ${
            listening
              ? "animate-pulse bg-red-600 shadow-[0_0_60px_rgba(220,38,38,0.5)]"
              : "bg-neutral-800 hover:bg-neutral-700 active:scale-95"
          }`}
        >
          <MicIcon />
        </button>
      ) : (
        <p className="text-sm text-neutral-500">Dictation isn&apos;t supported in this browser. Type instead.</p>
      )}

      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <textarea
          value={interim ? `${text} ${interim}`.trim() : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          readOnly={listening}
          rows={4}
          placeholder="Say or type anything…"
          className="w-full resize-none rounded-2xl border border-white/10 bg-neutral-900 p-4 text-lg placeholder:text-neutral-600 focus:border-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || pending}
          className="rounded-2xl bg-white py-4 text-lg font-semibold text-neutral-950 transition disabled:opacity-30"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 flex justify-center sm:bottom-10">
        {toast && (
          <div
            className={`rounded-full px-5 py-3 text-base font-medium shadow-lg ${
              toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-16 w-16" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}
