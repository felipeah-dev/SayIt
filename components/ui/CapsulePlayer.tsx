"use client";

import { useEffect, useRef, useState } from "react";

interface CapsulePlayerProps {
  videoUrl: string;
  onEnded?: () => void;
  /** In first opening: no controls, fullscreen, no pause */
  isFirstOpening?: boolean;
}

export default function CapsulePlayer({
  videoUrl,
  onEnded,
  isFirstOpening = false,
}: CapsulePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showControls, setShowControls] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showUnmuteHint, setShowUnmuteHint] = useState(false);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Attempt autoplay, handle muted fallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Try unmuted first
    video.muted = false;
    const playPromise = video.play();

    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsMuted(false);
          setShowUnmuteHint(false);
        })
        .catch(() => {
          // Browser blocked unmuted autoplay — mute and retry
          video.muted = true;
          setIsMuted(true);
          setShowUnmuteHint(true);
          void video.play().catch(() => {
            // autoplay fully blocked — show a subtle play prompt
          });
        });
    }
  }, [videoUrl]);

  // Hide controls after inactivity (only for re-openings)
  const handleMouseMove = () => {
    if (isFirstOpening) return;
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  };

  // Clean up timer
  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

  const handleUnmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setIsMuted(false);
    setShowUnmuteHint(false);
  };

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden"
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-contain"
        playsInline
        onEnded={onEnded}
        controls={!isFirstOpening && showControls}
        aria-label="Video del mensaje"
      />

      {/* Unmute hint — only if autoplay required muting */}
      {showUnmuteHint && (
        <button
          onClick={handleUnmute}
          className={`
            absolute bottom-6 right-6
            flex items-center gap-2
            bg-black/60 backdrop-blur-sm
            text-white/80 text-sm font-sans
            px-4 py-2 rounded-pill
            border border-white/15
            hover:bg-black/80 hover:text-white
            transition-all duration-300
            animate-fade-in
          `}
          aria-label="Activar sonido"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            {isMuted ? (
              <>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                />
              </>
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
              />
            )}
          </svg>
          Activar sonido
        </button>
      )}
    </div>
  );
}
