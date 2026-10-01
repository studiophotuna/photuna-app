// supabase/functions/_shared/subscriptionGrant.ts
//
// The one place a paid subscription turns into a license. Every payment path
// (paymongo-link-status, paypal-order-status, paypal-return) goes through
// grantOnce(), so a payment can be applied exactly once no matter how many
// times, or from how many places, it arrives.
//
// Requires a service-role client: subscription_payments and licenses are not
// writable by users.

// deno-lint-ignore no-explicit-any
type AdminClient = any

// The retired gallery add-on (plus / business) is no longer granted. Operators
// who bought it keep licenses.gallery_tier, which is read elsewhere; only new
// purchases of it are refused.
export const KNOWN_PLANS = ['monthly', 'yearly']

const PLAN_DAYS: Record<string, number> = { monthly: 30, yearly: 365 }

export function planEntitlements(plan: string) {
  switch (plan) {
    case 'monthly':  return { watermark: false, max_events: 20, templates: 30,  priority_support: false }
    case 'yearly':   return { watermark: false, max_events: 50, templates: 100, priority_support: true }
    default:         return { watermark: true,  max_events: 0,  templates: 3,   priority_support: false }
  }
}

export type GrantInput = {
  provider: 'paypal' | 'paymongo'
  reference: string
  userId: string
  plan: string
  planType?: string | null
  amountCentavos?: number | null
  // For the operator's receipt (migration 024). How it was paid, and where the
  // record came from, so a reconstructed history is never shown as a live one.
  method?: string | null
  source?: 'app' | 'website' | 'backfill' | null
  currency?: string | null
}

// The second argument is the old plan type, which no longer changes the text.
export function planDescription(plan: string, _planType?: string | null): string {
  switch (plan) {
    case 'monthly': return 'Photuna Pro — Monthly'
    case 'yearly':  return 'Photuna Pro — Yearly'
    default:        return 'Photuna subscription'
  }
}

export type GrantResult =
  | { ok: true; alreadyGranted: boolean; expiresAt: string | null }

// Writes the license and returns the plan's new expiry.
async function applyLicense(admin: AdminClient, p: GrantInput): Promise<string | null> {
  const userId = p.userId

  const days = PLAN_DAYS[p.plan] ?? 30
  const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString()
  const { error } = await admin.from('licenses').upsert({
    user_id: userId,
    plan: p.plan,
    state: 'active',
    expires_at: expiresAt,
    ...planEntitlements(p.plan),
  }, { onConflict: 'user_id' })
  // Previously logged and ignored, so the caller still reported "paid" and the
  // app claimed an active plan that was never written.
  if (error) throw new Error('license_write_failed: ' + error.message)

  await admin.from('profiles').update({ subscription_plan: p.plan }).eq('id', userId)
  return expiresAt
}

export async function grantOnce(admin: AdminClient, p: GrantInput): Promise<GrantResult> {
  if (!KNOWN_PLANS.includes(p.plan)) throw new Error('unknown_plan')

  // Claim the payment. The unique (provider, reference) constraint makes this
  // the atomic "has this payment been used" check.
  const { error: claimErr } = await admin.from('subscription_payments').insert({
    provider: p.provider,
    reference: p.reference,
    user_id: p.userId,
    plan: p.plan,
    plan_type: p.planType ?? null,
    amount_centavos: p.amountCentavos ?? null,
    currency: p.currency ?? 'PHP',
    method: p.method ?? (p.provider === 'paypal' ? 'PayPal' : 'PayMongo'),
    description: planDescription(p.plan, p.planType),
    source: p.source ?? 'app',
    period_start: new Date().toISOString(),
  })

  if (claimErr) {
    if (claimErr.code !== '23505') throw new Error('claim_failed: ' + claimErr.message)

    const { data: existing, error: readErr } = await admin
      .from('subscription_payments')
      .select('user_id, applied_at, expires_at')
      .eq('provider', p.provider)
      .eq('reference', p.reference)
      .maybeSingle()
    if (readErr || !existing) throw new Error('claim_read_failed')

    // A payment belongs to one account; never apply it to another.
    if (existing.user_id !== p.userId) throw new Error('payment_belongs_to_another_account')

    if (existing.applied_at) {
      return { ok: true, alreadyGranted: true, expiresAt: existing.expires_at ?? null }
    }
    // Claimed but never applied — the earlier attempt died part-way. Fall
    // through and finish it; the license write is an upsert, so doing it again
    // is harmless.
  }

  let expiresAt: string | null
  try {
    expiresAt = await applyLicense(admin, p)
  } catch (err) {
    // Release a fresh claim so the next arrival can try again. A claim that
    // already existed is left for the next arrival to finish.
    if (!claimErr) {
      await admin.from('subscription_payments').delete()
        .eq('provider', p.provider).eq('reference', p.reference).is('applied_at', null)
    }
    throw err
  }

  await admin.from('subscription_payments')
    .update({ applied_at: new Date().toISOString(), expires_at: expiresAt, period_end: expiresAt })
    .eq('provider', p.provider)
    .eq('reference', p.reference)

  return { ok: true, alreadyGranted: false, expiresAt }
}
