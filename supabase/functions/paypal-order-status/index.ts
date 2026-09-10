// supabase/functions/paypal-order-status/index.ts
// Polls a PayPal order, captures it once the payer approves, and activates the
// license in Supabase.
//
// Deploy:  npx supabase functions deploy paypal-order-status
// Secrets: npx supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=sandbox
//          (the same three the website functions already expect)
//
// The plan granted is read from the order's own custom_id, never from the
// request body: a caller who could name their own plan would buy the cheapest
// one and claim the most expensive. The buyer stamped into custom_id must also
// match the JWT making the call, so a known order id cannot be redeemed twice
// by a second account.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYPAL_CLIENT_ID = Deno.env.get('PAYPAL_CLIENT_ID') ?? ''
const PAYPAL_CLIENT_SECRET = Deno.env.get('PAYPAL_CLIENT_SECRET') ?? ''
// Matches the website's providers/paypal.ts: only the exact string
// "sandbox" selects sandbox, anything else (including unset) is live.
const PAYPAL_ENV  = Deno.env.get('PAYPAL_ENV') ?? 'live'
const PAYPAL_BASE = PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const KNOWN_PLANS = ['monthly', 'yearly', 'plus', 'business']

function planEntitlements(plan: string) {
  switch (plan) {
    case 'monthly':  return { watermark: false, max_events: 20, templates: 30, priority_support: false }
    case 'yearly':   return { watermark: false, max_events: 50, templates: 100, priority_support: true }
    case 'plus':     return { watermark: false, max_events: 5,  templates: 10,  priority_support: false }
    case 'business': return { watermark: false, max_events: 50, templates: 80,  priority_support: true }
    default:         return { watermark: true,  max_events: 0,  templates: 3,   priority_support: false }
  }
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

function readCustomId(order: Record<string, any>): string | null {
  const unit = order?.purchase_units?.[0]
  // After capture the custom_id also appears on the capture itself; check both
  // so the read works before and after money moves.
  return unit?.custom_id
    ?? unit?.payments?.captures?.[0]?.custom_id
    ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return json({ error: 'paypal_not_configured' }, 501)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const { orderId } = body as { orderId?: string }
  if (!orderId) return json({ error: 'missing_params' }, 400)

  const token = await paypalToken()
  if (!token) return json({ error: 'paypal_auth_failed' }, 502)

  // 1. Read the order
  const getRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  let order = await getRes.json().catch(() => null)
  if (!getRes.ok || !order) return json({ error: 'order_not_found' }, 404)

  // 2. The payer approved but the money has not moved yet — capture it.
  if (order.status === 'APPROVED') {
    const capRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const capBody = await capRes.json().catch(() => null)
    if (!capRes.ok) {
      // ORDER_ALREADY_CAPTURED is not a failure: another poll won the race.
      const issue = capBody?.details?.[0]?.issue
      if (issue !== 'ORDER_ALREADY_CAPTURED') {
        console.error('[paypal-order-status] capture failed:', issue || capRes.status)
        return json({ paid: false, status: order.status, error: issue || 'capture_failed' })
      }
    } else {
      order = capBody
    }
  }

  if (order.status !== 'COMPLETED') {
    return json({ paid: false, status: order.status ?? 'UNKNOWN' })
  }

  // 3. Trust only what PayPal echoes back about this order.
  const customId = readCustomId(order)
  if (!customId) return json({ error: 'order_missing_custom_id' }, 500)

  const [orderUserId, orderPlanType, orderPlan] = customId.split('|')
  if (orderUserId !== user.id) {
    console.warn('[paypal-order-status] caller does not own order', orderId)
    return json({ error: 'not_your_order' }, 403)
  }
  if (!orderPlan || !KNOWN_PLANS.includes(orderPlan)) {
    return json({ error: 'unknown_plan' }, 400)
  }

  // 4. Activate
  const userId = user.id
  const daysMap: Record<string, number> = { monthly: 30, yearly: 365, plus: 30, business: 30 }
  const days = daysMap[orderPlan] ?? 30
  const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString()

  try {
    if (orderPlanType === 'gallery') {
      const tier = orderPlan === 'business' ? 'business' : 'plus'
      const { data: existing } = await supabase
        .from('licenses').select('*').eq('user_id', userId).maybeSingle()
      const { error } = await supabase.from('licenses').upsert({
        user_id: userId,
        plan: existing?.plan || 'free',
        state: existing?.state || 'active',
        expires_at: existing?.expires_at || null,
        watermark: existing?.watermark ?? true,
        max_events: existing?.max_events ?? 0,
        templates: existing?.templates ?? 3,
        priority_support: existing?.priority_support ?? false,
        trial_redeemed: Boolean(existing?.trial_redeemed),
        gallery_addon: true,
        gallery_tier: tier,
      }, { onConflict: 'user_id' })
      if (error) console.error('[paypal-order-status] gallery upsert error:', error.message)
    } else {
      const ent = planEntitlements(orderPlan)
      const { error } = await supabase.from('licenses').upsert({
        user_id: userId,
        plan: orderPlan,
        state: 'active',
        expires_at: expiresAt,
        ...ent,
      }, { onConflict: 'user_id' })
      if (error) console.error('[paypal-order-status] license upsert error:', error.message)
      await supabase.from('profiles').update({ subscription_plan: orderPlan }).eq('id', userId)
    }
  } catch (err) {
    console.error('[paypal-order-status] activation error:', (err as Error).message)
    return json({ error: 'activation_error' }, 500)
  }

  return json({ paid: true, plan: orderPlan })
})
