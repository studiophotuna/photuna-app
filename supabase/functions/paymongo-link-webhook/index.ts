// supabase/functions/paymongo-link-webhook/index.ts
//
// Activates a plan when a PayMongo *link* created by the desktop app is paid,
// without the app having to be open.
//
// Deploy:  npx supabase functions deploy paymongo-link-webhook --no-verify-jwt
//          (--no-verify-jwt is required: PayMongo posts here directly, with no
//          Supabase session)
//
// Register in PayMongo → Developers → Webhooks for the event
// `link.payment.paid`, pointing at:
//   https://<project-ref>.supabase.co/functions/v1/paymongo-link-webhook
// then put that webhook's signing secret in PAYMONGO_LINK_WEBHOOK_SECRET.
//
// Why this exists. App payments were finalised only by the app polling the
// link while its checkout window stayed open. PayMongo links cannot redirect
// anywhere, so if the operator closed that window and then paid by QR,
// PayMongo kept the money and no plan was ever granted — worse than the PayPal
// case, where an uncaptured payment at least came back. This is the backstop:
// the poll still works, and grantOnce() makes sure only one of them counts.
//
// The website's paymongo-webhook is a different endpoint with its own secret;
// it handles checkout sessions and never sees these links.
//
// Secrets: PAYMONGO_LINK_WEBHOOK_SECRET, PAYMONGO_SECRET_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { grantOnce, KNOWN_PLANS } from '../_shared/subscriptionGrant.ts'

const WEBHOOK_SECRET = Deno.env.get('PAYMONGO_LINK_WEBHOOK_SECRET') ?? ''
const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY') ?? ''
const PAYMONGO_BASE = 'https://api.paymongo.com/v1'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Header: t=<unix>,te=<test signature>,li=<live signature>
// Signed payload is `${t}.${rawBody}`, HMAC-SHA256 hex, compared against the
// live signature (or the test one in test mode).
async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !WEBHOOK_SECRET) return false
  const parts: Record<string, string> = {}
  for (const piece of header.split(',')) {
    const i = piece.indexOf('=')
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim()
  }
  const timestamp = parts.t
  const candidate = parts.li || parts.te
  if (!timestamp || !candidate) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')

  // Constant-time-ish compare; both are fixed-length hex of our own making.
  if (computed.length !== candidate.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ candidate.charCodeAt(i)
  return diff === 0
}


// GCash, Maya, a card — what the payer actually used, for their receipt.
// PayMongo reports it on the payment attached to the link.
function paymongoMethod(linkBody: unknown): string {
  // deno-lint-ignore no-explicit-any
  const type = (linkBody as any)?.data?.attributes?.payments?.[0]?.data?.attributes?.source?.type
  switch (String(type || '').toLowerCase()) {
    case 'gcash':     return 'GCash'
    case 'paymaya':   return 'Maya'
    case 'grab_pay':  return 'GrabPay'
    case 'card':      return 'Card'
    case 'dob':       return 'Online banking'
    case 'billease':  return 'BillEase'
    default:          return 'PayMongo'
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()
  if (!(await verifySignature(rawBody, req.headers.get('Paymongo-Signature')))) {
    console.error('[paymongo-link-webhook] signature verification failed')
    return new Response('Invalid signature', { status: 400 })
  }

  let event: Record<string, unknown>
  try { event = JSON.parse(rawBody) } catch { return new Response('Bad JSON', { status: 400 }) }

  // deno-lint-ignore no-explicit-any
  const attrs = (event as any)?.data?.attributes
  const eventType = attrs?.type as string | undefined
  if (eventType !== 'link.payment.paid') {
    // Another event type was subscribed by mistake; acknowledge so PayMongo
    // does not retry it forever.
    return new Response(JSON.stringify({ ignored: eventType ?? 'unknown' }), { status: 200 })
  }

  // The link id is read from the payload but everything that matters is then
  // re-read from PayMongo, so a forged shape cannot grant anything.
  const linkId = (attrs?.data?.id && String(attrs.data.id).startsWith('link_'))
    ? String(attrs.data.id)
    : (rawBody.match(/link_[A-Za-z0-9]+/)?.[0] ?? null)
  if (!linkId) {
    console.error('[paymongo-link-webhook] no link id in event')
    return new Response(JSON.stringify({ ignored: 'no_link_id' }), { status: 200 })
  }

  if (!PAYMONGO_SECRET_KEY) {
    console.error('[paymongo-link-webhook] PAYMONGO_SECRET_KEY missing')
    return new Response('Not configured', { status: 500 })
  }

  const res = await fetch(`${PAYMONGO_BASE}/links/${linkId}`, {
    headers: { Authorization: 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':'), Accept: 'application/json' },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // A 5xx tells PayMongo to retry, which is what we want for a transient
    // failure here.
    console.error('[paymongo-link-webhook] link read failed', linkId, res.status)
    return new Response('Link read failed', { status: 502 })
  }

  if (body?.data?.attributes?.status !== 'paid') {
    return new Response(JSON.stringify({ ignored: 'not_paid' }), { status: 200 })
  }

  // "userId:<id>|planType:<t>|plan:<p>", stamped by create-paymongo-link.
  const remarks = String(body?.data?.attributes?.remarks ?? '')
  const fields = new Map(
    remarks.split('|').map((part) => {
      const i = part.indexOf(':')
      return i < 0 ? ['', ''] : [part.slice(0, i), part.slice(i + 1)]
    })
  )
  const userId = fields.get('userId')
  const planType = fields.get('planType')
  const plan = fields.get('plan')

  if (!userId || !plan || !KNOWN_PLANS.includes(plan)) {
    // A link paid through some other Photuna flow, or hand-made in the
    // dashboard. Acknowledge rather than making PayMongo retry forever.
    console.warn('[paymongo-link-webhook] link without usable remarks', linkId)
    return new Response(JSON.stringify({ ignored: 'unrecognised_link' }), { status: 200 })
  }

  try {
    const result = await grantOnce(admin, {
      provider: 'paymongo',
      reference: linkId,
      method: paymongoMethod(body),
      source: 'app',
      userId,
      plan,
      planType,
      amountCentavos: Number(body?.data?.attributes?.amount) || null,
    })
    console.log('[paymongo-link-webhook] granted', linkId, plan, result.alreadyGranted ? '(already applied)' : '(applied)')
    return new Response(JSON.stringify({ ok: true, alreadyGranted: result.alreadyGranted }), { status: 200 })
  } catch (err) {
    // 5xx so PayMongo retries: the payment is real and the plan is owed.
    console.error('[paymongo-link-webhook] activation failed', linkId, (err as Error).message)
    return new Response('Activation failed', { status: 500 })
  }
})
