"use client";

/**
 * /app/(emisor)/editor/page.tsx
 *
 * Post-interview capsule editor.
 * Left: video processing status / final video preview
 * Right: editable written message refined by Claude
 *
 * Video processing flow:
 *   1. Call POST /api/gemini/analyze to get timestamps + message draft
 *   2. Call POST /api/claude/refine to refine the message
 *   3. Run ffmpeg.wasm in-browser to cut and assemble the 4-minute video
 *   4. Upload the edited video (via PATCH /api/capsule/[id] with video_url)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import MessageEditor from "@/components/ui/MessageEditor";

// ============================================================
// Types
// ============================================================

interface GeminiAnalyzeResponse {
  timestamps: number[];
  message_draft: string;
}

interface ClaudeRefineResponse {
  refined_message: string;
}

type ProcessingStage =
  | "analyzing"    // Gemini Pro analyzing the recording
  | "refining"     // Claude refining the message
  | "editing"      // ffmpeg.wasm cutting the video
  | "done"         // Everything ready
  | "error";

const STAGE_LABELS: Record<ProcessingStage, string> = {
  analyzing: "Analizando tu historia…",
  refining: "Dándole forma a tu mensaje…",
  editing: "Editando tu video con cuidado…",
  done: "Listo",
  error: "Algo salió mal",
};

const STAGE_ORDER: ProcessingStage[] = [
  "analyzing",
  "refining",
  "editing",
  "done",
];

// ============================================================
// Component
// ============================================================

export default function EditorPage() {
  const router = useRouter();
  const [capsuleId, setCapsuleId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProcessingStage>("analyzing");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const hasStarted = useRef(false);

  // Dynamically import ffmpeg to avoid SSR issues
  const runProcessing = useCallback(async (id: string) => {
    try {
      // Stage 1 — Gemini analyzes the recording
      setStage("analyzing");
      setProgress(10);

      const analyzeRes = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capsule_id: id }),
      });

      let timestamps: number[] = [];
      let messageDraft = "";

      if (analyzeRes.ok) {
        const analyzeData =
          (await analyzeRes.json()) as GeminiAnalyzeResponse;
        timestamps = analyzeData.timestamps ?? [];
        messageDraft = analyzeData.message_draft ?? "";
      }

      setProgress(35);

      // Stage 2 — Claude refines the message
      setStage("refining");

      if (messageDraft) {
        const refineRes = await fetch("/api/claude/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_draft: messageDraft,
            capsule_id: id,
          }),
        });

        if (refineRes.ok) {
          const refineData =
            (await refineRes.json()) as ClaudeRefineResponse;
          setMessage(refineData.refined_message ?? messageDraft);
        } else {
          setMessage(messageDraft);
        }
      } else {
        setMessage(
          "Tu historia está aquí. Escribe lo que quieras decirle — con tus palabras."
        );
      }

      setProgress(55);

      // Stage 3 — ffmpeg.wasm cuts the video
      setStage("editing");

      if (timestamps.length > 0) {
        try {
          const { editVideo } = await import("@/lib/video/ffmpeg-editor");

          // Retrieve the raw recording blob from sessionStorage reference
          // (In production, the blob would come from LiveKit recording)
          // For now we signal progress and skip if no blob is available
          const blobData = sessionStorage.getItem("recording_blob_url");

          if (blobData) {
            const blobRes = await fetch(blobData);
            const videoBlob = await blobRes.blob();

            const result = await editVideo({
              videoBlob,
              timestamps,
              maxDurationSeconds: 240,
              onProgress: (p) => setProgress(55 + Math.round(p * 0.4)),
            });

            const editedUrl = URL.createObjectURL(result.editedBlob);
            setVideoUrl(editedUrl);

            // Save video_url reference (object key will be set post-upload)
            sessionStorage.setItem("edited_video_url", editedUrl);
          }
        } catch (ffmpegErr) {
          // ffmpeg failure is non-blocking — message can still be delivered
          console.warn("[Editor] ffmpeg processing skipped:", ffmpegErr);
        }
      }

      setProgress(100);
      setStage("done");

      // Save the refined message to the capsule
      await fetch(`/api/capsule/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_text: message || messageDraft,
        }),
      });
    } catch (err) {
      console.error("[Editor] Processing failed:", err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Algo salió mal procesando tu historia. Pero tu mensaje está a salvo."
      );
      setStage("error");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = sessionStorage.getItem("capsule_id");
    if (!id) {
      router.replace("/onboarding");
      return;
    }
    setCapsuleId(id);

    if (!hasStarted.current) {
      hasStarted.current = true;
      void runProcessing(id);
    }
  }, [router, runProcessing]);

  const handleSaveAndContinue = async () => {
    if (!capsuleId) return;
    setIsSaving(true);

    try {
      await fetch(`/api/capsule/${capsuleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_text: message }),
      });
      router.push("/delivery");
    } catch {
      setErrorMessage(
        "No pudimos guardar tus cambios en este momento. Inténtalo de nuevo."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const currentStageIndex = STAGE_ORDER.indexOf(stage);

  return (
    <main className="min-h-screen bg-beige">
      {/* Header */}
      <header className="px-8 py-8 border-b border-beige-dark">
        <h1 className="font-serif text-2xl italic text-texto-principal">
          Tu cápsula
        </h1>
        <p className="font-sans text-sm text-texto-muted mt-1">
          Revisa y ajusta antes de sellar.
        </p>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
        {/* Left column — Video */}
        <div className="flex flex-col gap-6">
          <h2 className="font-serif text-xl text-texto-principal italic">
            Tu video
          </h2>

          {stage !== "done" && stage !== "error" ? (
            /* Processing state */
            <div className="bg-white/50 rounded-card p-8 flex flex-col gap-6 min-h-[280px] justify-center">
              {/* Stage progress dots */}
              <div className="flex items-center gap-3 justify-center">
                {STAGE_ORDER.filter((s) => s !== "done").map((s, i) => (
                  <div key={s} className="flex items-center gap-3">
                    <div
                      className={`
                        w-2 h-2 rounded-full transition-all duration-700
                        ${
                          i < currentStageIndex
                            ? "bg-terracota/50"
                            : i === currentStageIndex
                            ? "bg-terracota animate-breathe"
                            : "bg-beige-dark"
                        }
                      `}
                    />
                    {i < 2 && (
                      <div
                        className={`w-6 h-px transition-colors duration-700 ${
                          i < currentStageIndex
                            ? "bg-terracota/30"
                            : "bg-beige-dark"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Current stage label */}
              <p className="font-sans text-body-sm text-texto-suave text-center">
                {STAGE_LABELS[stage]}
              </p>

              {/* Progress bar */}
              <div className="w-full h-1 bg-beige-dark rounded-full overflow-hidden">
                <div
                  className="h-full bg-terracota rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="font-sans text-xs text-texto-muted text-center leading-relaxed max-w-[36ch] mx-auto">
                Estamos editando tu historia con cuidado.
                <br />
                Esto puede tomar un par de minutos.
              </p>
            </div>
          ) : stage === "error" ? (
            <div className="bg-terracota/5 border border-terracota/15 rounded-card p-8 flex flex-col gap-4">
              <p className="font-sans text-sm text-terracota">
                {errorMessage ??
                  "No pudimos procesar el video en este momento."}
              </p>
              <p className="font-sans text-xs text-texto-muted">
                Tu mensaje escrito sigue disponible. Puedes continuar sin el
                video editado y subirlo más tarde.
              </p>
            </div>
          ) : videoUrl ? (
            /* Video ready */
            <div className="flex flex-col gap-3">
              <div className="rounded-card overflow-hidden bg-black aspect-video">
                <video
                  src={videoUrl}
                  controls
                  className="w-full h-full object-contain"
                  aria-label="Vista previa de tu video"
                />
              </div>
              <p className="font-sans text-xs text-texto-muted text-center">
                Este es el video editado de tu historia — máximo 4 minutos.
              </p>
            </div>
          ) : (
            <div className="bg-white/50 rounded-card p-8 flex flex-col items-center justify-center gap-4 min-h-[200px]">
              <p className="font-sans text-sm text-texto-muted text-center">
                No pudimos preparar la vista previa del video.
                Tu mensaje escrito sigue aquí — puedes continuar.
              </p>
            </div>
          )}
        </div>

        {/* Right column — Message */}
        <div className="flex flex-col gap-6">
          <h2 className="font-serif text-xl text-texto-principal italic">
            Tu mensaje
          </h2>

          <div className="flex-1">
            <MessageEditor
              value={message}
              onChange={setMessage}
              readOnly={stage !== "done" && stage !== "error"}
              placeholder={
                stage !== "done" && stage !== "error"
                  ? "Dándole forma a tus palabras…"
                  : "Tu mensaje aparecerá aquí. Puedes ajustarlo si quieres."
              }
            />
          </div>

          {/* CTA — only enabled when done */}
          {(stage === "done" || stage === "error") && (
            <div className="flex flex-col gap-3 animate-fade-in-up">
              {errorMessage && stage === "error" && (
                <p className="font-sans text-xs text-terracota">
                  {errorMessage}
                </p>
              )}
              <button
                onClick={() => void handleSaveAndContinue()}
                disabled={isSaving}
                className="
                  w-full
                  font-sans text-body-sm font-medium
                  bg-terracota text-beige
                  rounded-pill px-8 py-4
                  hover:bg-terracota-light
                  active:scale-[0.98]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-all duration-300
                "
              >
                {isSaving
                  ? "Guardando…"
                  : "Sellar y programar entrega"}
              </button>
              <p className="font-sans text-xs text-texto-muted text-center">
                Después de sellar, nadie puede modificar este mensaje.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
