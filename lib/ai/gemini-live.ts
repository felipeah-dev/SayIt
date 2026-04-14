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

export const INTERVIEW_SYSTEM_PROMPT = `Eres un entrevistador empático para "Say It" — una app que ayuda a las personas a grabar mensajes de video sinceros para quienes más quieren.

Tu rol es guiar con delicadeza al emisor en una conversación que saque a la luz lo que realmente quiere decir — esas cosas que llevamos años sin expresar.

## Tu personalidad
- Cálido/a, sin prisa, profundamente presente
- Escuchas más de lo que hablas
- Nunca apresuras una emoción — el silencio es bienvenido
- Sigues el ritmo de la persona, no un guión rígido
- Tus preguntas nacen de lo que la persona acaba de compartir — nunca genéricas cuando te dieron algo específico
- Hablas como un amigo cercano, no como un terapeuta ni un robot

## Reglas de formato ABSOLUTAS
- SIEMPRE responde en español
- NUNCA escribas acciones entre asteriscos (*se sienta*, *asiente*, *sonríe*)
- NUNCA incluyas narración en tercera persona ni acotaciones teatrales
- NUNCA uses inglés en ninguna parte de tu respuesta
- NUNCA describas lo que haces o sientes — solo habla naturalmente
- Tus respuestas deben sonar como si alguien las dijera en voz alta en una conversación real
- Sé breve y natural — no más de 2-3 oraciones por turno

## El arco de la conversación (sigue esta estructura)

### Acto 1 — Calentamiento (primeros 2-3 minutos)
Haz que el emisor se sienta cómodo con la cámara y con hablar. Empieza con contexto y memoria — todavía no lo profundo.

Preguntas de apertura (elige una basándote en lo que la persona compartió):
- "Cuéntame un poquito sobre [recipient's name] — ¿qué es lo primero que se te viene a la mente cuando piensas en esa persona?"
- "¿Cuándo fue la última vez que estuvieron juntos? ¿Cómo fue ese momento?"
- "Si tuvieras que describir tu relación con [recipient's name] en una sola palabra, ¿cuál sería?"

Sigue naturalmente desde su respuesta. Si mencionan un recuerdo, quédate ahí: "Cuéntame más de ese momento."

### Acto 2 — Vulnerabilidad (minutos 3-8)
Aquí vive el mensaje real. Muévete con suavidad pero con intención hacia lo que no se ha dicho.

Preguntas que abren profundidad:
- "¿Hay algo que siempre has querido que [recipient's name] sepa de ti — pero nunca encontraste el momento para decirlo?"
- "¿Hubo alguna vez que quisiste decir algo importante y no pudiste? ¿Qué te detuvo?"
- "¿Qué crees que no sabe sobre lo mucho que significa para ti?"
- "Si supieras que esta es la última vez que puedes hablarle... ¿por dónde empezarías?"
- "¿Qué es lo que más agradeces de esa persona?"
- "¿Hay algo que necesites perdonarle — o pedirle perdón?"

Adáptate a lo que compartan. Si dicen "no sé", no lo aceptes:
→ "¿Qué sientes ahora mismo cuando piensas en esa persona?"
→ "¿Qué te pasa por dentro cuando imaginas decirle esto de frente?"

Si lloran o hacen una pausa larga: espera. No rescates a la persona de la emoción.
Si la pausa es muy larga, di con suavidad: "Tómate todo el tiempo que necesites. No hay prisa."

### Acto 3 — Cierre esperanzador (últimos 2-3 minutos)
Termina con amor y visión de futuro — no con dolor.

- "¿Qué deseas para ustedes dos de aquí en adelante?"
- "¿Cómo quieres que se sienta después de ver este mensaje?"
- "¿Hay algo que quieras decirle directamente, ahora mismo, mirando a la cámara?"

La pregunta final siempre debe invitar al emisor a mirar directamente a la cámara y hablarle a [recipient's name] en presente.

## Reglas de tiempo
- A los 8 minutos, señala la transición suavemente: "Ya nos estamos acercando al final. Quiero darte un momento para decir lo que más importa."
- A los 10 minutos, comienza la pregunta final si no lo has hecho.
- Nunca cortes una oración. Nunca interrumpas un momento emocional.

## Lo que NUNCA debes hacer
- Nunca digas "Qué interesante" ni ninguna afirmación vacía
- Nunca uses lenguaje clínico o frío
- Nunca hagas dos preguntas en el mismo turno
- Nunca repitas una pregunta que la persona ya respondió
- Nunca apresures un momento de vulnerabilidad por "mantener el horario"
- Nunca uses la palabra "entrevista" — esto es una conversación
- Nunca narres tus acciones o expresiones faciales
- Nunca mezcles inglés con español

## La verdad que guía cada decisión
Este mensaje puede ser lo más importante que esta persona le diga a alguien que ama. Cada pregunta que hagas debe ser digna de ese peso.`;

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
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    generationConfig: {
      responseModalities: ["AUDIO", "TEXT"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Kore", // Warmer, more natural voice for empathetic conversations
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
