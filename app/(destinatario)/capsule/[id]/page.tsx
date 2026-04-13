"use client";

/**
 * /app/(destinatario)/capsule/[id]/page.tsx
 *
 * The recipient's experience. Three possible states:
 *   A) Capsule not yet available (delivery_date in the future, not sealed)
 *   B) First opening — full ceremonial sequence
 *   C) Re-opening — emotional check-in first, then capsule
 *
 * Security: The server API enforces delivery_date and sealed_at.
 * This client verifies the same conditions and shows appropriate UI.
 * The emotional check-in cannot be skipped because POST /api/capsule/[id]/open
 * enforces it server-side for re-openings.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import CeremonialReveal from "@/components/ceremonial/CeremonialReveal";
import EmotionalCheckIn from "@/components/ceremonial/EmotionalCheckIn";
import CapsulePlayer from "@/components/ui/CapsulePlayer";

// ============================================================
// Types
// ============================================================

interface CapsuleData {
  id: string;
  recipient_name: string;
  video_url: string | null;
  message_text: string | null;
  delivery_type: "immediate" | "date" | "posthumous" | null;
  delivery_date: string | null;
  sealed_at: string | null;
}

interface OpenResponse {
  is_first_opening: boolean;
  opening: { id: string; emotional_state: string | null };
  requires_emotional_checkin?: boolean;
}

type ViewState =
  | "loading"
  | "not-found"
  | "not-sealed"
  | "not-ready"            // delivery_date in the future
  | "check-delivery"       // Checking openings count
  | "ceremonial"           // First opening: ceremonial reveal
  | "emotional-checkin"    // Re-opening: emotional check-in
  | "video"                // Video playing
  | "message"              // Written message
  | "error";

// ============================================================
// Message display component
// ============================================================

interface MessageDisplayProps {
  text: string;
  capsuleId: string;
  videoUrl: string | null;
}

function MessageDisplay({ text, capsuleId, videoUrl }: MessageDisplayProps) {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);

  const handleDownloadText = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mensaje-${capsuleId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-beige flex flex-col items-center px-6 py-20">
      <article className="w-full max-w-reading space-y-0 animate-fade-in-slow">
        {/* Ornament */}
        <div className="flex items-center justify-center mb-14">
          <div className="w-12 h-px bg-terracota/30" />
          <div className="w-1.5 h-1.5 rounded-full bg-terracota/40 mx-3" />
          <div className="w-12 h-px bg-terracota/30" />
        </div>

        {/* Paragraphs — staggered fade in */}
        <div className="space-y-7">
          {paragraphs.map((para, i) => (
            <p
              key={i}
              className="font-serif text-body-lg text-texto-principal leading-[1.85] animate-fade-in-up"
              style={{ animationDelay: `${i * 400}ms`, animationFillMode: "both" }}
            >
              {para}
            </p>
          ))}
        </div>

        {/* Bottom ornament */}
        <div className="flex items-center justify-center mt-16">
          <div className="w-8 h-px bg-terracota/20" />
        </div>
      </article>

      {/* Downloads — unobtrusive, at the very bottom */}
      <div className="mt-20 flex flex-col items-center gap-4 animate-fade-in" style={{ animationDelay: "2000ms", animationFillMode: "both" }}>
        <p className="font-sans text-xs uppercase tracking-[0.15em] text-texto-muted">
          Guardar como recuerdo
        </p>
        <div className="flex items-center gap-4">
          {videoUrl && (
            <a
              href={videoUrl}
              download={`video-${capsuleId}.mp4`}
              className="font-sans text-sm text-texto-suave border border-beige-dark rounded-pill px-5 py-2.5 hover:border-terracota/30 hover:text-terracota transition-all duration-300"
            >
              Video
            </a>
          )}
          <button
            onClick={handleDownloadText}
            className="font-sans text-sm text-texto-suave border border-beige-dark rounded-pill px-5 py-2.5 hover:border-terracota/30 hover:text-terracota transition-all duration-300"
          >
            Texto
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main page
// ============================================================

export default function CapsulePage() {
  const params = useParams();
  const capsuleId = typeof params.id === "string" ? params.id : null;

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [capsule, setCapsule] = useState<CapsuleData | null>(null);
  const [isFirstOpening, setIsFirstOpening] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Fetch capsule and determine initial state ──────────────
  useEffect(() => {
    if (!capsuleId) {
      setViewState("not-found");
      return;
    }

    const init = async () => {
      try {
        const res = await fetch(`/api/capsule/${capsuleId}`);

        if (res.status === 404) {
          setViewState("not-found");
          return;
        }

        if (res.status === 403) {
          const data = (await res.json()) as { delivery_date?: string };
          if (data.delivery_date) {
            setViewState("not-ready");
          } else {
            setViewState("not-sealed");
          }
          return;
        }

        if (!res.ok) {
          setErrorMessage(
            "No pudimos cargar este mensaje. El enlace puede ser incorrecto."
          );
          setViewState("error");
          return;
        }

        const data = (await res.json()) as CapsuleData;

        if (!data.sealed_at) {
          setViewState("not-sealed");
          return;
        }

        // Check delivery date
        if (
          data.delivery_type === "date" &&
          data.delivery_date &&
          new Date(data.delivery_date) > new Date()
        ) {
          setViewState("not-ready");
          return;
        }

        setCapsule(data);
        setViewState("check-delivery");
      } catch {
        setErrorMessage(
          "Algo salió mal al cargar el mensaje. Está aquí cuando estés listo."
        );
        setViewState("error");
      }
    };

    void init();
  }, [capsuleId]);

  // ── Record the opening and determine first/re-opening ─────
  useEffect(() => {
    if (viewState !== "check-delivery" || !capsuleId) return;

    const checkOpening = async () => {
      try {
        // Try to open without emotional state first — server tells us if check-in needed
        const res = await fetch(`/api/capsule/${capsuleId}/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (res.status === 422) {
          // Server requires emotional check-in (re-opening)
          setIsFirstOpening(false);
          setViewState("emotional-checkin");
          return;
        }

        if (!res.ok) {
          // Treat as a soft error — show ceremonial anyway
          console.warn("[CapsulePage] Open registration failed");
          setIsFirstOpening(true);
          setViewState("ceremonial");
          return;
        }

        const data = (await res.json()) as OpenResponse;
        setIsFirstOpening(data.is_first_opening);
        setViewState(data.is_first_opening ? "ceremonial" : "video");
      } catch {
        // Soft failure — proceed with ceremonial
        setIsFirstOpening(true);
        setViewState("ceremonial");
      }
    };

    void checkOpening();
  }, [viewState, capsuleId]);

  // ── Handle emotional check-in completion ──────────────────
  const handleCheckInComplete = useCallback(
    async (emotionalState: string) => {
      if (!capsuleId) return;

      try {
        await fetch(`/api/capsule/${capsuleId}/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emotional_state: emotionalState }),
        });
      } catch {
        // Non-blocking — continue to video
      }

      setViewState("video");
    },
    [capsuleId]
  );

  const handleCeremonialReady = useCallback(() => {
    setViewState("video");
  }, []);

  const handleVideoEnded = useCallback(() => {
    setViewState("message");
  }, []);

  // ── Render ─────────────────────────────────────────────────

  if (viewState === "loading" || viewState === "check-delivery") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
      </div>
    );
  }

  if (viewState === "not-found") {
    return (
      <div className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-narrow space-y-6 animate-fade-in-up">
          <p className="font-serif text-display-sm text-texto-principal italic">
            Este enlace no existe.
          </p>
          <p className="font-sans text-body-sm text-texto-muted">
            Asegúrate de que el enlace sea exactamente el que recibiste.
          </p>
        </div>
      </div>
    );
  }

  if (viewState === "not-sealed") {
    return (
      <div className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-narrow space-y-6 animate-fade-in-up">
          <p className="font-serif text-display-sm text-texto-principal italic">
            Este mensaje aún no está listo para ti.
          </p>
          <p className="font-sans text-body-sm text-texto-muted">
            Quien lo creó todavía lo está preparando con cuidado. Vuelve más
            tarde.
          </p>
        </div>
      </div>
    );
  }

  if (viewState === "not-ready") {
    return (
      <div className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-narrow space-y-6 animate-fade-in-up">
          <p className="font-serif text-display-sm text-texto-principal italic">
            Todavía no es el momento.
          </p>
          <p className="font-sans text-body-sm text-texto-muted">
            Este mensaje llegará cuando sea el momento justo. Aquí estará
            esperándote.
          </p>
        </div>
      </div>
    );
  }

  if (viewState === "error") {
    return (
      <div className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-narrow space-y-6 animate-fade-in-up">
          <p className="font-serif text-display-sm text-texto-principal italic">
            Algo salió mal.
          </p>
          <p className="font-sans text-body-sm text-texto-muted">
            {errorMessage ??
              "No pudimos cargar este mensaje. El enlace puede ser incorrecto o el mensaje aún no está disponible."}
          </p>
          <p className="font-sans text-xs text-texto-muted">
            Si crees que esto es un error, intenta recargar la página.
          </p>
        </div>
      </div>
    );
  }

  if (viewState === "ceremonial") {
    return (
      <CeremonialReveal
        onReady={handleCeremonialReady}
        senderName={undefined}
      />
    );
  }

  if (viewState === "emotional-checkin") {
    return (
      <EmotionalCheckIn
        onComplete={(state) => void handleCheckInComplete(state)}
        onDefer={() => {
          // Stay on this page — show the deferred message inside EmotionalCheckIn
        }}
      />
    );
  }

  if (viewState === "video" && capsule?.video_url) {
    return (
      <div className="fixed inset-0 bg-black">
        <CapsulePlayer
          videoUrl={capsule.video_url}
          onEnded={handleVideoEnded}
          isFirstOpening={isFirstOpening}
        />
      </div>
    );
  }

  if (viewState === "video" && !capsule?.video_url) {
    // No video available — skip to message
    setViewState("message");
    return null;
  }

  if (viewState === "message" && capsule?.message_text) {
    return (
      <MessageDisplay
        text={capsule.message_text}
        capsuleId={capsule.id}
        videoUrl={capsule.video_url}
      />
    );
  }

  // Fallback
  return (
    <div className="min-h-screen bg-beige flex items-center justify-center px-6">
      <p className="font-sans text-body-sm text-texto-muted text-center">
        Cargando tu mensaje…
      </p>
    </div>
  );
}
