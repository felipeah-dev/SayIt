"use client";

import { useEffect, useState } from "react";

interface CeremonialRevealProps {
  /** Called when the user clicks "Estoy listo/lista" */
  onReady: () => void;
  /** Name of the sender, if available */
  senderName?: string;
}

type Phase =
  | "black"          // 0–1s: silence
  | "text-in"        // 1–3s: fade in text
  | "text-hold"      // 3–6s: text visible
  | "text-out"       // 6–7.5s: fade out
  | "name-in"        // 7.5–9s: sender name or "Una persona que te quiere"
  | "name-hold"      // 9–12s: name visible
  | "pause-hold"     // 12–15s: breath moment
  | "prompt-in"      // 15s+: final prompt + button
  | "ready";         // user clicked

const PHASE_DURATIONS: Record<Exclude<Phase, "ready">, number> = {
  black: 1000,
  "text-in": 2000,
  "text-hold": 3000,
  "text-out": 1500,
  "name-in": 1500,
  "name-hold": 3000,
  "pause-hold": 3000,
  "prompt-in": 0, // stays until user clicks
};

export default function CeremonialReveal({
  onReady,
  senderName,
}: CeremonialRevealProps) {
  const [phase, setPhase] = useState<Phase>("black");

  useEffect(() => {
    const phases: Exclude<Phase, "ready">[] = [
      "black",
      "text-in",
      "text-hold",
      "text-out",
      "name-in",
      "name-hold",
      "pause-hold",
      "prompt-in",
    ];

    let timeout: ReturnType<typeof setTimeout>;
    let currentIndex = 0;

    function advance() {
      currentIndex++;
      if (currentIndex < phases.length) {
        const nextPhase = phases[currentIndex];
        setPhase(nextPhase);
        const duration = PHASE_DURATIONS[nextPhase];
        if (duration > 0) {
          timeout = setTimeout(advance, duration);
        }
      }
    }

    // Start the sequence
    timeout = setTimeout(advance, PHASE_DURATIONS.black);

    return () => clearTimeout(timeout);
  }, []);

  const handleReady = () => {
    setPhase("ready");
    onReady();
  };

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      {/* Opening phrase */}
      <div
        aria-live="polite"
        className={`
          absolute inset-0 flex items-center justify-center px-8
          transition-opacity duration-[2000ms] ease-in-out
          ${
            phase === "text-in" || phase === "text-hold"
              ? "opacity-100"
              : "opacity-0"
          }
        `}
      >
        <p className="font-serif text-display-md text-white text-center leading-snug max-w-reading">
          Someone wanted<br />you to hear this.
        </p>
      </div>

      {/* Sender name or generic phrase */}
      <div
        aria-live="polite"
        className={`
          absolute inset-0 flex flex-col items-center justify-center px-8 gap-6
          transition-opacity duration-[1500ms] ease-in-out
          ${
            phase === "name-in" || phase === "name-hold" || phase === "pause-hold"
              ? "opacity-100"
              : "opacity-0"
          }
        `}
      >
        <p className="font-sans text-sm uppercase tracking-[0.2em] text-white/40">
          De parte de
        </p>
        <p className="font-serif text-display-sm text-white text-center italic">
          {senderName ?? "Una persona que te quiere"}
        </p>
      </div>

      {/* Final prompt + CTA */}
      <div
        className={`
          absolute inset-0 flex flex-col items-center justify-center px-8 gap-10
          transition-opacity duration-[1500ms] ease-in-out
          ${phase === "prompt-in" || phase === "ready" ? "opacity-100" : "opacity-0"}
        `}
      >
        <p className="font-serif text-display-sm text-white text-center max-w-narrow leading-relaxed">
          Tómate un momento.<br />
          <span className="text-white/60 text-body-lg not-italic font-sans font-light mt-2 block">
            Este mensaje vino desde muy adentro.
          </span>
        </p>

        <button
          onClick={handleReady}
          disabled={phase !== "prompt-in"}
          className={`
            font-sans text-body-sm font-medium
            px-10 py-4 rounded-pill
            border border-white/20
            text-white/80
            bg-white/5 backdrop-blur-sm
            hover:bg-white/10 hover:text-white hover:border-white/40
            active:scale-95
            transition-all duration-300
            disabled:opacity-0 disabled:cursor-default
            focus-visible:outline-white
          `}
        >
          Estoy listo
        </button>
      </div>
    </div>
  );
}
