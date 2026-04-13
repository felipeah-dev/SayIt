/**
 * app/api/gemini/session/route.ts
 *
 * POST /api/gemini/session
 *
 * Creates a Gemini Flash Live interview session and returns a
 * session token + the full Gemini Live configuration.
 *
 * SECURITY: GEMINI_API_KEY never leaves the server. The client
 * receives only a session_id and the non-secret configuration.
 *
 * Body:   { capsule_id: string }
 * Returns: { session_id: string, config: GeminiLiveConfig, websocket_url: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGeminiLiveConfig, createSession } from "@/lib/ai/gemini-live";
import { getCapsuleById } from "@/lib/db/supabase";

// ============================================================
// POST /api/gemini/session
// ============================================================

interface SessionRequestBody {
  capsule_id: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // ── Validate API key presence ─────────────────────────────
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[POST /api/gemini/session] GEMINI_API_KEY not configured");
      return NextResponse.json(
        {
          error:
            "The interview room isn't ready yet. Please try again in a moment.",
        },
        { status: 503 }
      );
    }

    // ── Parse and validate request body ──────────────────────
    let body: SessionRequestBody;
    try {
      body = (await request.json()) as SessionRequestBody;
    } catch {
      return NextResponse.json(
        {
          error:
            "We couldn't read your request. Please try again.",
        },
        { status: 400 }
      );
    }

    const { capsule_id } = body;

    if (!capsule_id || typeof capsule_id !== "string") {
      return NextResponse.json(
        { error: "A capsule ID is required to start the interview." },
        { status: 400 }
      );
    }

    // ── Verify capsule exists ─────────────────────────────────
    const capsule = await getCapsuleById(capsule_id);
    if (!capsule) {
      return NextResponse.json(
        {
          error:
            "We couldn't find this capsule. Please check the link and try again.",
        },
        { status: 404 }
      );
    }

    // ── Create session ────────────────────────────────────────
    const sessionId = randomUUID();

    createSession(sessionId, capsule_id);

    // Build the Gemini config with the recipient's name injected
    const config = buildGeminiLiveConfig(capsule.recipient_name);

    // The websocket_url tells the client which server endpoint to
    // connect to for the proxied audio stream. The actual Gemini
    // WebSocket is established server-side in the audio proxy route.
    const websocketUrl = `${getBaseUrl(request)}/api/gemini/live?session=${sessionId}`;

    return NextResponse.json(
      {
        session_id: sessionId,
        websocket_url: websocketUrl,
        config,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/gemini/session]", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong while setting up the interview room. We're sorry — please try again.",
      },
      { status: 500 }
    );
  }
}

// ============================================================
// Helpers
// ============================================================

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "ws" : "wss";
  return `${protocol}://${host}`;
}
