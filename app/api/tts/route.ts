/**
 * app/api/tts/route.ts
 *
 * POST /api/tts
 *
 * Primary TTS endpoint using ElevenLabs (eleven_multilingual_v2).
 * Returns audio/mpeg binary — played directly with the browser Audio API.
 *
 * Voice resolution — no GET /v1/voices call needed:
 *   1. ELEVENLABS_VOICE_ID env var (explicit override)
 *   2. Auto-probe: tries a curated list of ElevenLabs premade voices in order,
 *      caches the first one that responds with 200. This works with only the
 *      "De texto a voz → Acceso" permission — no "Voces → Leer" required.
 *
 * SECURITY: ELEVENLABS_API_KEY stays server-side. Never exposed.
 *
 * Body:    { text: string }
 * Returns: audio/mpeg binary   (200)
 *          503 if key missing   → browser falls back to smart browser TTS
 */

import { NextRequest } from "next/server";

// ============================================================
// Constants
// ============================================================

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_multilingual_v2";

const VOICE_SETTINGS = {
  stability: 0.35,   // más variación natural, menos robótica
  similarity_boost: 0.75,
  style: 0.30,       // más expresividad y calidez emocional
  use_speaker_boost: true,
};

// Curated list of ElevenLabs premade voices, ordered by preference for
// an empathetic Spanish interview. The probe tries each in order and
// caches the first one that succeeds (200) for this account.
// 402 = library/paid voice → skip. 401 = bad key → abort.
const CANDIDATE_VOICE_IDS = [
  "EXAVITQu4vr4xnSDxMaL", // Sarah    — soft, warm female
  "XB0fDUnXU5powFXDhCwa", // Charlotte — clear female
  "Xb7hH8MSUJpSbSDYk0k2", // Alice    — natural female
  "cgSgspJ2msm6clMCkdW9", // Jessica  — expressive female
  "JBFqnCBsd6RMkjVDRZzb", // George   — warm male
  "nPczCjzI2devNBz1zQrb", // Brian    — articulate male
];

// Short probe text — used only when discovering the working voice.
// Real requests use the full interview text.
const PROBE_TEXT = "Hola.";

// ============================================================
// Voice ID resolution — module-level cache
// ============================================================

let cachedVoiceId: string | null = null;

/**
 * Finds the first voice ID in CANDIDATE_VOICE_IDS that this account
 * can use, by attempting a short TTS call for each candidate.
 * Result is cached for the server lifetime.
 */
async function resolveVoiceId(apiKey: string): Promise<string | null> {
  if (cachedVoiceId) return cachedVoiceId;

  const configured = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (configured) {
    cachedVoiceId = configured;
    return configured;
  }

  for (const voiceId of CANDIDATE_VOICE_IDS) {
    try {
      const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: PROBE_TEXT,
          model_id: MODEL_ID,
          voice_settings: VOICE_SETTINGS,
        }),
      });

      if (res.ok) {
        console.log(`[/api/tts] Voice resolved: ${voiceId}`);
        cachedVoiceId = voiceId;
        return voiceId;
      }

      // 401 = bad API key — no point trying further
      if (res.status === 401) {
        console.error("[/api/tts] ElevenLabs API key rejected (401)");
        return null;
      }

      // 402 = library/paid voice — try next candidate
      if (res.status === 402) continue;

    } catch {
      // Network error on this candidate — try next
      continue;
    }
  }

  console.error("[/api/tts] No accessible voice found across all candidates");
  return null;
}

// ============================================================
// POST /api/tts
// ============================================================

interface TtsRequestBody {
  text?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return new Response("ElevenLabs key not configured", { status: 503 });
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

  const voiceId = await resolveVoiceId(apiKey);
  if (!voiceId) {
    return new Response("No accessible voice found", { status: 503 });
  }

  try {
    const elevenlabsRes = await fetch(
      `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: VOICE_SETTINGS,
        }),
      }
    );

    if (!elevenlabsRes.ok) {
      const errText = await elevenlabsRes.text();
      console.error(
        `[POST /api/tts] ElevenLabs ${elevenlabsRes.status}:`,
        errText.slice(0, 300)
      );
      // If the cached voice suddenly fails, clear cache so next request re-probes
      if (elevenlabsRes.status === 402 || elevenlabsRes.status === 401) {
        cachedVoiceId = null;
      }
      return new Response("TTS generation failed", { status: 502 });
    }

    const audioBuffer = await elevenlabsRes.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[POST /api/tts]", err);
    return new Response("Internal error", { status: 500 });
  }
}
