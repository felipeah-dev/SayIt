/**
 * lib/storage/r2.ts
 *
 * Cloudflare R2 integration via AWS SDK v3.
 *
 * SECURITY RULES (absolute — never change):
 *   - All signed URLs expire in exactly 3600 seconds (1 hour). Never more.
 *   - Keys are never publicly readable. No bucket-level public access.
 *   - This module is server-only. Never import it in client components.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ============================================================
// Signed-URL expiration — ABSOLUTE SECURITY RULE: 1 hour max
// ============================================================
const SIGNED_URL_EXPIRES_IN = 3600; // seconds — do NOT increase

// ============================================================
// R2 client (lazy-initialised to avoid import-time crashes
// in environments where env vars are not yet loaded)
// ============================================================

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing Cloudflare R2 credentials. " +
        "Ensure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are set."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error(
      "Missing R2_BUCKET_NAME environment variable."
    );
  }
  return bucket;
}

// ============================================================
// Video operations
// ============================================================

/**
 * Upload an edited video buffer to R2.
 *
 * @param buffer    - Raw video bytes (MP4)
 * @param capsuleId - UUID of the capsule, used to build the key
 * @returns         The R2 object key (NOT a URL)
 */
export async function uploadVideo(
  buffer: Buffer,
  capsuleId: string
): Promise<string> {
  const client = getR2Client();
  const bucket = getBucketName();
  const key = `videos/${capsuleId}/final.mp4`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "video/mp4",
      // Metadata helps with debugging; never expose to client
      Metadata: {
        capsuleId,
        uploadedAt: new Date().toISOString(),
      },
    })
  );

  return key;
}

/**
 * Generate a signed URL for a video, valid for exactly 1 hour.
 *
 * @param key - R2 object key returned by uploadVideo()
 * @returns   Signed URL string (expires in 3600 s)
 */
export async function getSignedVideoUrl(key: string): Promise<string> {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, {
    expiresIn: SIGNED_URL_EXPIRES_IN, // 3600 — never change
  });
}

// ============================================================
// Exportable operations (PDF, Markdown)
// ============================================================

/**
 * Upload an exportable file (PDF or Markdown) to R2.
 *
 * @param buffer    - File bytes
 * @param type      - 'pdf' or 'markdown'
 * @param capsuleId - UUID of the associated capsule
 * @returns         The R2 object key
 */
export async function uploadExportable(
  buffer: Buffer,
  type: "pdf" | "markdown",
  capsuleId: string
): Promise<string> {
  const client = getR2Client();
  const bucket = getBucketName();

  const extension = type === "pdf" ? "pdf" : "md";
  const contentType =
    type === "pdf" ? "application/pdf" : "text/markdown; charset=utf-8";
  const key = `exportables/${capsuleId}/letter.${extension}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: {
        capsuleId,
        exportType: type,
        uploadedAt: new Date().toISOString(),
      },
    })
  );

  return key;
}

/**
 * Generate a signed URL for an exportable, valid for exactly 1 hour.
 *
 * @param key - R2 object key returned by uploadExportable()
 * @returns   Signed URL string (expires in 3600 s)
 */
export async function getSignedExportableUrl(key: string): Promise<string> {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, {
    expiresIn: SIGNED_URL_EXPIRES_IN, // 3600 — never change
  });
}
