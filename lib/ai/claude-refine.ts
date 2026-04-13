/**
 * lib/ai/claude-refine.ts
 *
 * Refines the AI-generated message draft using Claude Sonnet 4.6.
 * Claude amplifies warmth, depth, and humanity — without rewriting
 * the sender's voice or replacing their words.
 *
 * SECURITY: This module is server-only. ANTHROPIC_API_KEY never
 * reaches the browser. Only imported by API Routes.
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// Claude client (lazy init to avoid import-time crashes)
// ============================================================

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Ensure it is set in your environment variables."
    );
  }
  return new Anthropic({ apiKey });
}

// ============================================================
// Literary editor system prompt
// ============================================================

const REFINE_SYSTEM_PROMPT = `You are a literary editor specializing in heartfelt personal letters. You work with people's most vulnerable, important messages — the things they say to the people they love most.

Your role is to refine, not rewrite. The sender's voice is sacred.

## What you do
- Amplify warmth, depth, and humanity already present in the draft
- Smooth clumsy phrasing while preserving the sender's vocabulary and rhythm
- Ensure the message flows as naturally as a spoken letter, not a composed essay
- Bring out the emotional core that may be buried under hesitation or imprecision
- Ensure the ending lands with presence and love

## What you must never do
- Change the content or what is being said
- Introduce ideas, memories, or sentiments the sender didn't express
- Make it sound like you wrote it — it must sound like the sender
- Use literary flourishes that feel foreign to the sender's voice
- Make it longer than necessary — every sentence must earn its place
- Exceed 800 words total

## Format
Return only the refined message text — no preamble, no explanation, no quotation marks around it. Just the letter itself, ready to be given to the recipient.

## The guiding principle
This message may be the most important thing this person ever says. Treat every sentence with the weight it deserves.`;

// ============================================================
// Main export
// ============================================================

export interface RefineMessageParams {
  message_draft: string;
  recipient_name: string;
  transcript_summary?: string;
}

/**
 * Refine an AI-generated message draft with Claude Sonnet 4.6.
 *
 * @param params.message_draft      - The raw draft from Gemini Pro analysis
 * @param params.recipient_name     - The recipient's name for personalization
 * @param params.transcript_summary - Optional: key themes from the transcript
 *                                    for extra context to Claude
 * @returns The refined message, maximum 800 words
 */
export async function refineMessage(
  params: RefineMessageParams
): Promise<string> {
  const { message_draft, recipient_name, transcript_summary } = params;

  const client = getAnthropicClient();

  const userContent = buildUserPrompt(
    message_draft,
    recipient_name,
    transcript_summary
  );

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200, // ~800 words with buffer
    system: REFINE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error(
      "Something unexpected happened while refining the message. Please try again."
    );
  }

  const refined = content.text.trim();

  if (!refined) {
    throw new Error(
      "The refinement came back empty. Please try again in a moment."
    );
  }

  return refined;
}

// ============================================================
// Helpers
// ============================================================

function buildUserPrompt(
  draft: string,
  recipientName: string,
  transcriptSummary?: string
): string {
  const lines: string[] = [
    `The message below is for ${recipientName}.`,
    "",
    "Please refine it — preserve the sender's voice, amplify the emotional truth, and ensure it flows with warmth and authenticity.",
    "",
  ];

  if (transcriptSummary) {
    lines.push("## Context from the interview");
    lines.push(transcriptSummary);
    lines.push("");
  }

  lines.push("## Message draft");
  lines.push(draft);

  return lines.join("\n");
}
