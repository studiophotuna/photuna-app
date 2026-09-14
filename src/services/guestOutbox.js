// src/services/guestOutbox.js
//
// How booth screens hand over guest records: consent, survey answers, and
// requests to email a gallery link. On Windows they go into the main process's
// outbox (electron/services/cloudOutbox.js), which keeps them through no
// internet and restarts. iPad and web builds have no such queue yet, so there
// they are sent straight away, best effort.
//
// The row shapes below mirror sendOutboxJob in electron/main.js; change both.

import { supabase } from "./supabase";

const bridge = () => (typeof window !== "undefined" ? window.api || window.electron || null : null);

async function currentSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

let flushTimer = null;

/** Ask main to send whatever is due. Coalesces bursts of records into one flush. */
export function flushGuestOutboxSoon({ delayMs = 400, wake = false } = {}) {
  const api = bridge();
  if (!api?.flushOutbox) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    const session = await currentSession();
    if (!session?.access_token) return;
    try {
      await api.flushOutbox({ accessToken: session.access_token, wake });
    } catch (err) {
      console.warn("[guest-outbox] flush failed", err?.message || err);
    }
  }, delayMs);
}

/**
 * Hand a record to the outbox. Resolves { ok } once it is safely stored (Windows)
 * or sent (iPad/web); never throws.
 */
export async function queueGuestRecord(kind, id, payload) {
  const api = bridge();
  if (api?.enqueueOutbox) {
    try {
      const res = await api.enqueueOutbox({ kind, id, payload });
      if (res?.ok) flushGuestOutboxSoon();
      return res || { ok: false, error: "no response" };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  try {
    await sendDirect(kind, id, payload);
    return { ok: true, sent: true };
  } catch (err) {
    console.warn(`[guest-outbox] ${kind} could not be sent`, err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function getGuestOutboxStatus() {
  const api = bridge();
  if (!api?.getOutboxStatus) return null;
  try {
    return await api.getOutboxStatus();
  } catch {
    return null;
  }
}

async function sendDirect(kind, id, p = {}) {
  const session = await currentSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("signed out");

  if (kind === "consent") {
    const { error } = await supabase.from("booth_consent_logs").upsert({
      session_id: String(p.sessionId),
      event_id: String(p.eventId || "unknown"),
      booth_id: p.boothId ?? null,
      consent_version: String(p.consentVersion || "1.0"),
      consented_at: p.consentedAt || new Date().toISOString(),
      disclaimer_hash: p.disclaimerHash ?? null,
      disclaimer_text: p.disclaimerText ?? null,
      user_id: userId,
    }, { onConflict: "session_id", ignoreDuplicates: true });
    if (error) throw error;
    return;
  }

  if (kind === "survey") {
    const { error } = await supabase.from("booth_survey_responses").upsert({
      user_id: userId,
      event_id: String(p.eventId || "unknown"),
      session_id: String(p.sessionId),
      survey_version: p.surveyVersion ?? null,
      answers: Array.isArray(p.answers) ? p.answers : [],
      submitted_at: p.submittedAt || new Date().toISOString(),
    }, { onConflict: "user_id,session_id", ignoreDuplicates: true });
    if (error) throw error;
    return;
  }

  if (kind === "email") {
    const { error } = await supabase.functions.invoke("send-gallery-email", {
      body: { requestId: id, slug: p.slug, email: p.email, eventName: p.eventName, language: p.language },
    });
    if (error) throw error;
    return;
  }

  throw new Error(`unknown record kind: ${kind}`);
}
