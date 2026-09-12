// supabase/functions/_shared/paypal.ts
//
// PayPal Orders v2 helpers shared by paypal-order-status (the app's poll) and
// paypal-return (the browser coming back from PayPal). Both must reach the
// same answer about an order, so the capture rules live here once.
//
// Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV — the same three
// the website's functions read. Only the exact string "sandbox" selects
// sandbox; anything else, including unset, is live.

const CLIENT_ID = Deno.env.get('PAYPAL_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('PAYPAL_CLIENT_SECRET') ?? ''
const ENV = Deno.env.get('PAYPAL_ENV') ?? 'live'

export const PAYPAL_BASE = ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com'

export const paypalConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET)

export async function paypalToken(): Promise<string | null> {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.access_token ?? null
}

// deno-lint-ignore no-explicit-any
type Order = Record<string, any>

export type Settlement =
  | { outcome: 'completed'; order: Order }
  | { outcome: 'pending'; order: Order; reason: string }   // not approved yet, or PayPal still reviewing
  | { outcome: 'declined'; order: Order | null; reason: string }
  | { outcome: 'not_found' }
  | { outcome: 'error'; reason: string }

async function getOrder(token: string, orderId: string) {
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, order: body as Order | null }
}

function firstCapture(order: Order | null) {
  return order?.purchase_units?.[0]?.payments?.captures?.[0] ?? null
}

// Brings an order to its final state: captures it if the payer has approved,
// and reports whether the money has actually been received.
export async function settleOrder(token: string, orderId: string): Promise<Settlement> {
  const read = await getOrder(token, orderId)
  if (read.status === 404) return { outcome: 'not_found' }
  if (!read.ok || !read.order) return { outcome: 'error', reason: `order_read_${read.status}` }

  let order = read.order

  if (order.status === 'APPROVED') {
    const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // The return trip and the app's poll can capture at the same moment;
        // PayPal treats a repeated request id as the same capture.
        'PayPal-Request-Id': `capture-${orderId}`,
      },
    })
    const body = await res.json().catch(() => null)
    if (res.ok && body) {
      order = body
    } else {
      const issue = body?.details?.[0]?.issue || `capture_${res.status}`
      if (issue === 'ORDER_ALREADY_CAPTURED') {
        const again = await getOrder(token, orderId)
        if (again.ok && again.order) order = again.order
      } else if (['INSTRUMENT_DECLINED', 'PAYER_CANNOT_PAY', 'TRANSACTION_REFUSED', 'PAYER_ACTION_REQUIRED'].includes(issue)) {
        return { outcome: 'declined', order, reason: issue }
      } else {
        console.error('[paypal] capture failed:', orderId, issue)
        return { outcome: 'error', reason: issue }
      }
    }
  }

  if (order.status !== 'COMPLETED') {
    return { outcome: 'pending', order, reason: String(order.status || 'UNKNOWN').toLowerCase() }
  }

  // An order can be COMPLETED while its capture is still under PayPal review
  // (eCheck, risk hold). No money has arrived yet, so no plan either.
  const capture = firstCapture(order)
  if (capture && capture.status !== 'COMPLETED') {
    if (capture.status === 'DECLINED' || capture.status === 'FAILED') {
      return { outcome: 'declined', order, reason: `capture_${String(capture.status).toLowerCase()}` }
    }
    return { outcome: 'pending', order, reason: `capture_${String(capture.status).toLowerCase()}` }
  }

  return { outcome: 'completed', order }
}

// custom_id is stamped by create-paypal-order as "<userId>|<planType>|<plan>".
// It is set with our own credentials when the order is created, so the payer
// cannot alter it — which is what makes it safe to grant from.
export function readPurchase(order: Order): { userId: string; planType: string; plan: string } | null {
  const unit = order?.purchase_units?.[0]
  const raw = unit?.custom_id ?? unit?.payments?.captures?.[0]?.custom_id ?? null
  if (!raw) return null
  const [userId, planType, plan] = String(raw).split('|')
  if (!userId || !plan) return null
  return { userId, planType: planType || plan, plan }
}

// What the payer sees as the transaction id in PayPal is the capture id, not
// the order id.
export function transactionId(order: Order): string | null {
  return firstCapture(order)?.id ?? null
}

export function capturedCentavos(order: Order): number | null {
  const value = firstCapture(order)?.amount?.value
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
