/**
 * app/api/gemini/analyze/route.ts
 *
 * POST /api/gemini/analyze
 *
 * Analyzes the full interview transcript with Gemini Pro.
 * Identifies the 3–5 most emotionally powerful moments,
 * calculates timestamps for a ≤4-minute final video, and
 * generates a first-person written message from the sender.
 *
 * SECURITY: GEMINI_API_KEY stays server-side. Never exposed.
 *
 * Body:
 *   {
 *     capsule_id: string
 *     transcript: TranscriptEntry[]
 *     total_duration: number   // seconds
 *   }
 *
 * Response:
 *   {
 *     timestamps: number[]            // flat pairs [start, end, start, end, ...]
 *     message_draft: string           // first-person written message
 *     duration_selected: number       // total seconds of selected segments (≤240)
 *     emotional_highlights: string[]  // human-readable moment descriptions
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCapsuleById } from "@/lib/db/supabase";
import type { TranscriptEntry } from "@/lib/ai/gemini-live";

// ============================================================
// Constants
// ============================================================

const MAX_VIDEO_SECONDS = 240; // absolute hard limit: 4 minutes
const MIN_SEGMENT_SECONDS = 10; // discard segments shorter than this
const TARGET_SEGMENTS = 5; // ask Gemini to find up to this many

// ============================================================
// Types
// ============================================================

interface AnalyzeRequestBody {
  capsule_id: string;
  transcript: TranscriptEntry[];
  total_duration: number;
}

interface GeminiAnalysisResult {
  segments: Array<{
    start: number;
    end: number;
    description: string;
    emotional_intensity: "high" | "medium" | "low";
  }>;
  message_draft: string;
}

// ============================================================
// POST /api/gemini/analyze
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // ── Validate API key ──────────────────────────────────────
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[POST /api/gemini/analyze] GEMINI_API_KEY not configured");
      return NextResponse.json(
        {
          error:
            "The analysis service isn't available right now. Please try again in a moment.",
        },
        { status: 503 }
      );
    }

    // ── Parse body ────────────────────────────────────────────
    let body: AnalyzeRequestBody;
    try {
      body = (await request.json()) as AnalyzeRequestBody;
    } catch {
      return NextResponse.json(
        { error: "We couldn't read your request. Please try again." },
        { status: 400 }
      );
    }

    const { capsule_id, transcript, total_duration } = body;

    // ── Validate inputs ───────────────────────────────────────
    if (!capsule_id || typeof capsule_id !== "string") {
      return NextResponse.json(
        { error: "A capsule ID is required." },
        { status: 400 }
      );
    }

    if (!Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json(
        {
          error:
            "No transcript was provided. Please complete the interview first.",
        },
        { status: 400 }
      );
    }

    if (
      typeof total_duration !== "number" ||
      total_duration <= 0 ||
      total_duration > 720 // max 12 minutes
    ) {
      return NextResponse.json(
        { error: "Please provide a valid interview duration." },
        { status: 400 }
      );
    }

    // ── Verify capsule exists ─────────────────────────────────
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

    // ── Call Gemini Pro ───────────────────────────────────────
    const analysis = await analyzeWithGeminiPro(
      apiKey,
      transcript,
      total_duration,
      capsule.recipient_name
    );

    // ── Clamp segments to ≤240 seconds (mathematical guarantee) ─
    const { segments, message_draft } = analysis;

    const clampedSegments = clampSegmentsToMaxDuration(
      segments,
      MAX_VIDEO_SECONDS
    );

    const timestamps: number[] = clampedSegments.flatMap(([s, e]) => [s, e]);
    const durationSelected = clampedSegments.reduce(
      (acc, [s, e]) => acc + (e - s),
      0
    );
    const emotionalHighlights = clampedSegments.map(
      (_, i) => segments[i]?.description ?? `Emotional moment ${i + 1}`
    );

    return NextResponse.json(
      {
        timestamps,
        message_draft,
        duration_selected: Math.round(durationSelected),
        emotional_highlights: emotionalHighlights,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/gemini/analyze]", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong while analyzing the interview. Your recording is safe — please try again.",
      },
      { status: 500 }
    );
  }
}

// ============================================================
// Gemini Pro analysis
// ============================================================

async function analyzeWithGeminiPro(
  apiKey: string,
  transcript: TranscriptEntry[],
  totalDuration: number,
  recipientName: string
): Promise<GeminiAnalysisResult> {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Use the most capable available model
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
  });

  const transcriptText = formatTranscriptForAnalysis(transcript);

  const prompt = buildAnalysisPrompt(
    transcriptText,
    totalDuration,
    recipientName
  );

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  return parseGeminiAnalysisResponse(responseText, totalDuration);
}

function formatTranscriptForAnalysis(transcript: TranscriptEntry[]): string {
  return transcript
    .map((entry) => {
      const speaker = entry.speaker === "ai" ? "Interviewer" : "Sender";
      const time = formatTime(entry.timestamp);
      return `[${time}] ${speaker}: ${entry.text}`;
    })
    .join("\n");
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildAnalysisPrompt(
  transcriptText: string,
  totalDuration: number,
  recipientName: string
): string {
  return `You are analyzing an emotional interview for a heartfelt video message. The sender recorded a conversation to create a personal video for ${recipientName}.

## Your tasks

### Task 1: Identify emotional segments
Find the ${TARGET_SEGMENTS} most emotionally significant and authentic moments in the transcript. These are the moments that best capture what the sender truly wants to say — vulnerability, love, gratitude, or longing.

Rules for segments:
- Each segment must be at least ${MIN_SEGMENT_SECONDS} seconds long
- Segments must not overlap
- Total combined duration must not exceed ${MAX_VIDEO_SECONDS} seconds
- Timestamps must be within [0, ${totalDuration}] seconds
- Prioritize: direct addresses to ${recipientName}, emotional peaks, moments of genuine vulnerability, and the sender speaking from the heart

### Task 2: Write the message
Write a personal letter in the first person FROM the sender TO ${recipientName}. This letter:
- Captures what the sender TRULY wanted to express (not just a summary)
- Uses the sender's actual words and phrases from the transcript where powerful
- Reads like a real letter, not a report
- Is written as if the sender wrote it themselves
- Maximum 600 words
- Does NOT start with "Dear" — start with something more intimate specific to their relationship

## Transcript
Total duration: ${Math.floor(totalDuration / 60)} minutes ${totalDuration % 60} seconds

${transcriptText}

## Response format
Respond ONLY with valid JSON in this exact structure:
{
  "segments": [
    {
      "start": <number: seconds>,
      "end": <number: seconds>,
      "description": "<one sentence describing why this moment matters>",
      "emotional_intensity": "<high|medium|low>"
    }
  ],
  "message_draft": "<the full first-person letter text>"
}

No markdown, no explanation, no code blocks. Just the JSON.`;
}

function parseGeminiAnalysisResponse(
  responseText: string,
  totalDuration: number
): GeminiAnalysisResult {
  // Strip potential markdown code fences
  const cleaned = responseText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Gemini returned an unexpected response format. Raw: ${cleaned.slice(0, 200)}`
    );
  }

  const result = parsed as Record<string, unknown>;

  if (!Array.isArray(result.segments) || typeof result.message_draft !== "string") {
    throw new Error("Gemini response is missing required fields.");
  }

  // Validate and sanitize each segment
  const validatedSegments = (
    result.segments as Array<Record<string, unknown>>
  )
    .filter(
      (seg) =>
        typeof seg.start === "number" &&
        typeof seg.end === "number" &&
        seg.start >= 0 &&
        seg.end > seg.start &&
        seg.end <= totalDuration &&
        (seg.end as number) - (seg.start as number) >= MIN_SEGMENT_SECONDS
    )
    .map((seg) => ({
      start: seg.start as number,
      end: seg.end as number,
      description:
        typeof seg.description === "string"
          ? seg.description
          : "An important moment",
      emotional_intensity: (["high", "medium", "low"].includes(
        seg.emotional_intensity as string
      )
        ? seg.emotional_intensity
        : "medium") as "high" | "medium" | "low",
    }));

  if (validatedSegments.length === 0) {
    // Fallback: use the first 4 minutes of the interview
    const fallbackEnd = Math.min(totalDuration, MAX_VIDEO_SECONDS);
    validatedSegments.push({
      start: 0,
      end: fallbackEnd,
      description: "Full interview (fallback — no segments identified)",
      emotional_intensity: "medium",
    });
  }

  return {
    segments: validatedSegments,
    message_draft: result.message_draft as string,
  };
}

// ============================================================
// Duration clamping — mathematical guarantee ≤ 240s
// ============================================================

function clampSegmentsToMaxDuration(
  segments: GeminiAnalysisResult["segments"],
  maxSeconds: number
): Array<[number, number]> {
  // Sort by emotional intensity first (high → medium → low), then by start time
  const intensityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...segments].sort((a, b) => {
    const intensityDiff =
      intensityOrder[a.emotional_intensity] -
      intensityOrder[b.emotional_intensity];
    return intensityDiff !== 0 ? intensityDiff : a.start - b.start;
  });

  const result: Array<[number, number]> = [];
  let accumulated = 0;

  for (const seg of sorted) {
    if (accumulated >= maxSeconds) break;

    const remaining = maxSeconds - accumulated;
    const segDuration = seg.end - seg.start;

    if (segDuration <= remaining) {
      result.push([seg.start, seg.end]);
      accumulated += segDuration;
    } else {
      // Trim the last segment to fit exactly
      result.push([seg.start, seg.start + remaining]);
      accumulated = maxSeconds;
      break;
    }
  }

  // Re-sort result by start time for chronological playback
  result.sort(([a], [b]) => a - b);

  return result;
}
