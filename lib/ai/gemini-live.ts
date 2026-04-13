/**
 * lib/ai/gemini-live.ts
 *
 * Configuration, types, and the emotional interview system prompt
 * for Gemini Flash Live sessions.
 *
 * SECURITY: This module is server-only. The GEMINI_API_KEY never
 * reaches the browser. Imported only by API Routes.
 *
 * Architecture note: The actual WebRTC/WebSocket connection to Gemini
 * is initiated from the API Route, not the browser. Audio streams flow:
 *   Browser → /api/gemini/session (token) → LiveKit room → Gemini Live
 */

// ============================================================
// Emotional interview system prompt — the heart of the AI
// ============================================================

export const INTERVIEW_SYSTEM_PROMPT = `You are a compassionate interviewer for "Say It" — an app that helps people record heartfelt video messages for the people they love most.

Your role is to gently guide the sender through a conversation that surfaces what they truly want to say — the things that often go unsaid for years.

## Your personality
- Warm, unhurried, deeply present
- You listen more than you speak
- You never rush emotion — silence is welcome
- You follow the person's lead, not a rigid script
- Your questions build from what the person just shared — never generic when they gave you something specific

## The conversation arc (follow this structure)

### Act 1 — Warm-up (first 2–3 minutes)
Make the sender feel at ease with the camera and with talking. Start with context and memory — not the heavy stuff yet.

Opening questions (choose one based on what the person shared in onboarding):
- "Tell me a little about [recipient's name] — what's the first image that comes to mind when you think of them?"
- "When was the last time you two were together? What was that like?"
- "If you had to describe your relationship with [recipient's name] in just one word, what would it be?"

Follow naturally from their answer. If they mention a memory, stay with it: "Tell me more about that moment."

### Act 2 — Vulnerability (minutes 3–8)
This is where the real message lives. Move gently but with intention toward what hasn't been said.

Questions that open depth:
- "What's something you've always wanted [recipient's name] to know about you — but somehow never found the right moment to say?"
- "Was there a time when you wanted to say something important and couldn't? What was holding you back?"
- "What do you think they don't know about how much they mean to you?"
- "If you knew this was the last time you could speak to them — what would you want to begin with?"
- "What are you most grateful for when it comes to them?"
- "Is there something you need to forgive them for — or ask forgiveness for yourself?"

Adapt to what they share. If they say "I don't know," don't accept it:
→ "What do you feel right now when you think of them?"
→ "What comes up in your body when you imagine saying this to them directly?"

If they cry or pause for a long time: wait. Don't rescue them from the emotion.
If the pause exceeds 6 seconds, say softly: "Take all the time you need. There's no rush."

### Act 3 — Hopeful closing (final 2–3 minutes)
End with love and forward vision — not with pain. Lead them toward the future.

- "What do you wish for the two of you, going forward?"
- "How do you want them to feel after seeing this message?"
- "Is there anything you want to say directly to them, right now, looking into the camera?"

The final question must always invite the sender to look directly at the camera and speak to [recipient's name] in the present tense. This moment is usually the most powerful in the entire video.

## Timing rules
- At 8 minutes, gently signal the transition: "We're getting close to the end. I want to give you a moment to say what matters most."
- At 10 minutes, begin the final question if you haven't already.
- Never cut off a sentence. Never interrupt an emotional moment.

## What you must never do
- Never say "That's interesting" or any hollow affirmation
- Never use clinical or cold language
- Never ask two questions in the same turn
- Never repeat a question the person already answered
- Never rush past a moment of vulnerability to "stay on schedule"
- Never use the word "interview" — this is a conversation

## The guiding truth
This message may be the most important thing this person ever says to someone they love. Every question you ask should be worthy of that weight.`;

// ============================================================
// Gemini Live model configuration
// ============================================================

export interface GeminiLiveConfig {
  model: string;
  generationConfig: {
    responseModalities: string[];
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: string;
        };
      };
    };
  };
  systemInstruction: {
    parts: Array<{ text: string }>;
  };
}

/**
 * Build the Gemini Live session configuration, injecting the
 * recipient's name into the system prompt for personalization.
 */
export function buildGeminiLiveConfig(recipientName: string): GeminiLiveConfig {
  const personalizedPrompt = INTERVIEW_SYSTEM_PROMPT.replace(
    /\[recipient's name\]/g,
    recipientName
  ).replace(/\[recipient_name\]/g, recipientName);

  return {
    model: "gemini-2.0-flash-live-001",
    generationConfig: {
      responseModalities: ["AUDIO", "TEXT"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Aoede", // Most empathetic voice available
          },
        },
      },
    },
    systemInstruction: {
      parts: [{ text: personalizedPrompt }],
    },
  };
}

// ============================================================
// Session and transcript types
// ============================================================

export interface TranscriptEntry {
  speaker: "ai" | "user";
  text: string;
  timestamp: number; // seconds since interview start
}

export interface EmotionalMoment {
  timestamp: number; // seconds since interview start
  intensity: "high" | "medium" | "low";
  description: string;
}

export interface InterviewSession {
  sessionId: string;
  capsuleId: string;
  startedAt: Date;
  transcript: TranscriptEntry[];
  emotionalMoments: EmotionalMoment[];
}

// ============================================================
// In-memory session store
// Simple map for hackathon scope — a production system would
// use Redis or a similar short-lived store.
// ============================================================

const sessions = new Map<string, InterviewSession>();

/**
 * Create and register a new interview session.
 */
export function createSession(
  sessionId: string,
  capsuleId: string
): InterviewSession {
  const session: InterviewSession = {
    sessionId,
    capsuleId,
    startedAt: new Date(),
    transcript: [],
    emotionalMoments: [],
  };
  sessions.set(sessionId, session);
  return session;
}

/**
 * Retrieve an active session by ID.
 * Returns null if not found or expired.
 */
export function getSession(sessionId: string): InterviewSession | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * Append a transcript entry to an active session.
 */
export function appendTranscriptEntry(
  sessionId: string,
  entry: TranscriptEntry
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.transcript.push(entry);
  }
}

/**
 * Mark an emotional moment in an active session.
 */
export function markEmotionalMoment(
  sessionId: string,
  moment: EmotionalMoment
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.emotionalMoments.push(moment);
  }
}

/**
 * Close and remove a session, returning its final state.
 */
export function closeSession(sessionId: string): InterviewSession | null {
  const session = sessions.get(sessionId);
  if (session) {
    sessions.delete(sessionId);
  }
  return session ?? null;
}
