// supabase/functions/redeem-trial/index.ts
// Activates the 14-day trial for a user. Enforces one-trial-per-account server-side.
// Deploy:  npx supabase functions deploy redeem-trial

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const TRIAL_DAYS = 14

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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'unauthorized' }, 401)

  // Check if trial was already redeemed
  const { data: existing } = await supabase
    .from('licenses')
    .select('trial_redeemed, plan')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing?.trial_redeemed) {
    return json({ error: 'trial_already_redeemed' }, 409)
  }

  const expiresAt = new Date(Date.now() + TRIAL_DAYS * 86400 * 1000).toISOString()

  const { error } = await supabase.from('licenses').upsert({
    user_id: user.id,
    plan: 'trial',
    state: 'trialing',
    expires_at: expiresAt,
    trial_redeemed: true,
    watermark: true,
    max_events: 3,
    templates: 5,
    priority_support: false,
    gallery_addon: false,
  }, { onConflict: 'user_id' })

  if (error) {
    console.error('[redeem-trial] upsert error:', error.message)
    return json({ error: error.message }, 500)
  }

  // Sync profile subscription_plan
  await supabase.from('profiles').update({ subscription_plan: 'trial' }).eq('id', user.id)

  return json({ ok: true, expiresAt })
})
