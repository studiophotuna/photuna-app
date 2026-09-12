// supabase/functions/paypal-return/index.ts
//
// Where PayPal sends the payer after they approve a subscription order created
// by the desktop app. Captures the order server-side, grants the plan, and
// redirects the browser to the website's result page.
//
// Deploy:  npx supabase functions deploy paypal-return --no-verify-jwt
//          (--no-verify-jwt is required: PayPal's redirect is a plain browser
//          GET with no Supabase session attached)
//
// Why this exists. Capture used to happen only inside the app, while its
// checkout window stayed open and polled. Approve on PayPal after closing that
// window and nothing ever captured the order; PayPal voids an approved order
// that is not captured, and the payer saw it as a refund. PayPal also returned
// the payer to the site's home page, so it looked like nothing had happened.
// Capturing here makes payment independent of the app, and the result page
// tells the payer what actually happened.
//
// Safe to expose without auth: this only ever finalises an order a payer has
// already approved with real money, the plan and account come from the order's
// custom_id (set with our credentials when the order was created), and
// grantOnce() applies a payment once however many times this URL is hit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { paypalConfigured, paypalToken, settleOrder, readPurchase, transactionId, capturedCentavos } from '../_shared/paypal.ts'
import { grantOnce, KNOWN_PLANS } from '../_shared/subscriptionGrant.ts'

const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://www.studiophotuna.com').replace(/\/+$/, '')

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function redirectTo(path: string, params: Record<string, string | null | undefined>) {
  const url = new URL(SITE_URL + path)
  url.searchParams.set('source', 'app')
  url.searchParams.set('provider', 'paypal')
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  return new Response(null, {
    status: 303,
    headers: { Location: url.toString(), 'Cache-Control': 'no-store' },
  })
}

const succeeded = (params: Record<string, string | null | undefined>) =>
  redirectTo('/payment/app_success', { status: 'paid', ...params })

const didNotComplete = (status: string, params: Record<string, string | null | undefined> = {}) =>
  redirectTo('/payment/app_cancel', { status, ...params })

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  // PayPal appends ?token=<order id>&PayerID=<payer id>.
  const orderId = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[A-Z0-9]{8,40}$/i.test(orderId)) return didNotComplete('invalid')

  if (!paypalConfigured()) return didNotComplete('unavailable', { ref: orderId })
  const token = await paypalToken()
  if (!token) return didNotComplete('unavailable', { ref: orderId })

  const settled = await settleOrder(token, orderId)

  switch (settled.outcome) {
    case 'not_found':
      return didNotComplete('invalid')
    case 'declined':
      // Nothing was taken; the payer can go back and choose another way to pay.
      return didNotComplete('declined', { ref: orderId })
    case 'pending':
      // Either not approved, or PayPal is holding the capture for review.
      return didNotComplete(settled.reason.startsWith('capture_') ? 'review' : 'pending', { ref: orderId })
    case 'error':
      return didNotComplete('error', { ref: orderId })
  }

  // Money received. Grant the plan the order was created for.
  const order = settled.order
  const purchase = readPurchase(order)
  const txn = transactionId(order) ?? orderId
  if (!purchase || !KNOWN_PLANS.includes(purchase.plan)) {
    console.error('[paypal-return] completed order without a usable custom_id', orderId)
    return didNotComplete('activation', { ref: txn })
  }

  try {
    await grantOnce(admin, {
      provider: 'paypal',
      reference: orderId,
      method: 'PayPal',
      source: 'app',
      userId: purchase.userId,
      plan: purchase.plan,
      planType: purchase.planType,
      amountCentavos: capturedCentavos(order),
    })
  } catch (err) {
    // Paid but not activated: the payer must be told so, with a reference
    // support can act on — never a "success" page.
    console.error('[paypal-return] activation failed', orderId, (err as Error).message)
    return didNotComplete('activation', { ref: txn })
  }

  return succeeded({ plan: purchase.plan, ref: txn })
})
