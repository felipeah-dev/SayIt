/**
 * app/api/gemini/chat/route.ts
 *
 * POST /api/gemini/chat
 *
 * Streaming emotional interview chat via Gemini.
 * Called turn-by-turn: browser sends each user utterance,
 * server returns Gemini's response as a streaming text body.
 *
 * Model fallback:
 *   1. gemini-2.5-flash — best quality, 20 req/day free tier
 *   2. gemini-2.0-flash — 1,500 req/day free tier (auto-fallback on 429)
 *
 * SECURITY: GEMINI_API_KEY never leaves the server.
 *
 * Body:   { session_id: string, message: string, recipient_name: string }
 * Returns: text/plain streaming (UTF-8 chunks of the AI response)
 */

import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getSession,
  appendTranscriptEntry,
  INTERVIEW_SYSTEM_PROMPT,
} from "@/lib/ai/gemini-live";

// ============================================================
// Model cascade — best quality first, fallback on quota exhaustion
// ============================================================

const MODEL_CASCADE = [
  "gemini-2.5-flash",      // best quality, 20 req/day free tier
  "gemini-2.0-flash",      // 1,500 req/day free tier
  "gemini-2.0-flash-lite", // lightest, highest quota free tier
];

// ============================================================
// POST /api/gemini/chat
// ============================================================

interface ChatRequestBody {
  session_id: string;
  message?: string;
  recipient_name?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[POST /api/gemini/chat] GEMINI_API_KEY not configured");
    return new Response("Service unavailable", { status: 503 });
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const {
    session_id,
    message = "",
    recipient_name = "tu persona especial",
  } = body;

  if (!session_id) {
    return new Response("session_id is required", { status: 400 });
  }

  const session = getSession(session_id);

  // ── Personalize system prompt ─────────────────────────────
  const personalizedPrompt = INTERVIEW_SYSTEM_PROMPT.replace(
    /\[recipient's name\]/g,
    recipient_name
  ).replace(/\[recipient_name\]/g, recipient_name);

  // ── Build history from session transcript ─────────────────
  const rawHistory = session
    ? session.transcript.map((entry) => ({
        role: (entry.speaker === "ai" ? "model" : "user") as "model" | "user",
        parts: [{ text: entry.text }],
      }))
    : [];

  const firstUserIdx = rawHistory.findIndex((h) => h.role === "user");
  const history = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : [];

  const userText = message.trim();
  if (session && userText) {
    appendTranscriptEntry(session_id, {
      speaker: "user",
      text: userText,
      timestamp: Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
    });
  }

  const prompt =
    userText ||
    "Comienza la conversación. Preséntate brevemente y haz la primera pregunta de bienvenida de manera cálida y natural.";

  // ── Model cascade: try each model, fall back on 429 ───────
  const genAI = new GoogleGenerativeAI(apiKey);

  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    const modelName = MODEL_CASCADE[i];
    const isFallback = i > 0;

    try {
      if (isFallback) {
        console.warn(
          `[POST /api/gemini/chat] Quota exhausted on ${MODEL_CASCADE[i - 1]}, falling back to ${modelName}`
        );
      }

      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: personalizedPrompt,
      });

      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(prompt);

      let fullResponse = "";
      const startTime = session?.startedAt.getTime() ?? Date.now();

      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.stream) {
              const text = chunk.text();
              fullResponse += text;
              controller.enqueue(new TextEncoder().encode(text));
            }
          } finally {
            if (session && fullResponse.trim()) {
              appendTranscriptEntry(session_id, {
                speaker: "ai",
                text: fullResponse.trim(),
                timestamp: Math.floor((Date.now() - startTime) / 1000),
              });
            }
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const isRetryable =
        err instanceof Error &&
        (err.message.includes("429") ||
          err.message.includes("503") ||
          err.message.includes("quota") ||
          err.message.includes("demand"));

      // On quota/overload errors, try next model in cascade
      if (isRetryable && i < MODEL_CASCADE.length - 1) continue;

      // Any other error, or last model also failed
      console.error(`[POST /api/gemini/chat] ${modelName} error:`, err);
      return new Response(
        JSON.stringify({
          error:
            "El entrevistador no pudo responder en este momento. Inténtalo de nuevo.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Unreachable but satisfies TypeScript
  return new Response("Service unavailable", { status: 503 });
}
