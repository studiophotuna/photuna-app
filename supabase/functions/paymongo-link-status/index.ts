// supabase/functions/paymongo-link-status/index.ts
// Polls a PayMongo link and, if paid, activates the user's license in Supabase.
// Deploy:  npx supabase functions deploy paymongo-link-status
// Secrets: npx supabase secrets set PAYMONGO_SECRET_KEY=sk_live_...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { grantOnce, KNOWN_PLANS } from '../_shared/subscriptionGrant.ts'

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY') ?? ''
const PAYMONGO_BASE = 'https://api.paymongo.com/v1'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function pmAuth() {
  return 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':')
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

  // Link is paid — activate the license, once. Re-polling the same paid link
  // used to reset expires_at to now + 30 days on every call, so one payment
  // could be stretched indefinitely; grantOnce records the link and applies it
  // a single time. A license write failure now surfaces instead of being
  // logged while the app was told the plan was active.
  try {
    await grantOnce(supabase, {
      provider: 'paymongo',
      reference: linkId,
      userId: user.id,
      plan,
      planType,
      amountCentavos: Number(pmBody?.data?.attributes?.amount) || null,
    })
  } catch (err) {
    console.error('[paymongo-link-status] activation error:', linkId, (err as Error).message)
    return json({ error: 'activation_error' }, 500)
  }

  return json({ paid: true, plan })
})
