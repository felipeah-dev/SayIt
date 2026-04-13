/**
 * lib/video/ffmpeg-editor.ts
 *
 * Client-side video editor using ffmpeg.wasm.
 * Runs entirely in the user's browser — zero server cost.
 *
 * Takes a full interview recording and a list of timestamps from
 * Gemini Pro, cuts the best segments, and concatenates them into
 * a final MP4 that never exceeds 4 minutes (240 seconds).
 *
 * IMPORTANT: This module must only be imported in Client Components
 * (with "use client"). It uses browser APIs and WebAssembly.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// ============================================================
// Types
// ============================================================

export interface EditVideoParams {
  /** The full interview recording as a Blob (MP4 or WebM) */
  videoBlob: Blob;
  /**
   * Pairs of [start, end] timestamps in seconds to include in the
   * final video. Provided by Gemini Pro analysis.
   * Example: [0, 45, 120, 180] → two segments: 0–45s and 120–180s
   */
  timestamps: number[];
  /** Maximum output duration in seconds. Default: 240 (4 minutes) */
  maxDurationSeconds?: number;
  /** Progress callback. Receives a value from 0 to 100. */
  onProgress?: (progress: number) => void;
}

export interface EditVideoResult {
  /** The final edited video as an MP4 Blob */
  editedBlob: Blob;
  /** Actual duration of the output video in seconds */
  durationSeconds: number;
  /** File size in megabytes */
  fileSizeMB: number;
}

// ============================================================
// Internal state — ffmpeg is loaded once and reused
// ============================================================

let ffmpegInstance: FFmpeg | null = null;
let isLoaded = false;

// CDN base for ffmpeg-core WASM (version-pinned for stability)
const FFMPEG_CORE_CDN =
  "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

// ============================================================
// Public API
// ============================================================

/**
 * Load ffmpeg.wasm into memory. Call this once before editing.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function loadFFmpeg(): Promise<void> {
  if (isLoaded && ffmpegInstance) return;

  const ffmpeg = new FFmpeg();

  await ffmpeg.load({
    coreURL: await toBlobURL(
      `${FFMPEG_CORE_CDN}/ffmpeg-core.js`,
      "text/javascript"
    ),
    wasmURL: await toBlobURL(
      `${FFMPEG_CORE_CDN}/ffmpeg-core.wasm`,
      "application/wasm"
    ),
  });

  ffmpegInstance = ffmpeg;
  isLoaded = true;
}

/**
 * Edit the interview video into a highlight reel.
 *
 * @param params - See EditVideoParams
 * @returns The edited video blob, duration, and file size
 * @throws If ffmpeg hasn't been loaded, call loadFFmpeg() first
 *
 * Algorithm:
 * 1. Parse timestamp pairs (start0, end0, start1, end1, ...)
 * 2. Clamp segments so the total never exceeds maxDurationSeconds
 * 3. Extract each segment with ffmpeg using -ss / -to
 * 4. Write a concat list file and merge all segments
 * 5. Return the final MP4
 */
export async function editVideo(
  params: EditVideoParams
): Promise<EditVideoResult> {
  const {
    videoBlob,
    timestamps,
    maxDurationSeconds = 240,
    onProgress,
  } = params;

  if (!ffmpegInstance || !isLoaded) {
    throw new Error(
      "ffmpeg hasn't been loaded yet. Call loadFFmpeg() before editVideo()."
    );
  }

  const ffmpeg = ffmpegInstance;

  // ── 1. Parse and validate timestamp pairs ────────────────────
  const segments = parseTimestampPairs(timestamps);

  if (segments.length === 0) {
    throw new Error(
      "No valid timestamp segments were provided for video editing."
    );
  }

  // ── 2. Clamp segments to fit within maxDurationSeconds ───────
  const clampedSegments = clampToDuration(segments, maxDurationSeconds);

  const totalEstimated = clampedSegments.reduce(
    (acc, [start, end]) => acc + (end - start),
    0
  );

  // Total steps: write source + N extractions + concat + read = N + 3
  const totalSteps = clampedSegments.length + 3;
  let completedSteps = 0;

  const reportProgress = (label: string) => {
    completedSteps++;
    const pct = Math.round((completedSteps / totalSteps) * 100);
    onProgress?.(Math.min(pct, 99)); // never report 100 until we have the blob
    void label; // suppress unused-variable lint
  };

  // ── 3. Write source video to virtual FS ──────────────────────
  const sourceExt = videoBlob.type.includes("webm") ? "webm" : "mp4";
  const sourceFile = `source.${sourceExt}`;
  await ffmpeg.writeFile(sourceFile, await fetchFile(videoBlob));
  reportProgress("source written");

  // ── 4. Extract each segment ───────────────────────────────────
  const segmentFiles: string[] = [];

  for (let i = 0; i < clampedSegments.length; i++) {
    const [start, end] = clampedSegments[i];
    const segFile = `segment_${i}.mp4`;

    await ffmpeg.exec([
      "-ss", String(start),
      "-to", String(end),
      "-i", sourceFile,
      "-c:v", "libx264",
      "-crf", "23",
      "-preset", "fast",
      "-c:a", "aac",
      "-b:a", "128k",
      // Force consistent frame timestamps for concat
      "-avoid_negative_ts", "make_zero",
      "-y",
      segFile,
    ]);

    segmentFiles.push(segFile);
    reportProgress(`segment ${i} extracted`);
  }

  // ── 5. Build concat list and merge ────────────────────────────
  const concatList = segmentFiles
    .map((f) => `file '${f}'`)
    .join("\n");

  await ffmpeg.writeFile(
    "concat_list.txt",
    new TextEncoder().encode(concatList)
  );

  const outputFile = "output.mp4";

  await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "concat_list.txt",
    "-c", "copy",
    "-y",
    outputFile,
  ]);

  reportProgress("concat done");

  // ── 6. Read output and clean up ───────────────────────────────
  const outputData = await ffmpeg.readFile(outputFile);
  // ffmpeg.readFile returns Uint8Array | string — we need bytes
  let outputBytes: Uint8Array;
  if (outputData instanceof Uint8Array) {
    outputBytes = outputData;
  } else {
    // Encode string fallback as UTF-8 bytes (should not occur for binary files)
    outputBytes = new TextEncoder().encode(outputData as string);
  }

  // Clean up virtual FS to free memory
  await cleanupFiles(ffmpeg, [
    sourceFile,
    "concat_list.txt",
    outputFile,
    ...segmentFiles,
  ]);

  reportProgress("cleanup done");

  // Copy into a plain ArrayBuffer to satisfy strict Blob typing
  const plainBuffer = outputBytes.buffer.slice(
    outputBytes.byteOffset,
    outputBytes.byteOffset + outputBytes.byteLength
  ) as ArrayBuffer;

  const editedBlob = new Blob([plainBuffer], { type: "video/mp4" });
  const fileSizeMB = editedBlob.size / (1024 * 1024);

  onProgress?.(100);

  return {
    editedBlob,
    durationSeconds: Math.round(totalEstimated),
    fileSizeMB: Math.round(fileSizeMB * 100) / 100,
  };
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Parse a flat array of numbers into start/end pairs.
 * [0, 45, 120, 180] → [[0, 45], [120, 180]]
 * Skips malformed pairs (start >= end or negative values).
 */
function parseTimestampPairs(
  timestamps: number[]
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];

  for (let i = 0; i + 1 < timestamps.length; i += 2) {
    const start = timestamps[i];
    const end = timestamps[i + 1];

    if (
      typeof start === "number" &&
      typeof end === "number" &&
      start >= 0 &&
      end > start
    ) {
      pairs.push([start, end]);
    }
  }

  return pairs;
}

/**
 * Clamp an array of segments so the total output duration
 * never exceeds `maxSeconds`. The last segment is trimmed if needed.
 *
 * This is the mathematical guarantee that the final video ≤ 4 minutes.
 */
function clampToDuration(
  segments: Array<[number, number]>,
  maxSeconds: number
): Array<[number, number]> {
  const clamped: Array<[number, number]> = [];
  let accumulated = 0;

  for (const [start, end] of segments) {
    if (accumulated >= maxSeconds) break;

    const remaining = maxSeconds - accumulated;
    const segDuration = end - start;

    if (segDuration <= remaining) {
      clamped.push([start, end]);
      accumulated += segDuration;
    } else {
      // Trim this segment to exactly fill the remaining budget
      clamped.push([start, start + remaining]);
      accumulated = maxSeconds;
      break;
    }
  }

  return clamped;
}

/**
 * Silently attempt to delete a list of files from the ffmpeg
 * virtual filesystem. Errors are swallowed — cleanup is best-effort.
 */
async function cleanupFiles(
  ffmpeg: FFmpeg,
  files: string[]
): Promise<void> {
  for (const file of files) {
    try {
      await ffmpeg.deleteFile(file);
    } catch {
      // Intentional: cleanup is best-effort, never throw
    }
  }
}
