"use client";

/**
 * /app/(emisor)/interview/page.tsx
 *
 * CRITICAL RULE: The sender's video is NEVER rendered locally.
 * The camera captures for LiveKit recording and for the local MediaRecorder
 * (used later by ffmpeg.wasm in the editor), but attach() is NEVER called
 * on any video element — the sender does not see themselves.
 *
 * Voice flow:
 *   User speaks → SpeechRecognition → text → POST /api/gemini/chat
 *   Gemini response text → SpeechSynthesis → plays in browser
 *   Both turns saved to session transcript for post-interview analysis
 *
 * Recording flow:
 *   MediaRecorder captures camera+mic → blob → sessionStorage["recording_blob_url"]
 *   The editor reads this blob for ffmpeg.wasm processing
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
  url: string;
  room: string;
}

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

// Extend Window with Speech APIs not yet in TS default lib
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

// ============================================================
// TTS helper — tries providers in order, returns true if audio played
// ============================================================

/**
 * Attempts to synthesize and play `text` via an API endpoint.
 * Returns true if the audio element was started (onEnded handles cleanup).
 * Returns false if the endpoint is unavailable → caller tries next option.
 */
async function trySpeak(
  text: string,
  currentAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  isEndingRef: React.MutableRefObject<boolean>,
  onEnded?: () => void,
  endpoints: string[] = ["/api/tts"]
): Promise<boolean> {

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      // 503 means key not configured — skip silently, try next provider
      if (res.status === 503) continue;
      if (!res.ok) continue;

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      const cleanup = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        onEnded?.();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;

      if (!isEndingRef.current) {
        await audio.play();
        return true;
      } else {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        return false;
      }
    } catch {
      // Network error — try next provider
      continue;
    }
  }

  return false; // all providers failed
}

/**
 * Speaks `text` via the browser's SpeechSynthesis API, preferring the
 * highest-quality Spanish voice available:
 *   1. Online Google voice (e.g. "Google español" in Chrome) — neural quality
 *   2. Online Microsoft voice (Edge) — neural quality
 *   3. Any online Spanish voice
 *   4. Any local Spanish voice
 *
 * Returns true if SpeechSynthesis is available (always plays something).
 * Returns false if the browser has no TTS support at all.
 */
function speakInBrowser(text: string, onEnded: () => void): boolean {
  if (!("speechSynthesis" in window)) return false;

  const voices = window.speechSynthesis.getVoices();
  const spanish = voices.filter((v) => v.lang.startsWith("es"));

  const bestVoice =
    spanish.find((v) => /google/i.test(v.name) && !v.localService) ??
    spanish.find((v) => /microsoft/i.test(v.name) && !v.localService) ??
    spanish.find((v) => !v.localService) ??
    spanish[0] ??
    null;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  // Online Google/Microsoft voices sound best at a slightly higher rate
  utterance.rate = bestVoice && !bestVoice.localService ? 0.92 : 0.86;
  utterance.pitch = 1.0;
  if (bestVoice) utterance.voice = bestVoice;

  utterance.onend = onEnded;
  utterance.onerror = onEnded;

  window.speechSynthesis.speak(utterance);
  return true;
}

// ============================================================
// InterviewRoomInner — rendered inside LiveKitRoom context
// ============================================================

interface InterviewRoomInnerProps {
  capsuleId: string;
  sessionId: string;
  recipientName: string;
  onFinish: (transcript: string) => void;
}

function InterviewRoomInner({
  capsuleId: _capsuleId,
  sessionId,
  recipientName,
  onFinish,
}: InterviewRoomInnerProps) {
  const { localParticipant } = useLocalParticipant();
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<
    Array<{ speaker: "ai" | "user"; text: string }>
  >([]);
  const [isTimerActive, setIsTimerActive] = useState(true);
  const [isEnding, setIsEnding] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isSpeakingRef = useRef(false);
  const hasStartedRef = useRef(false);
  // Use a ref for isEnding so callbacks always see the latest value
  const isEndingRef = useRef(false);
  // Tracks the currently playing TTS audio so it can be cancelled on end
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── LiveKit: enable mic + camera for server-side recording ─
  // CRITICAL: camera is enabled only for recording — never attached to DOM
  useEffect(() => {
    if (!localParticipant) return;
    void localParticipant.setMicrophoneEnabled(true);
    void localParticipant.setCameraEnabled(true);
  }, [localParticipant]);

  // ── MediaRecorder: capture locally for ffmpeg in editor ───
  // We capture the stream separately from LiveKit — no video element attached.
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        mediaStreamRef.current = stream;

        const mimeType =
          ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find(
            (t) => MediaRecorder.isTypeSupported(t)
          ) ?? "";

        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          const url = URL.createObjectURL(blob);
          sessionStorage.setItem("recording_blob_url", url);
        };

        recorder.start(1000); // collect a chunk every second
        mediaRecorderRef.current = recorder;
      })
      .catch((err) => {
        // Non-blocking — interview can continue without local recording
        console.warn("[Interview] MediaRecorder unavailable:", err);
      });

    return () => {
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current?.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Ask Gemini and speak the response ─────────────────────
  const askGemini = useCallback(
    async (userMessage: string) => {
      if (isSpeakingRef.current || isEndingRef.current) return;

      // Pause recognition while thinking / speaking
      recognitionRef.current?.abort();
      setVoiceState("thinking");

      try {
        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            message: userMessage,
            recipient_name: recipientName,
          }),
        });

        if (!res.ok || !res.body) {
          setVoiceState("listening");
          try { recognitionRef.current?.start(); } catch { /* already started */ }
          return;
        }

        // Consume the streaming response
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }

        if (!fullText.trim() || isEndingRef.current) return;

        setTranscript((prev) => [
          ...prev,
          { speaker: "ai", text: fullText.trim() },
        ]);

        setVoiceState("speaking");
        isSpeakingRef.current = true;

        const resumeListening = () => {
          isSpeakingRef.current = false;
          currentAudioRef.current = null;
          if (isEndingRef.current) return;
          setVoiceState("listening");
          try { recognitionRef.current?.start(); } catch { /* already started */ }
        };

        // ── TTS chain: ElevenLabs → browser Google voice → Gemini TTS ──
        //
        // 1. ElevenLabs via /api/tts (~500ms, best quality)
        const played = await trySpeak(
          fullText.trim(), currentAudioRef, isEndingRef, resumeListening
        );
        if (played) return;

        // 2. Browser SpeechSynthesis with smart voice selection (0ms latency).
        //    On Chrome with internet, "Google español" is neural quality.
        //    This is the primary fallback when ElevenLabs is not configured.
        if (speakInBrowser(fullText.trim(), resumeListening)) return;

        // 3. Gemini TTS via /api/gemini/tts (~9s, absolute last resort).
        //    Only reached if the browser has no TTS support at all.
        const playedGemini = await trySpeak(
          fullText.trim(), currentAudioRef, isEndingRef, resumeListening,
          ["/api/gemini/tts"]
        );
        if (playedGemini) return;

        // 4. Nothing worked — resume without audio
        resumeListening();
      } catch (err) {
        console.error("[Interview] Gemini chat error:", err);
        isSpeakingRef.current = false;
        if (!isEndingRef.current) {
          setVoiceState("listening");
          try { recognitionRef.current?.start(); } catch { /* already started */ }
        }
      }
    },
    [sessionId, recipientName]
  );

  // ── SpeechRecognition setup ────────────────────────────────
  useEffect(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn("[Interview] SpeechRecognition not available in this browser");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;   // one utterance per session
    recognition.interimResults = false;
    recognition.lang = "es-ES";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      if (text.trim()) {
        setTranscript((prev) => [
          ...prev,
          { speaker: "user", text: text.trim() },
        ]);
        void askGemini(text.trim());
      }
    };

    // Auto-restart after each utterance while in listening state
    recognition.onend = () => {
      if (!isSpeakingRef.current && !isEndingRef.current) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are normal — don't log them
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.warn("[Interview] SpeechRecognition error:", event.error);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [askGemini]);

  // ── Trigger the first Gemini question ─────────────────────
  useEffect(() => {
    if (hasStartedRef.current || !sessionId) return;
    hasStartedRef.current = true;

    // Small delay lets the UI settle before Gemini speaks
    const timer = setTimeout(() => {
      void askGemini("");
    }, 800);

    return () => {
      // Reset so React StrictMode's remount can re-trigger the first question.
      // Without this, StrictMode cancels the timer on cleanup AND leaves the
      // ref as `true`, so the second mount exits early and askGemini never fires.
      hasStartedRef.current = false;
      clearTimeout(timer);
    };
  }, [sessionId, askGemini]);

  // ── Auto-scroll transcript ─────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ── End interview ──────────────────────────────────────────
  const handleEnd = useCallback(() => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    setIsEnding(true);
    setIsTimerActive(false);

    recognitionRef.current?.abort();
    // Stop Gemini TTS audio if playing
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    const fullTranscript = transcript
      .map((t) =>
        t.speaker === "ai"
          ? `Entrevistador: ${t.text}`
          : `Tú: ${t.text}`
      )
      .join("\n");

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // Override onstop so the blob is saved BEFORE navigation.
      // MediaRecorder.stop() is async — onstop fires after the final chunk
      // is flushed. Without this override, router.push() races against onstop
      // and the editor reads an empty sessionStorage.
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        sessionStorage.setItem("recording_blob_url", url);
        onFinish(fullTranscript);
      };
      recorder.stop();
    } else {
      onFinish(fullTranscript);
    }
  }, [transcript, onFinish]);

  const handleTimeUp = useCallback(() => {
    if (!isEndingRef.current) handleEnd();
  }, [handleEnd]);

  // ============================================================
  // Render
  // ============================================================

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

      {/* Center — Voice feedback + transcript */}
      <div className="flex flex-col items-center gap-6 flex-1 justify-center w-full max-w-reading">
        <VoiceWave
          isActive={voiceState === "speaking"}
          label={
            voiceState === "thinking"
              ? "Reflexionando…"
              : voiceState === "speaking"
              ? "Escucha la pregunta"
              : voiceState === "listening"
              ? "Habla cuando quieras"
              : "Preparando…"
          }
        />

        {transcript.length > 0 && (
          <div className="w-full max-h-48 overflow-y-auto">
            <div className="space-y-3 px-2">
              {transcript.slice(-4).map((line, i) => (
                <p
                  key={i}
                  className={`font-sans text-sm leading-relaxed text-center ${
                    line.speaker === "ai"
                      ? "text-beige/60"
                      : "text-beige/35 italic"
                  }`}
                >
                  {line.text}
                </p>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {transcript.length === 0 && (
          <p className="font-sans text-sm text-beige/25 text-center animate-breathe">
            {voiceState === "idle" || voiceState === "thinking"
              ? "Preparando tu espacio para hablar…"
              : "Habla con calma. No hay prisa."}
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

type PageState = "loading" | "ready" | "finishing" | "error";

export default function InterviewPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string>("");
  const [capsuleId, setCapsuleId] = useState<string | null>(null);
  const [geminiSessionId, setGeminiSessionId] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const storedId = sessionStorage.getItem("capsule_id");
    if (!storedId) {
      router.replace("/onboarding");
      return;
    }

    setCapsuleId(storedId);
    setRecipientName(
      sessionStorage.getItem("capsule_recipient") ?? "tu persona especial"
    );

    const init = async () => {
      try {
        // ── LiveKit token ─────────────────────────────────────
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
        setLivekitUrl(tokenData.url);

        // ── Gemini session ────────────────────────────────────
        const geminiRes = await fetch("/api/gemini/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capsule_id: storedId,
            recipient_name:
              sessionStorage.getItem("capsule_recipient") ??
              "tu persona especial",
          }),
        });

        if (geminiRes.ok) {
          const geminiData =
            (await geminiRes.json()) as GeminiSessionResponse;
          setGeminiSessionId(geminiData.session_id);
        } else {
          // Session init failed — use a fallback so the interview still runs
          console.warn(
            "[Interview] Gemini session init failed — proceeding with fallback"
          );
          setGeminiSessionId("fallback-" + crypto.randomUUID());
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
        await fetch(`/api/capsule/${capsuleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
      } catch {
        // Non-blocking — transcript save failure doesn't block the flow
        console.warn("[Interview] Transcript save failed");
      }

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

  if (!livekitToken || !livekitUrl || !capsuleId || !geminiSessionId)
    return null;

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
        {/* RoomAudioRenderer plays remote audio from the LiveKit room */}
        <RoomAudioRenderer />

        <InterviewRoomInner
          capsuleId={capsuleId}
          sessionId={geminiSessionId}
          recipientName={recipientName}
          onFinish={(transcript) => void handleFinish(transcript)}
        />
      </LiveKitRoom>
    </main>
  );
}
