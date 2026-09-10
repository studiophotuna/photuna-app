// supabase/functions/paymongo-link-status/index.ts
// Polls a PayMongo link and, if paid, activates the user's license in Supabase.
// Deploy:  npx supabase functions deploy paymongo-link-status
// Secrets: npx supabase secrets set PAYMONGO_SECRET_KEY=sk_live_...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY') ?? ''
const PAYMONGO_BASE = 'https://api.paymongo.com/v1'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function pmAuth() {
  return 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':')
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (!PAYMONGO_SECRET_KEY) return json({ error: 'paymongo_not_configured' }, 501)

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

  // plan and planType are deliberately NOT read from the body. They used to be,
  // and the only other check was that some link was paid — so a caller could buy
  // the cheapest plan and then ask for the most expensive one. Both now come
  // from the link's own remarks, which create-paymongo-link stamps server-side.
  const { linkId } = body as { linkId?: string }
  if (!linkId) return json({ error: 'missing_params' }, 400)

  // Poll the link status from PayMongo
  const pmRes = await fetch(`${PAYMONGO_BASE}/links/${linkId}`, {
    headers: { Authorization: pmAuth(), Accept: 'application/json' },
  })
  const pmBody = await pmRes.json().catch(() => null)
  const status = pmBody?.data?.attributes?.status as string

  if (status !== 'paid') return json({ paid: false, status })

  // Read back what was actually bought: "userId:<id>|planType:<t>|plan:<p>"
  const remarks = String(pmBody?.data?.attributes?.remarks ?? '')
  const fields = new Map(
    remarks.split('|').map((part) => {
      const i = part.indexOf(':')
      return i < 0 ? ['', ''] : [part.slice(0, i), part.slice(i + 1)]
    })
  )
  const linkUserId = fields.get('userId')
  const planType   = fields.get('planType')
  const plan       = fields.get('plan')

  if (!linkUserId || !plan || !KNOWN_PLANS.includes(plan)) {
    console.error('[paymongo-link-status] unusable remarks on link', linkId, JSON.stringify(remarks))
    return json({ error: 'link_not_recognised' }, 400)
  }
  // A paid link belongs to whoever created it. Without this, a known link id
  // could be redeemed a second time by a different account.
  if (linkUserId !== user.id) {
    console.warn('[paymongo-link-status] caller does not own link', linkId)
    return json({ error: 'not_your_link' }, 403)
  }

  // Link is paid — activate the license
  const userId = user.id
  const daysMap: Record<string, number> = { monthly: 30, yearly: 365, plus: 30, business: 30 }
  const days = daysMap[plan] ?? 30
  const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString()

  try {
    if (planType === 'gallery') {
      const tier = plan === 'business' ? 'business' : 'plus'
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
      if (error) console.error('[paymongo-link-status] gallery upsert error:', error.message)
    } else {
      const ent = planEntitlements(plan)
      const { error } = await supabase.from('licenses').upsert({
        user_id: userId,
        plan,
        state: 'active',
        expires_at: expiresAt,
        ...ent,
      }, { onConflict: 'user_id' })
      if (error) console.error('[paymongo-link-status] license upsert error:', error.message)
      // Sync profile subscription_plan
      await supabase.from('profiles').update({ subscription_plan: plan }).eq('id', userId)
    }
  } catch (err) {
    console.error('[paymongo-link-status] activation error:', (err as Error).message)
    return json({ error: 'activation_error' }, 500)
  }

  return json({ paid: true, plan })
})
