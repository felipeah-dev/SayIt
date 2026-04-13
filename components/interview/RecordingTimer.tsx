"use client";

import { useEffect, useRef, useState } from "react";

interface RecordingTimerProps {
  /** Maximum duration in seconds. Default: 720 (12 minutes) */
  maxDuration?: number;
  /** Called when the timer reaches maxDuration */
  onTimeUp?: () => void;
  /** Whether the timer is active */
  isActive?: boolean;
}

const DEFAULT_MAX = 720; // 12 minutes

export default function RecordingTimer({
  maxDuration = DEFAULT_MAX,
  onTimeUp,
  isActive = true,
}: RecordingTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeUpRef = useRef(onTimeUp);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= maxDuration) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onTimeUpRef.current?.();
          return maxDuration;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, maxDuration]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const progress = elapsed / maxDuration;
  const remaining = maxDuration - elapsed;
  const remainingMinutes = Math.floor(remaining / 60);
  const remainingSeconds = remaining % 60;

  // SVG circle parameters
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  // Color transitions: beige → terracota as time runs out
  const isNearEnd = remaining <= 120; // last 2 minutes

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Circular progress ring */}
      <div className="relative w-32 h-32">
        <svg
          className="w-full h-full -rotate-90"
          viewBox="0 0 120 120"
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="rgba(245, 240, 232, 0.1)"
            strokeWidth="4"
          />
          {/* Progress */}
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={isNearEnd ? "#C4704A" : "#8B4513"}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>

        {/* Time display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-sans text-2xl font-light tabular-nums leading-none ${
              isNearEnd
                ? "text-terracota-light animate-timer-pulse"
                : "text-beige/80"
            }`}
          >
            {String(minutes).padStart(2, "0")}:
            {String(seconds).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Remaining time label */}
      <p className="font-sans text-sm text-beige/40 tabular-nums">
        {remainingMinutes > 0
          ? `${remainingMinutes}m ${String(remainingSeconds).padStart(2, "0")}s restantes`
          : `${remainingSeconds}s restantes`}
      </p>
    </div>
  );
}
