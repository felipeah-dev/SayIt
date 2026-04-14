/**
 * app/api/gemini/tts/route.ts
 *
 * POST /api/gemini/tts
 *
 * Converts text to natural speech using Gemini TTS (gemini-2.5-flash-preview-tts).
 * Returns a WAV audio file ready for browser playback.
 *
 * SECURITY: GEMINI_API_KEY stays server-side. Never exposed.
 *
 * Body:    { text: string, voice?: string }
 * Returns: audio/wav binary
 */

import { NextRequest } from "next/server";

// ============================================================
// Constants
// ============================================================

const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Gemini TTS outputs linear PCM at these specs
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BIT_DEPTH = 16;

// Default voice — warm and conversational, fits the emotional tone of SayIt
const DEFAULT_VOICE = "Kore";

// ============================================================
// Types
// ============================================================

interface TtsRequestBody {
  text?: string;
  voice?: string;
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          mimeType?: string;
          data?: string; // base64 encoded PCM
        };
      }>;
    };
  }>;
}

// ============================================================
// POST /api/gemini/tts
// ============================================================

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[POST /api/gemini/tts] GEMINI_API_KEY not configured");
    return new Response("Service unavailable", { status: 503 });
  }

  let body: TtsRequestBody;
  try {
    body = (await request.json()) as TtsRequestBody;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return new Response("text is required", { status: 400 });
  }

  const voiceName = body.voice ?? DEFAULT_VOICE;

  try {
    const geminiRes = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(
        `[POST /api/gemini/tts] Gemini ${geminiRes.status}:`,
        errText.slice(0, 300)
      );
      return new Response("TTS generation failed", { status: 502 });
    }

    const result = (await geminiRes.json()) as GeminiTtsResponse;

    // Extract base64-encoded PCM and mimeType from the response
    const inlineData = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = inlineData?.data;

    if (!base64Audio) {
      console.error("[POST /api/gemini/tts] No audio data in Gemini response");
      return new Response("No audio in response", { status: 502 });
    }

    // Parse the actual sample rate from the mimeType (e.g. "audio/pcm;rate=24000").
    // Using the wrong rate causes pitch distortion and background noise artifacts.
    const mimeType = inlineData?.mimeType ?? "";
    const rateMatch = mimeType.match(/rate=(\d+)/i);
    const actualSampleRate = rateMatch ? parseInt(rateMatch[1], 10) : SAMPLE_RATE;

    // Decode PCM and wrap in a WAV container for browser playback
    const pcmBuffer = Buffer.from(base64Audio, "base64");
    const wavBuffer = pcmToWav(pcmBuffer, actualSampleRate, CHANNELS, BIT_DEPTH);

    // Convert to Uint8Array — Buffer is not a valid BodyInit in the edge runtime
    const wavBytes = new Uint8Array(wavBuffer);

    return new Response(wavBytes, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wavBytes.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[POST /api/gemini/tts]", err);
    return new Response("Internal error", { status: 500 });
  }
}

// ============================================================
// PCM → WAV conversion
// ============================================================

/**
 * Wraps raw PCM audio data in a WAV (RIFF) container.
 * Gemini TTS returns 16-bit linear PCM at 24 kHz mono —
 * this header makes it playable by the browser's Audio element.
 */
function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitDepth: number
): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize = pcm.length;
  const headerSize = 44;

  const wav = Buffer.alloc(headerSize + dataSize);
  let offset = 0;

  // ── RIFF chunk ────────────────────────────────────────────
  wav.write("RIFF", offset, "ascii"); offset += 4;
  wav.writeUInt32LE(36 + dataSize, offset); offset += 4; // file size - 8
  wav.write("WAVE", offset, "ascii"); offset += 4;

  // ── fmt sub-chunk ─────────────────────────────────────────
  wav.write("fmt ", offset, "ascii"); offset += 4;
  wav.writeUInt32LE(16, offset); offset += 4;       // fmt chunk size (PCM = 16)
  wav.writeUInt16LE(1, offset); offset += 2;         // audio format: PCM
  wav.writeUInt16LE(channels, offset); offset += 2;
  wav.writeUInt32LE(sampleRate, offset); offset += 4;
  wav.writeUInt32LE(byteRate, offset); offset += 4;
  wav.writeUInt16LE(blockAlign, offset); offset += 2;
  wav.writeUInt16LE(bitDepth, offset); offset += 2;

  // ── data sub-chunk ────────────────────────────────────────
  wav.write("data", offset, "ascii"); offset += 4;
  wav.writeUInt32LE(dataSize, offset); offset += 4;
  pcm.copy(wav, offset);

  return wav;
}
