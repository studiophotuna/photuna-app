// supabase/functions/paymongo-webhook/index.ts
// Receives PayMongo webhook events and activates licenses in Supabase.
// Deploy:  supabase functions deploy paymongo-webhook
// Secrets: supabase secrets set PAYMONGO_WEBHOOK_SECRET=...
// Update the webhook URL in PayMongo dashboard to:
//   https://<project-ref>.supabase.co/functions/v1/paymongo-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')!

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function planEntitlements(plan: string) {
  switch (plan) {
    case 'monthly':  return { watermark: false, max_events: 20, templates: 30, priority_support: false }
    case 'yearly':   return { watermark: false, max_events: 50, templates: 100, priority_support: true }
    case 'plus':     return { watermark: false, max_events: 5,  templates: 10, priority_support: false }
    case 'business': return { watermark: false, max_events: 50, templates: 80, priority_support: true }
    default:         return { watermark: true,  max_events: 0,  templates: 3,  priority_support: false }
  }
}

async function hmacHex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const rawBody = await req.text()
  const signature = req.headers.get('paymongo-signature') || ''

  // PayMongo signature format: "t=<timestamp>,te=<test-sig>,li=<live-sig>"
  const parts = Object.fromEntries(signature.split(',').map(p => p.split('=')))
  const toSign = `${parts.t}.${rawBody}`
  const expected = await hmacHex(webhookSecret, toSign)

  if (parts.te !== expected && parts.li !== expected) {
    console.warn('[paymongo-webhook] signature mismatch')
    return new Response('invalid_signature', { status: 400 })
  }

  let event: Record<string, unknown>
  try { event = JSON.parse(rawBody) } catch { return new Response('bad_json', { status: 400 }) }

  const type = (event as { data?: { attributes?: { type?: string } } })?.data?.attributes?.type
  if (type === 'link.payment.paid') {
    try {
      const attrs = (event as Record<string, unknown>)?.data as Record<string, unknown>
      const remarks: string = (attrs?.attributes as Record<string, unknown>)?.data?.['attributes']?.['remarks'] ?? ''

      const userId   = (remarks.match(/userId:([^|]+)/) || [])[1]
      const planType = (remarks.match(/planType:([^|]+)/) || [])[1]
      const plan     = (remarks.match(/plan:([^|]+)/) || [])[1]

      if (userId && plan) {
        const daysMap: Record<string, number> = { monthly: 30, yearly: 365, plus: 30, business: 30 }
        const days = daysMap[plan] ?? 30
        const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString()

        if (planType === 'gallery') {
          const tier = plan === 'business' ? 'business' : 'plus'
          const { error } = await supabase.from('licenses').upsert({
            user_id: userId,
            gallery_addon: true,
            gallery_tier: tier,
            expires_at: expiresAt,
          }, { onConflict: 'user_id' })
          if (error) console.error('[paymongo-webhook] gallery upsert error', error.message)
        } else {
          const ent = planEntitlements(plan)
          const { error } = await supabase.from('licenses').upsert({
            user_id: userId,
            plan,
            state: 'active',
            expires_at: expiresAt,
            ...ent,
          }, { onConflict: 'user_id' })
          if (error) console.error('[paymongo-webhook] license upsert error', error.message)
          // Sync subscription_plan on profile
          await supabase.from('profiles').update({ subscription_plan: plan }).eq('id', userId)
        }
        console.log(`[paymongo-webhook] activated plan=${plan} for userId=${userId}`)
      }
    } catch (err) {
      console.error('[paymongo-webhook] activation error', (err as Error).message)
      return new Response('activation_error', { status: 500 })
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
