"use client";

import { useState } from "react";

interface EmotionalCheckInProps {
  /** Called with the chosen emotional state when the user selects one */
  onComplete: (state: string) => void;
  /** Called when the user chooses "Otro momento" */
  onDefer?: () => void;
}

interface EmotionOption {
  value: string;
  label: string;
  description: string;
}

const EMOTIONS: EmotionOption[] = [
  {
    value: "calm",
    label: "Con calma",
    description: "Me siento sereno/a y listo/a",
  },
  {
    value: "nostalgic",
    label: "Con nostalgia",
    description: "Recuerdo con cariño",
  },
  {
    value: "love",
    label: "Con amor",
    description: "El corazón lleno",
  },
  {
    value: "sad",
    label: "Con tristeza",
    description: "Necesito escucharlo igual",
  },
];

const DEFER_OPTION = {
  value: "defer",
  label: "Otro momento",
  description: "Vuelvo cuando esté listo/a",
};

export default function EmotionalCheckIn({
  onComplete,
  onDefer,
}: EmotionalCheckInProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isDeferred, setIsDeferred] = useState(false);

  const handleSelect = (value: string) => {
    if (value === DEFER_OPTION.value) {
      setIsDeferred(true);
      onDefer?.();
      return;
    }
    setSelected(value);
    // Small delay so the selection registers visually before transitioning
    setTimeout(() => onComplete(value), 500);
  };

  if (isDeferred) {
    return (
      <div className="min-h-screen bg-beige flex items-center justify-center px-6">
        <div className="text-center max-w-narrow animate-fade-in-up">
          <p className="font-serif text-display-sm text-texto-principal italic mb-6">
            Cuando estés listo,
          </p>
          <p className="font-sans text-body-md text-texto-suave mb-12">
            el mensaje te espera aquí.
          </p>
          <button
            onClick={() => {
              setIsDeferred(false);
              setSelected(null);
            }}
            className="font-sans text-body-sm text-terracota hover:text-terracota-light transition-colors duration-300 underline underline-offset-4 decoration-terracota/30"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-beige flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-reading animate-fade-in">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="font-serif text-display-sm text-texto-principal italic leading-relaxed mb-4">
            Antes de abrir de nuevo,
          </p>
          <p className="font-sans text-body-lg text-texto-suave">
            ¿cómo estás ahora mismo?
          </p>
        </div>

        {/* Emotion cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {EMOTIONS.map((emotion) => (
            <button
              key={emotion.value}
              onClick={() => handleSelect(emotion.value)}
              className={`
                group text-left p-6 rounded-card
                border transition-all duration-300
                focus-visible:ring-2 focus-visible:ring-terracota focus-visible:ring-offset-2
                ${
                  selected === emotion.value
                    ? "bg-terracota text-white border-terracota shadow-md scale-[1.02]"
                    : "bg-white/60 border-beige-dark hover:border-terracota/40 hover:bg-white/80 hover:shadow-sm"
                }
              `}
            >
              <p
                className={`font-serif text-xl mb-1 transition-colors duration-300 ${
                  selected === emotion.value
                    ? "text-white"
                    : "text-texto-principal group-hover:text-terracota"
                }`}
              >
                {emotion.label}
              </p>
              <p
                className={`font-sans text-sm transition-colors duration-300 ${
                  selected === emotion.value
                    ? "text-white/70"
                    : "text-texto-muted"
                }`}
              >
                {emotion.description}
              </p>
            </button>
          ))}
        </div>

        {/* Defer option */}
        <div className="text-center mt-8">
          <button
            onClick={() => handleSelect(DEFER_OPTION.value)}
            className="font-sans text-sm text-texto-muted hover:text-texto-suave transition-colors duration-300"
          >
            {DEFER_OPTION.label} — {DEFER_OPTION.description}
          </button>
        </div>
      </div>
    </div>
  );
}
