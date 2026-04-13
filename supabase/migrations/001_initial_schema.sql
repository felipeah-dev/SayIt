-- ============================================================
-- Say It — Initial Schema Migration
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================================
-- Tables
-- ============================================================

-- Senders / authenticated users
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emotional capsules
CREATE TABLE IF NOT EXISTS capsules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_name    TEXT NOT NULL,
  recipient_contact TEXT NOT NULL,
  video_url         TEXT,           -- Key in Cloudflare R2 (never a permanent URL)
  message_text      TEXT,           -- Written message refined by Claude
  transcript        TEXT,           -- Full interview transcript
  delivery_type     TEXT CHECK (delivery_type IN ('date', 'immediate', 'posthumous')),
  delivery_date     TIMESTAMP WITH TIME ZONE,
  delivered_at      TIMESTAMP WITH TIME ZONE,
  sealed_at         TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recipient openings / re-openings
CREATE TABLE IF NOT EXISTS capsule_openings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capsule_id      UUID REFERENCES capsules(id) ON DELETE CASCADE,
  opened_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  emotional_state TEXT      -- Result of the emotional check-in
);

-- ============================================================
-- Row Level Security — enabled on ALL tables from day one
-- ============================================================

ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE capsules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE capsule_openings ENABLE ROW LEVEL SECURITY;

-- -------- users policies --------
-- A user may only read their own row
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Supabase Auth inserts the row automatically on sign-up,
-- but we allow explicit insert when auth.uid() matches
CREATE POLICY "users_insert_own"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- -------- capsules policies --------
-- Senders see only their own capsules
CREATE POLICY "capsules_select_own"
  ON capsules FOR SELECT
  USING (auth.uid() = sender_id);

-- Senders may create capsules under their own identity
CREATE POLICY "capsules_insert_own"
  ON capsules FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- Senders may update only their own unsealed capsules
CREATE POLICY "capsules_update_own"
  ON capsules FOR UPDATE
  USING (auth.uid() = sender_id AND sealed_at IS NULL);

-- NOTE: Recipient access to capsules is handled exclusively
-- through API Routes that use the service_role key, which
-- bypasses RLS intentionally and safely.

-- -------- capsule_openings policies --------
-- Only service_role (API) may insert openings — no direct client writes
-- (No permissive policy = deny by default for authenticated/anon roles)
-- Service_role bypasses RLS; this table remains locked for client roles.

-- ============================================================
-- Deferred delivery function
-- ============================================================

CREATE OR REPLACE FUNCTION deliver_capsule(capsule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER   -- runs with owner privileges to bypass RLS
AS $$
BEGIN
  UPDATE capsules
  SET delivered_at = NOW()
  WHERE id = capsule_id
    AND delivered_at IS NULL
    AND sealed_at IS NOT NULL
    AND delivery_type = 'date'
    AND delivery_date <= NOW();
END;
$$;

-- ============================================================
-- pg_cron job — check and deliver capsules every 5 minutes
-- NOTE: pg_cron must be enabled in Supabase dashboard first.
-- Run this block separately after enabling the extension.
-- ============================================================

SELECT cron.schedule(
  'check-capsule-delivery',
  '*/5 * * * *',
  $$
    SELECT deliver_capsule(id)
    FROM capsules
    WHERE delivery_type = 'date'
      AND delivery_date <= NOW()
      AND delivered_at IS NULL
      AND sealed_at IS NOT NULL;
  $$
);
