import React from "react";

function formatDate(ts) {
  if (!ts) return "-";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

function normalizePlan(raw) {
  if (raw === "pro_yearly") return "yearly";
  if (raw === "pro_monthly" || raw === "pro") return "monthly";
  return raw;
}

const PLAN_DEFAULTS = {
  trial:   { maxEvents: 3,  templates: 5,   watermark: true,  prioritySupport: false },
  monthly: { maxEvents: 20, templates: 30,  watermark: false, prioritySupport: false },
  yearly:  { maxEvents: 50, templates: 100, watermark: false, prioritySupport: true  },
};

// Usage bar. A plan limit on its own ("20 max") does not tell an operator
// whether they are about to hit it; used-against-limit does, and turns the
// upgrade prompt into a fact rather than an advert.
function UsageMeter({ label, used, max }) {
  const hasLimit = Number.isFinite(max) && max > 0;
  const pct = hasLimit ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const tone =
    !hasLimit ? "bg-slate-300 dark:bg-slate-600"
    : pct >= 100 ? "bg-red-500"
    : pct >= 80 ? "bg-amber-500"
    : "bg-blue-600";

  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-xs font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {used}
          <span className="font-medium text-slate-400 dark:text-slate-500"> / {hasLimit ? max : "∞"}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${hasLimit ? pct : 100}%` }} />
      </div>
    </div>
  );
}

export default function SubscriptionSummary({ license, gating, prices, usage }) {
  const rawPlan = license?.plan ?? gating?.plan ?? null;
  const plan = normalizePlan(rawPlan);
  const ent = license?.entitlements ?? {};
  const renewOrEnd = license?.expiresAt ?? gating?.expiresAt ?? null;

  const isActive = Boolean(license?.active || gating?.allow);

  // When Supabase is not configured or the trial hasn't been fully redeemed, entitlements
  // may come back as 0/undefined. Fall back to known plan defaults so the UI shows
  // what the plan SHOULD provide rather than misleading zeroes.
  const defaults = PLAN_DEFAULTS[plan] ?? { maxEvents: 0, templates: 0, watermark: true, prioritySupport: false };
  const maxEvents      = ent.maxEvents > 0       ? ent.maxEvents      : defaults.maxEvents;
  const templates      = ent.templates > 0       ? ent.templates      : defaults.templates;
  const watermark      = ent.watermark != null   ? ent.watermark      : defaults.watermark;
  const prioritySupport = ent.prioritySupport != null ? ent.prioritySupport : defaults.prioritySupport;

  const planLabel =
    plan === "yearly"   ? "Studio Photuna Pro — Yearly"
    : plan === "monthly" ? "Studio Photuna Pro — Monthly"
    : plan === "trial"   ? "14-Day Free Trial"
    : "No Active Plan";

  const priceDisplay =
    plan === "yearly"   ? (prices?.yearly?.display ?? "₱950 / mo")
    : plan === "monthly" ? (prices?.monthly?.display ?? "₱1,800 / mo")
    : plan === "trial"   ? "₱0"
    : "-";

  const priceSubtext =
    plan === "yearly"   ? `${prices?.yearly?.annual ?? "₱11,400"} one-time payment for 12 months`
    : plan === "monthly" ? "Billed monthly via GCash"
    : plan === "trial"   ? "No charge during trial"
    : null;

  // Events and Templates appear as usage meters below rather than chips —
  // "12 / 20" tells an operator something "20 max" does not.
  const features = [
    { label: "Watermark",       value: watermark ? "On photos" : "Removed",                          included: !watermark },
    { label: "Priority support",value: prioritySupport ? "Included" : "Not included",                included: prioritySupport },
    { label: "Gallery add-on",  value: (ent.galleryEnabled || ent.galleryAddon) ? "Enabled" : "Not included", included: Boolean(ent.galleryEnabled || ent.galleryAddon) },
  ];

  const showSavingsHint = plan !== "yearly" && prices?.monthly?.amount && prices?.yearly?.annualAmount;
  const savings = showSavingsHint
    ? Math.max(0, prices.monthly.amount * 12 - prices.yearly.annualAmount)
    : 0;
  const savingsPct = showSavingsHint && prices.monthly.amount > 0
    ? Math.round((savings / (prices.monthly.amount * 12)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Plan header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">{planLabel}</h4>
            {plan && (
              isActive
                ? <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">Active</span>
                : <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Restricted</span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {plan
              ? (plan === "trial" ? "Ends" : "Renews") + ` ${formatDate(renewOrEnd)}`
              : "You are currently not subscribed to any plan."}
          </p>
        </div>
        {plan && (
          <div className="text-right">
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{priceDisplay}</div>
            {priceSubtext && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{priceSubtext}</p>}
          </div>
        )}
      </div>

      {/* Usage against the plan's limits */}
      {plan && usage && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <UsageMeter label="Events" used={usage.events ?? 0} max={maxEvents} />
          <UsageMeter label="Templates" used={usage.templates ?? 0} max={templates} />
        </div>
      )}

      {/* Entitlements */}
      {plan && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {features.map(({ label, value, included }) => (
            <div key={label} className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                {included ? (
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                )}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
              </div>
              <div className={`mt-0.5 text-sm font-bold ${included ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Savings hint */}
      {savings > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          Save <b>₱{savings.toLocaleString()}</b> (~{savingsPct}%) by switching to Yearly.
        </div>
      )}
    </div>
  );
}
