/**
 * app/api/livekit/route.ts
 *
 * POST /api/livekit/token
 *
 * Generates a LiveKit access token for a given capsule interview room.
 *
 * Body: { capsule_id: string, participant_name: string }
 *
 * SECURITY:
 *   - LIVEKIT_API_SECRET never leaves the server
 *   - Token expires in 2 hours (7200 seconds) maximum
 *   - Room name is deterministic: capsule-{capsule_id}
 */

import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

// Token TTL — 2 hours maximum
const TOKEN_TTL_SECONDS = 7200;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error("[POST /api/livekit/token] Missing LiveKit credentials");
      return NextResponse.json(
        {
          error:
            "The interview room isn't available right now. Please try again in a moment.",
        },
        { status: 503 }
      );
    }

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "We couldn't understand your request. Please try again." },
        { status: 400 }
      );
    }

    const { capsule_id, participant_name } = body as Record<string, unknown>;

    if (typeof capsule_id !== "string" || !capsule_id.trim()) {
      return NextResponse.json(
        { error: "Please provide a valid capsule ID to join the room." },
        { status: 400 }
      );
    }

    if (typeof participant_name !== "string" || !participant_name.trim()) {
      return NextResponse.json(
        { error: "Please provide your name to enter the interview room." },
        { status: 400 }
      );
    }

    const roomName = `capsule-${capsule_id.trim()}`;
    const identity = participant_name.trim();

    // Build the access token
    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: identity,
      ttl: TOKEN_TTL_SECONDS,
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    return NextResponse.json(
      {
        token: jwt,
        room: roomName,
        identity,
        expires_in: TOKEN_TTL_SECONDS,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/livekit/token]", error);
    return NextResponse.json(
      {
        error:
          "We couldn't set up your interview room right now. Please try again — your story is worth telling.",
      },
      { status: 500 }
    );
  }
}
