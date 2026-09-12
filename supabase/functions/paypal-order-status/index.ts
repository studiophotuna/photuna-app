// supabase/functions/paypal-order-status/index.ts
// Polled by the desktop app while its checkout window is open. Captures the
// order once the payer approves and activates the license.
//
// Deploy:  npx supabase functions deploy paypal-order-status
// Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV (see _shared/paypal.ts)
//
// This is no longer the only way a PayPal payment gets finalised:
// paypal-return captures when the payer's browser comes back from PayPal, so a
// payment completes even if this window was closed. Both go through
// settleOrder() and grantOnce(), so whichever arrives second changes nothing.
//
// The plan granted is read from the order's own custom_id, never from the
// request body, and the buyer stamped there must match the caller's JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { paypalConfigured, paypalToken, settleOrder, readPurchase, capturedCentavos } from '../_shared/paypal.ts'
import { grantOnce, KNOWN_PLANS } from '../_shared/subscriptionGrant.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

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

  if (!paypalConfigured()) return json({ error: 'paypal_not_configured' }, 501)

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

  const settled = await settleOrder(token, orderId)
  if (settled.outcome === 'not_found') return json({ error: 'order_not_found' }, 404)
  if (settled.outcome === 'error') return json({ paid: false, status: 'error', error: settled.reason })
  if (settled.outcome === 'declined') return json({ paid: false, status: 'declined', error: settled.reason })
  if (settled.outcome === 'pending') return json({ paid: false, status: settled.reason })

  const purchase = readPurchase(settled.order)
  if (!purchase) return json({ error: 'order_missing_custom_id' }, 500)
  if (purchase.userId !== user.id) {
    console.warn('[paypal-order-status] caller does not own order', orderId)
    return json({ error: 'not_your_order' }, 403)
  }
  if (!KNOWN_PLANS.includes(purchase.plan)) return json({ error: 'unknown_plan' }, 400)

  try {
    await grantOnce(admin, {
      provider: 'paypal',
      reference: orderId,
      method: 'PayPal',
      source: 'app',
      userId: purchase.userId,
      plan: purchase.plan,
      planType: purchase.planType,
      amountCentavos: capturedCentavos(settled.order),
    })
  } catch (err) {
    console.error('[paypal-order-status] activation error:', orderId, (err as Error).message)
    return json({ error: 'activation_error' }, 500)
  }

  return json({ paid: true, plan: purchase.plan })
})
