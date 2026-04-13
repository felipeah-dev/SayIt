/**
 * app/api/claude/refine/route.ts
 *
 * POST /api/claude/refine
 *
 * Refines a Gemini-generated message draft using Claude Sonnet 4.6.
 * Claude amplifies warmth and literary quality while honoring the
 * sender's voice.
 *
 * SECURITY: ANTHROPIC_API_KEY stays server-side. Never exposed.
 *
 * Body:
 *   {
 *     message_draft: string
 *     recipient_name: string
 *     capsule_id: string
 *   }
 *
 * Response:
 *   { message_refined: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCapsuleById } from "@/lib/db/supabase";
import { refineMessage } from "@/lib/ai/claude-refine";

// ============================================================
// Types
// ============================================================

interface RefineRequestBody {
  message_draft: string;
  recipient_name: string;
  capsule_id: string;
}

// ============================================================
// POST /api/claude/refine
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // ── Validate API key presence ─────────────────────────────
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("[POST /api/claude/refine] ANTHROPIC_API_KEY not configured");
      return NextResponse.json(
        {
          error:
            "The message refinement service isn't available right now. Please try again in a moment.",
        },
        { status: 503 }
      );
    }

    // ── Parse body ────────────────────────────────────────────
    let body: RefineRequestBody;
    try {
      body = (await request.json()) as RefineRequestBody;
    } catch {
      return NextResponse.json(
        { error: "We couldn't read your request. Please try again." },
        { status: 400 }
      );
    }

    const { message_draft, recipient_name, capsule_id } = body;

    // ── Validate required fields ──────────────────────────────
    if (!capsule_id || typeof capsule_id !== "string") {
      return NextResponse.json(
        { error: "A capsule ID is required." },
        { status: 400 }
      );
    }

    if (!message_draft || typeof message_draft !== "string" || message_draft.trim().length === 0) {
      return NextResponse.json(
        {
          error:
            "A message draft is required. Please complete the interview and analysis first.",
        },
        { status: 400 }
      );
    }

    if (!recipient_name || typeof recipient_name !== "string" || recipient_name.trim().length === 0) {
      return NextResponse.json(
        { error: "The recipient's name is required." },
        { status: 400 }
      );
    }

    // ── Verify capsule exists in database ─────────────────────
    const capsule = await getCapsuleById(capsule_id);
    if (!capsule) {
      return NextResponse.json(
        {
          error:
            "We couldn't find this capsule. Please check and try again.",
        },
        { status: 404 }
      );
    }

    // ── Sanity-check recipient name matches capsule ───────────
    // Use capsule's recipient_name as the authoritative source
    const authorizedRecipientName = capsule.recipient_name;

    // ── Call Claude ───────────────────────────────────────────
    const messageRefined = await refineMessage({
      message_draft: message_draft.trim(),
      recipient_name: authorizedRecipientName,
    });

    return NextResponse.json(
      { message_refined: messageRefined },
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/claude/refine]", error);

    // Don't expose internal error details to the client
    return NextResponse.json(
      {
        error:
          "Something went quietly wrong while refining the message. Your draft is safe — please try again.",
      },
      { status: 500 }
    );
  }
}
