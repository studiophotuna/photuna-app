// supabase/functions/send-gallery-email/index.ts
// Emails a guest the link to their booth gallery. Called by the booth app as the
// signed-in operator, usually from its offline outbox (electron/services/
// cloudOutbox.js), so the same request can arrive more than once.
//
// Deploy:  npx supabase functions deploy send-gallery-email
// Secrets: RESEND_API_KEY
//          EMAIL_FROM   e.g. "Studio Photuna <photos@studiophotuna.com>" — the
//                       domain must be verified in Resend
//
// What the booth does with each answer (see sendOutboxJob in electron/main.js):
//   200 { ok: true }                        sent, or already sent for this requestId
//   409 { error: 'gallery_not_ready' }      the gallery has not uploaded yet: retry
//   429 { error: 'daily_limit' }            operator hit the daily cap: retry later
//   501 { error: 'email_not_configured' }   secrets missing: retry later
//   502 { error: 'provider_error' }         Resend failed: retry
//   400 / 403 / 410 / 422, and 429 gallery_limit: will never succeed, give up
//
// The guest's address is used for this one send and not stored. The send log
// keeps a SHA-256 of it, so a support question ("did it go out?") can be checked
// by hashing the address the guest gives us.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const GALLERY_BASE_URL = 'https://gallery.studiophotuna.com/gallery'
const DAILY_LIMIT_PER_OPERATOR = 500
const LIMIT_PER_GALLERY = 5

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,119}$/

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const COPY = {
  en: {
    subject: (event: string) => `Your photos from ${event}`,
    heading: 'Your photos are ready',
    body: (event: string) => `Thanks for visiting the ${event} photo booth. Your photos are waiting in your gallery.`,
    button: 'View my photos',
    expires: (date: string) => `The gallery is available until ${date}.`,
    footer: 'You are receiving this because this address was entered at a Studio Photuna booth.',
  },
  tl: {
    subject: (event: string) => `Ang iyong mga litrato mula sa ${event}`,
    heading: 'Handa na ang iyong mga litrato',
    body: (event: string) => `Salamat sa pagbisita sa photo booth ng ${event}. Nasa iyong gallery ang iyong mga litrato.`,
    button: 'Tingnan ang aking mga litrato',
    expires: (date: string) => `Bukas ang gallery hanggang ${date}.`,
    footer: 'Natanggap mo ito dahil inilagay ang address na ito sa isang Studio Photuna booth.',
  },
}

function buildEmail(opts: { eventName: string; link: string; expiresAt: string | null; lang: 'en' | 'tl' }) {
  const copy = COPY[opts.lang]
  const event = escapeHtml(opts.eventName)
  const expiry = opts.expiresAt
    ? new Date(opts.expiresAt).toLocaleDateString(opts.lang === 'tl' ? 'fil-PH' : 'en-PH', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
      })
    : null

  const html = `<!doctype html>
<html><body style="margin:0;background:#f6f6f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td style="font-size:22px;font-weight:bold;padding-bottom:12px">${escapeHtml(copy.heading)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px">${copy.body(event)}</td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${opts.link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:999px">${escapeHtml(copy.button)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#6b7280;word-break:break-all">${opts.link}</td></tr>
        ${expiry ? `<tr><td style="font-size:13px;color:#6b7280;padding-top:8px">${escapeHtml(copy.expires(expiry))}</td></tr>` : ''}
        <tr><td style="font-size:11px;color:#9ca3af;padding-top:24px">${escapeHtml(copy.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const text = [
    copy.heading,
    '',
    copy.body(opts.eventName),
    '',
    `${copy.button}: ${opts.link}`,
    expiry ? copy.expires(expiry) : '',
    '',
    copy.footer,
  ].join('\n')

  return { subject: copy.subject(opts.eventName), html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

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

  const requestId = String(body.requestId ?? '')
  const slug = String(body.slug ?? '')
  const email = String(body.email ?? '').trim()
  const eventName = String(body.eventName ?? '').trim().slice(0, 80) || 'Studio Photuna'
  const lang: 'en' | 'tl' = String(body.language ?? '').toLowerCase().startsWith('tl') ||
    String(body.language ?? '').toLowerCase().startsWith('fil') ? 'tl' : 'en'

  if (!SAFE_ID.test(requestId) || !SAFE_ID.test(slug)) return json({ error: 'missing_params' }, 400)
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 422)

  // The same request again (a retry after a timeout): report what happened.
  const { data: previous } = await admin
    .from('gallery_email_shares')
    .select('status, user_id')
    .eq('request_id', requestId)
    .maybeSingle()
  if (previous && previous.user_id !== user.id) return json({ error: 'forbidden' }, 403)
  if (previous?.status === 'sent') return json({ ok: true, duplicate: true })

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!apiKey || !from) return json({ error: 'email_not_configured' }, 501)

  const { data: gallery, error: galleryErr } = await admin
    .from('galleries')
    .select('slug, user_id, owner_user_id, expires_at')
    .eq('slug', slug)
    .maybeSingle()
  if (galleryErr) return json({ error: 'lookup_failed' }, 502)
  // Queued offline and not uploaded yet. The booth retries.
  if (!gallery) return json({ error: 'gallery_not_ready' }, 409)
  if (gallery.user_id !== user.id && gallery.owner_user_id !== user.id) {
    return json({ error: 'forbidden' }, 403)
  }
  if (gallery.expires_at && new Date(gallery.expires_at).getTime() < Date.now()) {
    return json({ error: 'gallery_expired' }, 410)
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: sentToday } = await admin
    .from('gallery_email_shares')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'sent')
    .gte('created_at', since)
  if ((sentToday ?? 0) >= DAILY_LIMIT_PER_OPERATOR) return json({ error: 'daily_limit' }, 429)

  const { count: sentForGallery } = await admin
    .from('gallery_email_shares')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_slug', slug)
    .eq('status', 'sent')
  if ((sentForGallery ?? 0) >= LIMIT_PER_GALLERY) return json({ error: 'gallery_limit' }, 429)

  const link = `${GALLERY_BASE_URL}/${encodeURIComponent(slug)}`
  const message = buildEmail({ eventName, link, expiresAt: gallery.expires_at, lang })
  const emailHash = await sha256Hex(email.toLowerCase())

  let providerStatus = 0
  let providerBody: Record<string, unknown> = {}
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Resend drops a repeat of the same key, so a retry cannot double-send.
        'Idempotency-Key': requestId,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    })
    providerStatus = res.status
    providerBody = await res.json().catch(() => ({}))
  } catch (err) {
    console.warn('[send-gallery-email] provider request failed', String(err))
  }

  const sent = providerStatus >= 200 && providerStatus < 300
  const providerError = sent ? null : String(providerBody?.message ?? providerBody?.name ?? `status ${providerStatus}`).slice(0, 300)

  await admin.from('gallery_email_shares').upsert({
    request_id: requestId,
    user_id: user.id,
    gallery_slug: slug,
    email_hash: emailHash,
    status: sent ? 'sent' : 'failed',
    provider_message_id: sent ? String(providerBody?.id ?? '') || null : null,
    error: providerError,
  }, { onConflict: 'request_id' })

  if (sent) return json({ ok: true })
  if (providerStatus === 422 || providerStatus === 400) return json({ error: 'invalid_email', detail: providerError }, 422)
  if (providerStatus === 401 || providerStatus === 403) {
    console.error('[send-gallery-email] Resend rejected the API key or sender', providerError)
    return json({ error: 'email_not_configured' }, 501)
  }
  return json({ error: 'provider_error', detail: providerError }, 502)
})
