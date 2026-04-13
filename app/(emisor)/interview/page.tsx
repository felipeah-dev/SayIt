"use client";

/**
 * /app/(emisor)/interview/page.tsx
 *
 * CRITICAL RULE: The sender's video is NEVER rendered.
 * The camera captures for LiveKit recording, but the local video track
 * is NEVER attached to any element. `attach()` is NEVER called on it.
 * The sender does not see themselves during recording.
 *
 * Audio flows: Browser mic → LiveKit room (for recording)
 *              Gemini Live sends voice responses → played in browser
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LiveKitRoom,
  useLocalParticipant,
  RoomAudioRenderer,
} from "@livekit/components-react";
import RecordingTimer from "@/components/interview/RecordingTimer";
import VoiceWave from "@/components/interview/VoiceWave";

// ============================================================
// Types
// ============================================================

interface GeminiSessionResponse {
  session_id: string;
  websocket_url?: string;
}

interface LiveKitTokenResponse {
  token: string;
  room: string;
}

// ============================================================
// Inner component — rendered inside LiveKitRoom context
// ============================================================

interface InterviewRoomInnerProps {
  capsuleId: string;
  onFinish: (transcript: string) => void;
}

function InterviewRoomInner({ capsuleId, onFinish }: InterviewRoomInnerProps) {
  const { localParticipant } = useLocalParticipant();
  const [isGeminiSpeaking, setIsGeminiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [isTimerActive, setIsTimerActive] = useState(true);
  const [isEnding, setIsEnding] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // CRITICAL: We publish ONLY audio — never attach or render the video track.
  // We enable the camera solely so LiveKit can record the sender's video
  // server-side, but we never call attach() on the local video track.
  useEffect(() => {
    if (!localParticipant) return;

    // Enable microphone for voice interview
    void localParticipant.setMicrophoneEnabled(true);

    // Enable camera ONLY for remote recording — NEVER render locally.
    // The track is published to the room but never attached to the DOM.
    void localParticipant.setCameraEnabled(true);

    // IMPORTANT: We intentionally do NOT subscribe to localParticipant's
    // video track publications here. No element ever receives videoTrack.attach().
  }, [localParticipant]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const handleTimeUp = useCallback(() => {
    if (!isEnding) handleEnd();
  }, [isEnding]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    if (isEnding) return;
    setIsEnding(true);
    setIsTimerActive(false);
    const fullTranscript = transcript.join("\n");
    onFinish(fullTranscript);
  }, [isEnding, transcript, onFinish]);

  // Simulate incoming Gemini transcript lines (real integration via Gemini Live WS)
  // The actual websocket events would call setTranscript and setIsGeminiSpeaking
  const addTranscriptLine = useCallback((line: string) => {
    setTranscript((prev) => [...prev, line]);
  }, []);
  // Expose for future WS integration
  void addTranscriptLine;

  return (
    <div className="flex flex-col items-center justify-between h-full py-12 px-6 gap-8">
      {/* Top — Timer */}
      <div className="flex flex-col items-center gap-4">
        <p className="font-sans text-xs uppercase tracking-[0.2em] text-beige/30">
          Entrevista en curso
        </p>
        <RecordingTimer
          maxDuration={720}
          isActive={isTimerActive}
          onTimeUp={handleTimeUp}
        />
      </div>

      {/* Center — Voice feedback */}
      <div className="flex flex-col items-center gap-6 flex-1 justify-center w-full max-w-reading">
        <VoiceWave isActive={isGeminiSpeaking} label="Escuchando la pregunta" />

        {/* Transcript display — subtle, not protagonist */}
        {transcript.length > 0 && (
          <div className="w-full max-h-48 overflow-y-auto">
            <div className="space-y-3 px-2">
              {transcript.map((line, i) => (
                <p
                  key={i}
                  className="font-sans text-sm text-beige/40 leading-relaxed text-center"
                >
                  {line}
                </p>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {transcript.length === 0 && (
          <p className="font-sans text-sm text-beige/25 text-center animate-breathe">
            Habla con calma. No hay prisa.
          </p>
        )}
      </div>

      {/* Bottom — End button */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={handleEnd}
          disabled={isEnding}
          className={`
            font-sans text-sm font-medium
            px-8 py-3 rounded-pill
            border border-beige/15
            text-beige/50
            bg-transparent
            hover:border-beige/30 hover:text-beige/70
            active:scale-95
            disabled:opacity-30 disabled:cursor-not-allowed
            transition-all duration-300
          `}
        >
          {isEnding ? "Guardando tu historia…" : "Terminar"}
        </button>
        <p className="font-sans text-xs text-beige/20">
          Puedes terminar cuando sientas que ya dijiste lo que querías.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Main page component
// ============================================================

type PageState =
  | "loading"         // Fetching LiveKit token + Gemini session
  | "ready"           // Room connected, interview active
  | "finishing"       // Saving transcript, navigating away
  | "error";

export default function InterviewPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string>("");
  const [capsuleId, setCapsuleId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize the room
  useEffect(() => {
    const storedId = sessionStorage.getItem("capsule_id");
    if (!storedId) {
      // No capsule in session — send back to onboarding
      router.replace("/onboarding");
      return;
    }

    setCapsuleId(storedId);

    const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";
    setLivekitUrl(lkUrl);

    const init = async () => {
      try {
        // Fetch LiveKit token
        const tokenRes = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capsule_id: storedId,
            participant_name: "sender",
          }),
        });

        if (!tokenRes.ok) {
          const data = (await tokenRes.json()) as { error?: string };
          throw new Error(
            data.error ?? "No pudimos conectar la sala. Inténtalo de nuevo."
          );
        }

        const tokenData = (await tokenRes.json()) as LiveKitTokenResponse;
        setLivekitToken(tokenData.token);

        // Start Gemini Live session
        const geminiRes = await fetch("/api/gemini/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capsule_id: storedId,
            recipient_name:
              sessionStorage.getItem("capsule_recipient") ?? "tu persona especial",
          }),
        });

        if (!geminiRes.ok) {
          // Non-blocking — session can be retried; room is ready
          console.warn("[Interview] Gemini session init failed — continuing");
        } else {
          const _geminiData =
            (await geminiRes.json()) as GeminiSessionResponse;
          void _geminiData;
        }

        setPageState("ready");
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Algo salió mal, pero tu historia sigue aquí. Inténtalo de nuevo."
        );
        setPageState("error");
      }
    };

    void init();
  }, [router]);

  const handleFinish = useCallback(
    async (transcript: string) => {
      if (!capsuleId) return;
      setPageState("finishing");

      try {
        // Save transcript
        await fetch(`/api/capsule/${capsuleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
      } catch {
        // Non-blocking — transcript save failure doesn't block the flow
        console.warn("[Interview] Transcript save failed");
      }

      // Navigate to editor
      router.push("/editor");
    },
    [capsuleId, router]
  );

  // ── Render states ──────────────────────────────────────────

  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-azul-profundo flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-8 h-8 rounded-full border-2 border-beige/20 border-t-terracota animate-spin" />
        <p className="font-sans text-sm text-beige/40 text-center">
          Preparando tu espacio para hablar…
        </p>
      </div>
    );
  }

  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-azul-profundo flex flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="font-serif text-display-sm text-beige italic max-w-narrow">
          Algo salió mal.
        </p>
        <p className="font-sans text-body-sm text-beige/50 max-w-narrow">
          {errorMessage ??
            "No pudimos preparar la sala. Tu historia sigue aquí cuando estés listo."}
        </p>
        <button
          onClick={() => router.push("/onboarding")}
          className="font-sans text-sm text-beige/60 hover:text-beige/90 transition-colors duration-300 underline underline-offset-4 decoration-beige/20"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  if (pageState === "finishing") {
    return (
      <div className="min-h-screen bg-azul-profundo flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-8 h-8 rounded-full border-2 border-beige/20 border-t-terracota animate-spin" />
        <p className="font-sans text-sm text-beige/40 text-center">
          Guardando tu historia con cuidado…
        </p>
      </div>
    );
  }

  if (!livekitToken || !capsuleId) return null;

  return (
    <main className="min-h-screen bg-azul-profundo dark-surface">
      <LiveKitRoom
        token={livekitToken}
        serverUrl={livekitUrl}
        connect={true}
        audio={true}
        video={true}
        className="h-screen"
        options={{
          adaptiveStream: true,
          dynacast: true,
        }}
      >
        {/* RoomAudioRenderer plays remote audio (Gemini's voice) — no video rendered */}
        <RoomAudioRenderer />

        <InterviewRoomInner
          capsuleId={capsuleId}
          onFinish={(transcript) => void handleFinish(transcript)}
        />
      </LiveKitRoom>
    </main>
  );
}
