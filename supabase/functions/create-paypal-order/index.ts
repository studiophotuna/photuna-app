// supabase/functions/create-paypal-order/index.ts
// Creates a PayPal order server-side (PAYPAL_CLIENT_SECRET never leaves Supabase).
//
// Deploy:  npx supabase functions deploy create-paypal-order
// Secrets: npx supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=sandbox
//          (the same three the website functions already expect)
//
// Why Orders and not the Subscriptions API: the licenses table is granted with
// an explicit expires_at computed at payment time, which is a one-off purchase
// with a term, not a billing agreement. Orders mirrors the PayMongo link flow
// exactly, so both gateways feed the same activation path. Moving to real
// recurring billing later means Products + Plans in PayPal and a renewal
// webhook, and a different license shape — that is a separate decision.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYPAL_CLIENT_ID = Deno.env.get('PAYPAL_CLIENT_ID') ?? ''
const PAYPAL_CLIENT_SECRET = Deno.env.get('PAYPAL_CLIENT_SECRET') ?? ''
// Matches the website's providers/paypal.ts: only the exact string
// "sandbox" selects sandbox, anything else (including unset) is live.
const PAYPAL_ENV  = Deno.env.get('PAYPAL_ENV') ?? 'live'
const PAYPAL_BASE = PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com'

// After approving, the payer returns through paypal-return, which captures the
// order and grants the plan server-side before sending them to the website's
// result page — so the payment completes even if the app's checkout window was
// closed. Both used to point at the site's home page, which left the payer with
// no confirmation and, if the app was not polling, an order nobody captured.
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://www.studiophotuna.com').replace(/\/+$/, '')
const RETURN_URL = Deno.env.get('PAYPAL_RETURN_URL')
  ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/paypal-return`
const CANCEL_URL = Deno.env.get('PAYPAL_CANCEL_URL')
  ?? `${SITE_URL}/payment/app_cancel?source=app&provider=paypal&status=cancelled`

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Centavos, matching create-paymongo-link so the two gateways cannot drift.
const PLAN_AMOUNTS: Record<string, number> = {
  monthly: 180000, yearly: 1140000, plus: 90000, business: 170000,
}
const PLAN_LABELS: Record<string, string> = {
  monthly:  'Photuna Pro — Monthly',
  yearly:   'Photuna Pro — Yearly',
  plus:     'Photuna Gallery Plus — Monthly',
  business: 'Photuna Gallery Business — Monthly',
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

function applyDiscount(amountCentavos: number, discount: Record<string, unknown>): number {
  const php = amountCentavos / 100
  let discounted = php
  if (discount.discount_type === 'percent') {
    discounted = Math.max(0, Math.round(php * (1 - (discount.discount_value as number) / 100)))
  } else {
    discounted = Math.max(0, php - (discount.discount_value as number))
  }
  return Math.max(1, Math.round(discounted * 100)) // minimum ₱1 = 100 centavos
}

async function paypalToken(): Promise<string | null> {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.access_token ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return json({ error: 'paypal_not_configured' }, 501)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  // Verify caller identity from the Supabase JWT
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const { planType, plan, discountCode } = body as {
    planType?: string; plan?: string; discountCode?: string
  }
  if (!plan || !PLAN_AMOUNTS[plan]) return json({ error: 'unknown_plan' }, 400)

  // Apply discount server-side — client-supplied amounts are never trusted
  let amount = PLAN_AMOUNTS[plan]
  if (discountCode) {
    const { data: discount } = await supabase
      .from('discount_codes')
      .select('*')
      .eq('code', String(discountCode).trim().toUpperCase())
      .eq('is_active', true)
      .maybeSingle()

    if (discount) {
      const now = new Date()
      const notStarted   = discount.valid_from  && new Date(discount.valid_from)  > now
      const expired      = discount.valid_until && new Date(discount.valid_until) < now
      const limitReached = discount.max_uses !== null && discount.uses_count >= discount.max_uses
      const wrongPlan    = discount.applies_to?.length > 0 && !discount.applies_to.includes(plan)

      if (!notStarted && !expired && !limitReached && !wrongPlan) {
        amount = applyDiscount(amount, discount)
      }
    }
  }

  const token = await paypalToken()
  if (!token) return json({ error: 'paypal_auth_failed' }, 502)

  // custom_id is the only channel that survives the round trip through PayPal,
  // so the buyer, the plan and its type are stamped there. paypal-order-status
  // reads the plan back from the captured order rather than trusting whatever
  // the client claims it paid for.
  const customId = `${user.id}|${planType ?? plan}|${plan}`

  const ppRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: customId,
        description: (PLAN_LABELS[plan] || `Photuna — ${plan}`).slice(0, 127),
        amount: {
          // Verified 2026-09-10 against the live merchant account
          // (APP-1VR860520B815204R): a PHP order is accepted. The website's
          // providers/paypal.ts carries a note that this was unconfirmed —
          // it is confirmed now, for this account.
          currency_code: 'PHP',
          value: (amount / 100).toFixed(2),
        },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Studio Photuna',
            user_action: 'PAY_NOW',
            return_url: RETURN_URL,
            cancel_url: CANCEL_URL,
          },
        },
      },
    }),
  })

  const ppBody = await ppRes.json().catch(() => null)
  if (!ppRes.ok) {
    const detail = ppBody?.details?.[0]?.description || ppBody?.message || `PayPal error ${ppRes.status}`
    console.error('[create-paypal-order] create failed:', detail)
    return json({ error: detail }, 502)
  }

  const orderId = ppBody?.id as string
  // With experience_context PayPal returns rel "payer-action"; the classic
  // shape returns "approve". Accept either so the function survives both.
  const links = (ppBody?.links ?? []) as Array<{ rel: string; href: string }>
  const approveUrl =
    links.find((l) => l.rel === 'payer-action')?.href ??
    links.find((l) => l.rel === 'approve')?.href

  if (!orderId || !approveUrl) return json({ error: 'no_order_returned' }, 502)

  return json({ orderId, approveUrl, env: PAYPAL_ENV })
})
