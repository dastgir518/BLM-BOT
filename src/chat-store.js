import { supabase } from "./supabase.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_NAME_LENGTH = 120;

export function normalizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LENGTH);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidCustomer(name, email) {
  return Boolean(normalizeName(name)) && EMAIL_PATTERN.test(normalizeEmail(email));
}

// Look up an existing customer by email. Returns the stored row (including the
// accumulated profile) or null. Used to detect a returning visitor before the
// upsert refreshes their record.
export async function getCustomerByEmail(email) {
  const cleanEmail = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(cleanEmail)) return null;

  const { data, error } = await supabase
    .from("chat_customers")
    .select("id, name, profile")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Persist the facts learned about a customer (age, weight, condition, prefs).
export async function saveCustomerProfile({ customerId, profile }) {
  if (!customerId || !profile) return;

  const { error } = await supabase
    .from("chat_customers")
    .update({ profile, updated_at: new Date().toISOString() })
    .eq("id", customerId);

  if (error) throw error;
}

// Store the visitor's identity (deduped by email) and return its row id.
export async function registerCustomer({ name, email }) {
  const cleanName = normalizeName(name);
  const cleanEmail = normalizeEmail(email);
  if (!cleanName || !EMAIL_PATTERN.test(cleanEmail)) {
    throw new Error("A valid name and email are required");
  }

  const { data, error } = await supabase
    .from("chat_customers")
    .upsert(
      {
        name: cleanName,
        email: cleanEmail,
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

// Create or update the chat session and link it to a customer row.
export async function upsertChatSession({ sessionId, customerId, currentUrl, currentTitle }) {
  if (!sessionId || !customerId) {
    throw new Error("Chat session requires a session id and a customer");
  }

  const { error } = await supabase
    .from("chat_sessions")
    .upsert(
      {
        id: sessionId,
        customer_id: customerId,
        updated_at: new Date().toISOString(),
        metadata: {
          current_url: currentUrl || null,
          current_title: currentTitle || null
        }
      },
      { onConflict: "id" }
    );

  if (error) throw error;
}

// Register the customer and link the session in one step.
export async function startChatSession({ sessionId, name, email, currentUrl, currentTitle }) {
  const customerId = await registerCustomer({ name, email });
  await upsertChatSession({ sessionId, customerId, currentUrl, currentTitle });
  return customerId;
}

// Create or update a session for an anonymous (pre-email) visitor. customer_id
// is intentionally omitted: PostgREST upsert only updates supplied columns, so
// this never clobbers a link set later by linkSessionToCustomer.
export async function upsertAnonymousSession({ sessionId, currentUrl, currentTitle }) {
  if (!sessionId) {
    throw new Error("Chat session requires a session id");
  }

  const { error } = await supabase
    .from("chat_sessions")
    .upsert(
      {
        id: sessionId,
        updated_at: new Date().toISOString(),
        metadata: {
          current_url: currentUrl || null,
          current_title: currentTitle || null
        }
      },
      { onConflict: "id" }
    );

  if (error) throw error;
}

export async function saveChatMessage({ sessionId, role, content, metadata = {} }) {
  if (!sessionId || !role || !content) return null;

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role,
      content,
      metadata
    })
    .select("id")
    .single();

  if (error) throw error;
  return data?.id ?? null;
}

// Record a thumbs up/down on one of Mobi's replies. Scoped to the session so a
// visitor can only rate messages in their own conversation.
export async function saveMessageFeedback({ messageId, sessionId, rating }) {
  const id = Number(messageId);
  if (!Number.isInteger(id) || !sessionId || !["up", "down"].includes(rating)) {
    throw new Error("A valid message id, session, and rating are required");
  }

  const { error } = await supabase
    .from("chat_messages")
    .update({ feedback: rating })
    .eq("id", id)
    .eq("session_id", sessionId);

  if (error) throw error;
}

// Read recent chat messages (newest first) with the customer they belong to,
// for the admin "Recent chats" viewer. Service-role only.
export async function getRecentChats({ limit = 120 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 120, 1), 500);
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, session_id, role, content, feedback, created_at, chat_sessions(chat_customers(name, email))")
    .order("created_at", { ascending: false })
    .limit(capped);

  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: String(row.content || "").slice(0, 4000),
    feedback: row.feedback || null,
    created_at: row.created_at,
    customer_name: row.chat_sessions?.chat_customers?.name || null,
    customer_email: row.chat_sessions?.chat_customers?.email || null
  }));
}

const MAX_HANDOFF_TRANSCRIPT = 60;

// Record a human-handoff request for admin review. The email itself is sent by
// WordPress; this is the audit log in support_handoffs.
export async function saveSupportHandoff({ sessionId, name, email, phone, reason, transcript }) {
  const cleanName = normalizeName(name);
  const cleanEmail = normalizeEmail(email);
  if (!cleanName || !EMAIL_PATTERN.test(cleanEmail)) {
    throw new Error("A valid name and email are required for a handoff");
  }

  const trimmedTranscript = Array.isArray(transcript)
    ? transcript.slice(-MAX_HANDOFF_TRANSCRIPT).map((item) => ({
        role: String(item?.role || "").slice(0, 20),
        content: String(item?.content || "").slice(0, 2000)
      }))
    : null;

  const { error } = await supabase
    .from("support_handoffs")
    .insert({
      session_id: sessionId || null,
      name: cleanName,
      email: cleanEmail,
      phone: phone ? String(phone).trim().slice(0, 40) : null,
      reason: String(reason || "Customer requested a human").slice(0, 1000),
      transcript: trimmedTranscript,
      status: "new"
    });

  if (error) throw error;
}
