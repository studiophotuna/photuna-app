// supabase/functions/stripe-webhook/index.ts
// Receives Stripe webhook events and updates the Supabase licenses table.
// Deploy:  supabase functions deploy stripe-webhook
// Secrets: supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=...
//          STRIPE_PRICE_GALLERY_ADDON_MONTHLY=...
// Update the webhook URL in Stripe dashboard to:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const galleryAddonPriceId = Deno.env.get('STRIPE_PRICE_GALLERY_ADDON_MONTHLY') || ''

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function planEntitlements(plan: string) {
  switch (plan) {
    case 'trial':    return { watermark: true,  max_events: 3,  templates: 5,  priority_support: false }
    case 'monthly':  return { watermark: false, max_events: 20, templates: 30, priority_support: false }
    case 'yearly':   return { watermark: false, max_events: 50, templates: 100, priority_support: true }
    default:         return { watermark: true,  max_events: 0,  templates: 3,  priority_support: false }
  }
}

async function upsertLicense(userId: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('licenses').upsert(
    { user_id: userId, ...payload },
    { onConflict: 'user_id' }
  )
  if (error) console.error('[stripe-webhook] upsertLicense error', error.message)
  // Best-effort: sync subscription_plan on profile row
  await supabase.from('profiles')
    .update({ subscription_plan: payload.plan as string })
    .eq('id', userId)
}

async function findUserByCustomerId(customerId: string): Promise<string | null> {
  // First try licenses table (populated after first checkout)
  const { data: licRow } = await supabase
    .from('licenses').select('user_id').eq('stripe_customer_id', customerId).maybeSingle()
  if (licRow?.user_id) return licRow.user_id
  // Fall back to profiles table
  const { data: profile } = await supabase
    .from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
  return profile?.id ?? null
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('missing signature', { status: 400 })

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] signature error', (err as Error).message)
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object as Stripe.Checkout.Session
        const customerId = sess.customer as string
        const userId = sess.metadata?.userId
        const metaPlan = sess.metadata?.plan
        const metaAddon = sess.metadata?.addon

        if (!userId) break

        if (metaAddon === 'gallery') {
          const { error } = await supabase.from('licenses').upsert({
            user_id: userId,
            gallery_addon: true,
            stripe_customer_id: customerId,
            stripe_gallery_subscription_id: sess.subscription as string || null,
          }, { onConflict: 'user_id' })
          if (error) console.error('[stripe-webhook] gallery addon upsert error', error.message)
        } else if (metaPlan === 'monthly' || metaPlan === 'yearly') {
          const ent = planEntitlements(metaPlan)
          await upsertLicense(userId, {
            plan: metaPlan, state: 'active', expires_at: null,
            stripe_customer_id: customerId,
            ...ent,
          })
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const stripeSubId = sub.id
        const status = sub.status
        const currentPeriodEnd = (sub as unknown as { current_period_end: number }).current_period_end

        const userId = await findUserByCustomerId(customerId)
        if (!userId) break

        if (sub.metadata?.addon === 'gallery') {
          const enabled = status === 'active' || status === 'trialing'
          const { error } = await supabase.from('licenses').upsert({
            user_id: userId,
            gallery_addon: enabled,
            stripe_customer_id: customerId,
            stripe_gallery_subscription_id: stripeSubId,
          }, { onConflict: 'user_id' })
          if (error) console.error('[stripe-webhook] gallery subscription upsert error', error.message)
          break
        }

        const interval = (sub.items?.data?.[0]?.price as Stripe.Price & { recurring?: { interval: string } })?.recurring?.interval
        const plan = interval === 'year' ? 'yearly' : 'monthly'
        const ent = planEntitlements(plan)
        const state = status === 'active' || status === 'trialing' ? 'active'
          : status === 'past_due' ? 'past_due'
          : status === 'canceled' ? 'canceled' : 'expired'
        const expiresAt = currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null

        await upsertLicense(userId, {
          plan, state, expires_at: expiresAt,
          stripe_customer_id: customerId,
          stripe_subscription_id: stripeSubId,
          ...ent,
        })
        break
      }

      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice
        const customerId = inv.customer as string
        const priceId = (inv.lines?.data?.[0]?.price as Stripe.Price)?.id
        if (priceId && priceId === galleryAddonPriceId) break
        const interval = ((inv.lines?.data?.[0]?.price as Stripe.Price & { recurring?: { interval: string } })?.recurring?.interval)
        if (!interval) break
        const plan = interval === 'year' ? 'yearly' : 'monthly'
        const ent = planEntitlements(plan)
        const periodEnd = (inv.lines?.data?.[0] as unknown as { period?: { end?: number } })?.period?.end
        const expiresAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

        const userId = await findUserByCustomerId(customerId)
        if (!userId) break

        await upsertLicense(userId, {
          plan, state: 'active', expires_at: expiresAt,
          stripe_customer_id: customerId,
          ...ent,
        })
        break
      }

      default:
        break
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error', (err as Error).message)
    return new Response('webhook_processing_failed', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
