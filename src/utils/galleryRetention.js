// How long a guest's cloud gallery lasts, and how to say it.
//
// Mirrors public.gallery_retention_days() (migration 036), which sets each
// gallery's expires_at; the render service deletes the files at that moment.
// The two must agree, because the booth shows this number to guests as a promise.
//
//   Free / Trial   7 days
//   Monthly        6 months (180 days)
//   Yearly        12 months (365 days)
//
// The retired gallery add-on tiers keep what was bought (Plus 180, Business 365),
// and an operator gets whichever of plan and tier is longer.

const PLAN_DAYS = { free: 7, trial: 7, monthly: 180, yearly: 365 };
const TIER_DAYS = { plus: 180, business: 365 };

function canonicalPlan(raw) {
  const v = String(raw ?? "free").toLowerCase();
  if (v === "pro_yearly") return "yearly";
  if (v === "pro_monthly" || v === "pro") return "monthly";
  return v;
}

export function galleryRetentionDays(plan, galleryTier) {
  const planDays = PLAN_DAYS[canonicalPlan(plan)] ?? 7;
  const tierDays = TIER_DAYS[String(galleryTier ?? "").toLowerCase()] ?? 0;
  return Math.max(planDays, tierDays);
}

// "7 days", "6 months", "12 months".
export function formatRetention(days) {
  const d = Number(days) || 7;
  if (d >= 180 && d % 30 <= 5) {
    const months = d >= 365 ? Math.round(d / 365) * 12 : Math.round(d / 30);
    return `${months} month${months !== 1 ? "s" : ""}`;
  }
  return `${d} day${d !== 1 ? "s" : ""}`;
}
