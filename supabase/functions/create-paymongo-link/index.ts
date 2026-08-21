// supabase/functions/create-paymongo-link/index.ts
// Creates a PayMongo payment link server-side (PAYMONGO_SECRET_KEY never leaves Supabase).
// Deploy:  npx supabase functions deploy create-paymongo-link
// Secrets: npx supabase secrets set PAYMONGO_SECRET_KEY=sk_live_...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY') ?? ''
const PAYMONGO_BASE = 'https://api.paymongo.com/v1'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PLAN_AMOUNTS: Record<string, number> = {
  monthly: 180000, yearly: 1140000, plus: 90000, business: 170000,
}
const PLAN_LABELS: Record<string, string> = {
  monthly:  'Photuna Pro — Monthly',
  yearly:   'Photuna Pro — Yearly',
  plus:     'Photuna Gallery Plus — Monthly',
  business: 'Photuna Gallery Business — Monthly',
}

function pmAuth() {
  return 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':')
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (!PAYMONGO_SECRET_KEY) return json({ error: 'paymongo_not_configured' }, 501)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  // Verify caller identity from Supabase JWT
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
      const notStarted  = discount.valid_from  && new Date(discount.valid_from)  > now
      const expired     = discount.valid_until  && new Date(discount.valid_until) < now
      const limitReached = discount.max_uses !== null && discount.uses_count >= discount.max_uses
      const wrongPlan   = discount.applies_to?.length > 0 && !discount.applies_to.includes(plan)

      if (!notStarted && !expired && !limitReached && !wrongPlan) {
        amount = applyDiscount(amount, discount)
      }
    }
  }

  // Create the payment link on PayMongo
  const pmRes = await fetch(`${PAYMONGO_BASE}/links`, {
    method: 'POST',
    headers: { Authorization: pmAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: {
          amount,
          description: PLAN_LABELS[plan] || `Photuna — ${plan}`,
          remarks: `userId:${user.id}|planType:${planType ?? plan}|plan:${plan}`,
        },
      },
    }),
  })
  const pmBody = await pmRes.json().catch(() => null)
  if (!pmRes.ok) {
    const msg = pmBody?.errors?.[0]?.detail || `PayMongo error ${pmRes.status}`
    return json({ error: msg }, 500)
  }

  const linkId      = pmBody?.data?.id as string
  const checkoutUrl = pmBody?.data?.attributes?.checkout_url as string
  if (!linkId || !checkoutUrl) return json({ error: 'no_link_returned' }, 500)

  return json({ linkId, checkoutUrl })
})
