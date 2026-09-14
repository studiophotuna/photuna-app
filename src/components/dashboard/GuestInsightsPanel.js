// src/components/dashboard/GuestInsightsPanel.js
//
// Event analytics for what guests told the booth: survey answers (summarised
// and exportable as CSV), how many consent records reached the cloud, and what
// is still waiting on this PC to upload.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { getGuestOutboxStatus } from "../../services/guestOutbox";

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function GuestInsightsPanel({ eventId, eventName = "event", cardClass = "" }) {
  const [responses, setResponses] = useState([]);
  const [consentCount, setConsentCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError("");
    try {
      const [survey, consent] = await Promise.all([
        supabase
          .from("booth_survey_responses")
          .select("session_id, answers, submitted_at")
          .eq("event_id", String(eventId))
          .order("submitted_at", { ascending: false })
          .limit(1000),
        supabase
          .from("booth_consent_logs")
          .select("id", { count: "exact", head: true })
          .eq("event_id", String(eventId)),
      ]);
      if (survey.error) throw survey.error;
      setResponses(survey.data || []);
      setConsentCount(consent.error ? null : consent.count ?? 0);
    } catch (err) {
      setError(err?.message || "Could not load survey answers.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const loadQueue = useCallback(async () => {
    const api = window.api || window.electron;
    const [outbox, galleries] = await Promise.all([
      getGuestOutboxStatus(),
      api?.getGalleryQueueStatus ? api.getGalleryQueueStatus().catch(() => null) : null,
    ]);
    setQueue({ outbox: outbox?.ok ? outbox : null, galleries: galleries?.ok ? galleries : null });
  }, []);

  useEffect(() => {
    load();
    loadQueue();
    const id = setInterval(loadQueue, 15_000);
    return () => clearInterval(id);
  }, [load, loadQueue]);

  const retryNow = async () => {
    const api = window.api || window.electron;
    setRetrying(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (accessToken) {
        await api?.retryQueuedGalleries?.({ accessToken, wake: true });
        await api?.flushOutbox?.({ accessToken, wake: true });
      }
    } catch (err) {
      console.warn("[guest-insights] retry failed", err?.message || err);
    } finally {
      setRetrying(false);
      loadQueue();
      load();
    }
  };

  // Per question, keyed by id. Rows arrive newest first, so a question's prompt
  // is the wording guests saw most recently.
  const summary = useMemo(() => {
    const byQuestion = new Map();
    for (const row of responses) {
      for (const answer of Array.isArray(row.answers) ? row.answers : []) {
        if (!answer?.id) continue;
        if (!byQuestion.has(answer.id)) {
          byQuestion.set(answer.id, {
            id: answer.id,
            prompt: answer.prompt || "Question",
            type: answer.type,
            count: 0,
            sum: 0,
            dist: [0, 0, 0, 0, 0],
            choices: {},
            texts: [],
          });
        }
        const q = byQuestion.get(answer.id);
        q.count += 1;
        if (answer.type === "rating") {
          const n = Number(answer.value);
          if (n >= 1 && n <= 5) {
            q.sum += n;
            q.dist[n - 1] += 1;
          }
        } else if (answer.type === "choice") {
          const key = String(answer.value);
          q.choices[key] = (q.choices[key] || 0) + 1;
        } else if (answer.type === "text" && q.texts.length < 8) {
          q.texts.push({ value: String(answer.value), at: row.submitted_at });
        }
      }
    }
    return [...byQuestion.values()];
  }, [responses]);

  const exportCsv = () => {
    const header = ["Submitted at", "Session", ...summary.map((q) => q.prompt)];
    const rows = responses.map((row) => {
      const byId = Object.fromEntries((row.answers || []).map((a) => [a.id, a.value]));
      return [new Date(row.submitted_at).toLocaleString(), row.session_id, ...summary.map((q) => byId[q.id] ?? "")];
    });
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey-${String(eventName).replace(/[^\w-]+/g, "_").slice(0, 40) || "event"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const outbox = queue?.outbox;
  const galleries = queue?.galleries;
  const waiting = [
    galleries?.pending ? `${galleries.pending} ${galleries.pending === 1 ? "gallery" : "galleries"}` : null,
    outbox?.byKind?.consent?.pending ? plural(outbox.byKind.consent.pending, "consent record") : null,
    outbox?.byKind?.survey?.pending ? plural(outbox.byKind.survey.pending, "survey answer") : null,
    outbox?.byKind?.email?.pending ? plural(outbox.byKind.email.pending, "email") : null,
  ].filter(Boolean);
  const failed = (galleries?.permanentlyFailed || 0) + (outbox?.permanentlyFailed || 0);

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Guest feedback & records</div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Survey answers for this event, and what this booth PC still has to upload.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={responses.length === 0}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {queue && (outbox || galleries) && (
        <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ${
          waiting.length || failed ? "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
        }`}>
          <span>
            {waiting.length
              ? `Waiting to upload from this PC: ${waiting.join(" · ")}. They send automatically when the internet is back.`
              : "Everything from this PC has been uploaded."}
            {failed > 0 && ` ${plural(failed, "item")} could not be sent and will not be retried (see the gallery log).`}
          </span>
          {waiting.length > 0 && (
            <button type="button" onClick={retryNow} disabled={retrying} className="rounded-md bg-white/70 dark:bg-slate-800 px-2 py-1 font-semibold disabled:opacity-50">
              {retrying ? "Retrying…" : "Retry now"}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
          <div className="text-slate-500 dark:text-slate-400">Survey responses</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{loading ? "…" : responses.length}</div>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
          <div className="text-slate-500 dark:text-slate-400">Consent records saved</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{loading ? "…" : consentCount ?? "—"}</div>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {!loading && !error && responses.length === 0 && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          No survey answers yet. Turn the survey on under Session → Guest survey.
        </p>
      )}

      {summary.length > 0 && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {summary.map((q) => (
            <div key={q.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">{q.prompt}</div>
              <div className="text-[11px] text-slate-400">{plural(q.count, "answer")}</div>

              {q.type === "rating" && (
                <div className="mt-2">
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {q.count ? (q.sum / q.count).toFixed(1) : "—"} <span className="text-sm text-amber-500">★</span>
                  </div>
                  {q.dist.map((n, i) => (
                    <div key={i} className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="w-6">{i + 1}★</span>
                      <div className="h-1.5 flex-1 rounded bg-slate-100 dark:bg-slate-800">
                        <div className="h-1.5 rounded bg-amber-400" style={{ width: `${q.count ? (n / q.count) * 100 : 0}%` }} />
                      </div>
                      <span className="w-6 text-right tabular-nums">{n}</span>
                    </div>
                  ))}
                </div>
              )}

              {q.type === "choice" && (
                <div className="mt-2 space-y-1">
                  {Object.entries(q.choices).sort((a, b) => b[1] - a[1]).map(([option, n]) => (
                    <div key={option} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="w-24 truncate" title={option}>{option}</span>
                      <div className="h-1.5 flex-1 rounded bg-slate-100 dark:bg-slate-800">
                        <div className="h-1.5 rounded bg-blue-500" style={{ width: `${(n / q.count) * 100}%` }} />
                      </div>
                      <span className="w-6 text-right tabular-nums">{n}</span>
                    </div>
                  ))}
                </div>
              )}

              {q.type === "text" && (
                <ul className="mt-2 space-y-1">
                  {q.texts.map((t, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-300">
                      “{t.value}”
                    </li>
                  ))}
                  {q.count > q.texts.length && (
                    <li className="text-[11px] text-slate-400">Latest {q.texts.length} shown; export CSV for all.</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
