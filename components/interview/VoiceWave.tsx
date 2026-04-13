"use client";

interface VoiceWaveProps {
  /** Whether Gemini is currently speaking */
  isActive?: boolean;
  /** Label for screen readers */
  label?: string;
}

const BAR_ANIMATIONS = [
  "animate-voice-bar-1",
  "animate-voice-bar-4",
  "animate-voice-bar-2",
  "animate-voice-bar-5",
  "animate-voice-bar-3",
];

const BAR_HEIGHTS = [
  "h-3",
  "h-5",
  "h-7",
  "h-5",
  "h-3",
];

export default function VoiceWave({
  isActive = false,
  label = "Gemini está hablando",
}: VoiceWaveProps) {
  return (
    <div
      role="status"
      aria-label={isActive ? label : "Silencio"}
      className="flex items-center justify-center gap-1 h-8"
    >
      {BAR_ANIMATIONS.map((anim, i) => (
        <span
          key={i}
          className={`
            inline-block w-1 rounded-full origin-bottom
            bg-beige/50
            transition-opacity duration-500
            ${BAR_HEIGHTS[i]}
            ${isActive ? anim : "opacity-20 !animate-none scale-y-30"}
          `}
          style={{ opacity: isActive ? undefined : 0.2 }}
        />
      ))}
    </div>
  );
}
