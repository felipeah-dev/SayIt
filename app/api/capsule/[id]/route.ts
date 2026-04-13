/**
 * app/api/capsule/[id]/route.ts
 *
 * GET   /api/capsule/[id] — Fetch a capsule, enforce delivery_date
 * PATCH /api/capsule/[id] — Update mutable capsule fields
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCapsuleById,
  updateCapsule,
  type CapsuleUpdate,
  type DeliveryType,
} from "@/lib/db/supabase";
import { getSignedVideoUrl } from "@/lib/storage/r2";

// ============================================================
// GET /api/capsule/[id]
// ============================================================

export async function GET(
  _request: NextRequest,
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

    // Protect date-based capsules not yet ready for delivery
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

    // Omit transcript from the response — sensitive data stays server-side
    const { transcript: _transcript, ...safeFields } = capsule;
    void _transcript;

    // Convert R2 object key to a signed URL (expires in 1 hour — security rule)
    // The DB stores the R2 key, never a raw public URL
    let signedVideoUrl: string | null = safeFields.video_url ?? null;
    if (signedVideoUrl) {
      try {
        signedVideoUrl = await getSignedVideoUrl(signedVideoUrl);
      } catch {
        // If signing fails, withhold the URL rather than expose the raw key
        signedVideoUrl = null;
      }
    }

    return NextResponse.json(
      { ...safeFields, video_url: signedVideoUrl },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/capsule/[id]]", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong while retrieving this capsule. Please try again.",
      },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/capsule/[id]
// Allowed fields: video_url, message_text, transcript,
//                 sealed_at, delivery_type, delivery_date
// ============================================================

const ALLOWED_PATCH_FIELDS = new Set<keyof CapsuleUpdate>([
  "video_url",
  "message_text",
  "transcript",
  "sealed_at",
  "delivery_type",
  "delivery_date",
]);

export async function PATCH(
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

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "We couldn't understand your request. Please try again." },
        { status: 400 }
      );
    }

    // Build a safe update object — only allow explicitly whitelisted fields
    const rawUpdate = body as Record<string, unknown>;
    const update: CapsuleUpdate = {};

    for (const key of Object.keys(rawUpdate)) {
      if (ALLOWED_PATCH_FIELDS.has(key as keyof CapsuleUpdate)) {
        const value = rawUpdate[key];

        if (key === "delivery_type") {
          const allowed: DeliveryType[] = ["date", "immediate", "posthumous"];
          if (value !== null && !allowed.includes(value as DeliveryType)) {
            return NextResponse.json(
              { error: "Please choose a valid delivery option." },
              { status: 400 }
            );
          }
          update.delivery_type = (value as DeliveryType) ?? undefined;
        } else {
          // All other whitelisted fields accept string | null
          (update as Record<string, unknown>)[key] =
            typeof value === "string" || value === null ? value : undefined;
        }
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided to update." },
        { status: 400 }
      );
    }

    // Ensure capsule exists before updating
    const existing = await getCapsuleById(id);
    if (!existing) {
      return NextResponse.json(
        {
          error:
            "We couldn't find this capsule. It may have been removed or the link is incorrect.",
        },
        { status: 404 }
      );
    }

    const updated = await updateCapsule(id, update);

    // Omit transcript from response
    const { transcript: _transcript, ...safeFields } = updated;
    void _transcript;

    return NextResponse.json(safeFields, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/capsule/[id]]", error);
    return NextResponse.json(
      {
        error:
          "We weren't able to save your changes. Please try again in a moment.",
      },
      { status: 500 }
    );
  }
}
