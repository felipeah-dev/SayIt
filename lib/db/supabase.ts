/**
 * lib/db/supabase.ts
 *
 * Two Supabase clients with full TypeScript typing:
 *   - createServerClient()  — service_role key, for API Routes & Server Components
 *   - createBrowserClient() — anon key, for Client Components
 *
 * SECURITY: service_role key NEVER reaches the browser.
 * All server-side calls that need to bypass RLS use createServerClient().
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================
// TypeScript types aligned with the database schema
// ============================================================

export type DeliveryType = "date" | "immediate" | "posthumous";

export interface User {
  id: string;
  email: string | null;
  created_at: string;
}

export interface Capsule {
  id: string;
  sender_id: string | null;
  recipient_name: string;
  recipient_contact: string;
  /** R2 object key — never a raw permanent URL */
  video_url: string | null;
  message_text: string | null;
  transcript: string | null;
  delivery_type: DeliveryType | null;
  delivery_date: string | null;
  delivered_at: string | null;
  sealed_at: string | null;
  created_at: string;
}

export interface CapsuleOpening {
  id: string;
  capsule_id: string;
  opened_at: string;
  emotional_state: string | null;
}

export type CapsuleUpdate = Partial<
  Pick<
    Capsule,
    | "video_url"
    | "message_text"
    | "transcript"
    | "sealed_at"
    | "delivery_type"
    | "delivery_date"
    | "delivered_at"
  >
>;

// ============================================================
// Database shape — Supabase v2 generic structure
// Written inline to avoid TypeScript inference depth issues
// with aliased Partial<Omit<...>> types.
// ============================================================

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      capsules: {
        Row: {
          id: string;
          sender_id: string | null;
          recipient_name: string;
          recipient_contact: string;
          video_url: string | null;
          message_text: string | null;
          transcript: string | null;
          delivery_type: DeliveryType | null;
          delivery_date: string | null;
          delivered_at: string | null;
          sealed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id?: string | null;
          recipient_name: string;
          recipient_contact: string;
          video_url?: string | null;
          message_text?: string | null;
          transcript?: string | null;
          delivery_type?: DeliveryType | null;
          delivery_date?: string | null;
          delivered_at?: string | null;
          sealed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string | null;
          recipient_name?: string;
          recipient_contact?: string;
          video_url?: string | null;
          message_text?: string | null;
          transcript?: string | null;
          delivery_type?: DeliveryType | null;
          delivery_date?: string | null;
          delivered_at?: string | null;
          sealed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capsules_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      capsule_openings: {
        Row: {
          id: string;
          capsule_id: string;
          opened_at: string;
          emotional_state: string | null;
        };
        Insert: {
          id?: string;
          capsule_id: string;
          opened_at?: string;
          emotional_state?: string | null;
        };
        Update: {
          id?: string;
          capsule_id?: string;
          opened_at?: string;
          emotional_state?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_openings_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ============================================================
// Client factories
// ============================================================

/**
 * Server-side client — uses service_role key.
 * Bypasses RLS. Use only in API Routes and Server Components.
 * NEVER import this into client components.
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase server environment variables. " +
        "Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
    );
  }

  return createClient<Database>(url, key, {
    auth: {
      // Service role client does not manage user sessions
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Browser-side client — uses anon key.
 * Subject to RLS. Safe to use in Client Components.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase browser environment variables. " +
        "Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
    );
  }

  return createClient<Database>(url, key);
}

// ============================================================
// Helper functions — all use the server (service_role) client
// ============================================================

/**
 * Fetch a single capsule by its UUID.
 * Returns null if the capsule does not exist.
 */
export async function getCapsuleById(id: string): Promise<Capsule | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("capsules")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // row not found
    throw new Error(`Failed to retrieve capsule: ${error.message}`);
  }

  return data as Capsule;
}

/**
 * Create a new capsule record.
 * Returns the newly created capsule row.
 */
export async function createCapsule(
  data: Omit<Capsule, "id" | "created_at">
): Promise<Capsule> {
  const supabase = createServerClient();

  const { data: created, error } = await supabase
    .from("capsules")
    .insert({
      sender_id: data.sender_id,
      recipient_name: data.recipient_name,
      recipient_contact: data.recipient_contact,
      video_url: data.video_url,
      message_text: data.message_text,
      transcript: data.transcript,
      delivery_type: data.delivery_type,
      delivery_date: data.delivery_date,
      delivered_at: data.delivered_at,
      sealed_at: data.sealed_at,
    })
    .select()
    .single();

  if (error || !created) {
    throw new Error(
      `We couldn't create your capsule right now. Please try again in a moment.`
    );
  }

  return created as Capsule;
}

/**
 * Update fields on an existing capsule.
 * Returns the updated capsule row.
 */
export async function updateCapsule(
  id: string,
  data: CapsuleUpdate
): Promise<Capsule> {
  const supabase = createServerClient();

  const { data: updated, error } = await supabase
    .from("capsules")
    .update(data)
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    throw new Error(
      `We weren't able to save your changes. Please try again.`
    );
  }

  return updated as Capsule;
}

/**
 * Record a capsule opening event.
 * Uses service_role — the only way to insert into capsule_openings.
 */
export async function recordOpening(
  capsuleId: string,
  emotionalState?: string
): Promise<CapsuleOpening> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("capsule_openings")
    .insert({
      capsule_id: capsuleId,
      emotional_state: emotionalState ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `We couldn't record this opening. Please try again.`
    );
  }

  return data as CapsuleOpening;
}

/**
 * Count how many times a capsule has been opened.
 */
export async function countOpenings(capsuleId: string): Promise<number> {
  const supabase = createServerClient();

  const { count, error } = await supabase
    .from("capsule_openings")
    .select("*", { count: "exact", head: true })
    .eq("capsule_id", capsuleId);

  if (error) {
    throw new Error(`Failed to count openings: ${error.message}`);
  }

  return count ?? 0;
}
