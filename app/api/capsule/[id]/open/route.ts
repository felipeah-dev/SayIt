/**
 * app/api/capsule/[id]/open/route.ts
 *
 * POST /api/capsule/[id]/open
 *
 * Records a capsule opening in capsule_openings.
 * Enforces delivery_date — a capsule that isn't ready returns 403.
 * Emotional check-in state cannot be skipped by URL manipulation
 * because validation happens server-side, not client-side.
 *
 * Body: { emotional_state?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCapsuleById, recordOpening, countOpenings } from "@/lib/db/supabase";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Please provide a capsule ID." },
        { status: 400 }
      );
    }

    // Parse optional body — it may be empty
    let emotional_state: string | undefined;
    try {
      const text = await request.text();
      if (text) {
        const body = JSON.parse(text) as Record<string, unknown>;
        if (typeof body.emotional_state === "string") {
          emotional_state = body.emotional_state.trim() || undefined;
        }
      }
    } catch {
      // Body is optional — ignore parse errors
    }

    // Fetch the capsule
    const capsule = await getCapsuleById(id);

    if (!capsule) {
      return NextResponse.json(
        {
          error:
            "We couldn't find this capsule. The link may be incorrect or the message may not exist yet.",
        },
        { status: 404 }
      );
    }

    // Ensure the capsule has been sealed before it can be opened
    if (!capsule.sealed_at) {
      return NextResponse.json(
        {
          error:
            "This message hasn't been sealed yet. It's still being prepared with care.",
        },
        { status: 403 }
      );
    }

    // Enforce delivery_date — this check CANNOT be bypassed by the client
    if (
      capsule.delivery_type === "date" &&
      capsule.delivery_date &&
      !capsule.delivered_at
    ) {
      const deliveryDate = new Date(capsule.delivery_date);
      if (deliveryDate > new Date()) {
        return NextResponse.json(
          {
            error:
              "This message isn't ready to be opened yet. It will arrive at just the right time.",
            delivery_date: capsule.delivery_date,
          },
          { status: 403 }
        );
      }
    }

    // Count previous openings to determine if this is first opening or re-opening
    const previousOpenings = await countOpenings(id);
    const isFirstOpening = previousOpenings === 0;

    // For re-openings, require an emotional check-in state
    // (protects against skipping by URL manipulation — enforced server-side)
    if (!isFirstOpening && !emotional_state) {
      return NextResponse.json(
        {
          error:
            "Before revisiting this message, please take a moment to share how you're feeling.",
          requires_emotional_checkin: true,
        },
        { status: 422 }
      );
    }

    // Record the opening
    const opening = await recordOpening(id, emotional_state);

    return NextResponse.json(
      {
        opening,
        is_first_opening: isFirstOpening,
        capsule_id: id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/capsule/[id]/open]", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong while opening this capsule. Please try again — this message is waiting for you.",
      },
      { status: 500 }
    );
  }
}
