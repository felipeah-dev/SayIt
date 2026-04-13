/**
 * app/api/capsule/route.ts
 *
 * POST /api/capsule  — Create a new capsule
 * GET  /api/capsule?id=xxx — Fetch a capsule (respects delivery_date)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createCapsule,
  getCapsuleById,
  type DeliveryType,
} from "@/lib/db/supabase";

// ============================================================
// POST /api/capsule
// Creates a new capsule record.
// Body: { sender_id?, recipient_name, recipient_contact, delivery_type, delivery_date? }
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "We couldn't understand your request. Please try again." },
        { status: 400 }
      );
    }

    const {
      sender_id,
      recipient_name,
      recipient_contact,
      delivery_type,
      delivery_date,
    } = body as Record<string, unknown>;

    // Validate required fields
    if (
      typeof recipient_name !== "string" ||
      !recipient_name.trim()
    ) {
      return NextResponse.json(
        { error: "Please tell us who this message is for." },
        { status: 400 }
      );
    }

    if (
      typeof recipient_contact !== "string" ||
      !recipient_contact.trim()
    ) {
      return NextResponse.json(
        { error: "Please provide a way to reach the recipient." },
        { status: 400 }
      );
    }

    const allowedDeliveryTypes: DeliveryType[] = [
      "date",
      "immediate",
      "posthumous",
    ];

    if (
      delivery_type !== undefined &&
      !allowedDeliveryTypes.includes(delivery_type as DeliveryType)
    ) {
      return NextResponse.json(
        { error: "Please choose a valid delivery option." },
        { status: 400 }
      );
    }

    // Require a delivery_date when delivery_type is 'date'
    if (delivery_type === "date" && !delivery_date) {
      return NextResponse.json(
        {
          error:
            "Please choose a date for when this message should be delivered.",
        },
        { status: 400 }
      );
    }

    const capsule = await createCapsule({
      sender_id: typeof sender_id === "string" ? sender_id : null,
      recipient_name: recipient_name.trim(),
      recipient_contact: recipient_contact.trim(),
      video_url: null,
      message_text: null,
      transcript: null,
      delivery_type: (delivery_type as DeliveryType) ?? null,
      delivery_date:
        typeof delivery_date === "string" ? delivery_date : null,
      delivered_at: null,
      sealed_at: null,
    });

    return NextResponse.json(capsule, { status: 201 });
  } catch (error) {
    console.error("[POST /api/capsule]", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong on our end. Your message matters to us — please try again in a moment.",
      },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/capsule?id=xxx
// Fetch a capsule. Validates delivery_date for recipients.
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

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

    // For date-based capsules not yet delivered, protect the content
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

    // Never return the transcript or raw video key to the client directly
    const { transcript: _transcript, ...safeFields } = capsule;
    void _transcript; // intentionally omitted from response

    return NextResponse.json(safeFields, { status: 200 });
  } catch (error) {
    console.error("[GET /api/capsule]", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong while retrieving this capsule. Please try again.",
      },
      { status: 500 }
    );
  }
}
