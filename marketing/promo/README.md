# Launch promo — SAVE50PROMO

Three posters for the official-opening 50% voucher, rendered from `poster.html`
by `render.js`.

```
env -u ELECTRON_RUN_AS_NODE npx electron marketing/promo/render.js
```

| File | Size | Where |
|---|---|---|
| `photuna-promo-1x1-facebook-instagram.png` | 1080×1080 | Facebook feed, Instagram square |
| `photuna-promo-4x5-instagram-feed.png` | 1080×1350 | Instagram feed (tallest allowed — most screen space) |
| `photuna-promo-9x16-stories-reels-tiktok.png` | 1080×1920 | Stories, Reels, TikTok |

The 9:16 keeps its bottom ~17% clear because TikTok and Reels overlay the
caption, username and action buttons there.

---

## ⚠ The code has to exist before any of this goes out

`SAVE50PROMO` was **not** verified as present in `discount_codes`. RLS only lets
authenticated users read active codes, so it could not be checked from here — it
may or may not exist. Confirm before posting; a promo whose code fails at
checkout costs more goodwill than the discount saves.

Run in the Supabase SQL editor to create it (adjust `valid_until`):

```sql
insert into public.discount_codes
  (code, discount_type, discount_value, max_uses, uses_count,
   is_active, applies_to, valid_from, valid_until)
values
  ('SAVE50PROMO', 'percent', 50, 100, 0,
   true, '{}', now(), now() + interval '60 days')
on conflict (code) do update
  set discount_type  = excluded.discount_type,
      discount_value = excluded.discount_value,
      max_uses       = excluded.max_uses,
      is_active      = excluded.is_active,
      applies_to     = excluded.applies_to,
      valid_until    = excluded.valid_until;
```

`applies_to` empty means every plan — the check is
`applies_to.length > 0 && !applies_to.includes(plan)`, so an empty array never
excludes anything. `max_uses` 100 is the 100-subscriber cap; `uses_count`
increments on payment, and the code stops validating once they match.

**What this costs.** 50% applies to the whole first billing period, so a yearly
subscriber pays ₱5,700 instead of ₱11,400 — ₱5,700 forgone from one signup, and
up to ₱570,000 if all 100 take the yearly plan. Worth deciding deliberately
rather than discovering later. If that is more than intended, the options are
capping `applies_to` to `{monthly}` or lowering `max_uses`.

---

## Caption copy

### Facebook

> **We're officially open.**
>
> Studio Photuna Booth Software is live — the same system we've been building
> for photo booth operators who are tired of fighting their software mid-event.
>
> To mark the opening, the first 100 subscribers get **50% off their first
> billing period** on any plan. Monthly drops to ₱900. Yearly drops to ₱5,700.
>
> Use code **SAVE50PROMO** at checkout.
>
> 100 only — once they're gone, that's it.
> 👉 studiophotuna.com

### Instagram

> We're officially open. 🎉
>
> 50% off your first billing period — first 100 subscribers only.
> Code: **SAVE50PROMO**
>
> Monthly ₱1,800 → ₱900
> Yearly ₱11,400 → ₱5,700
>
> Works on every plan. Link in bio.
>
> #photobooth #photoboothph #photoboothbusiness #eventsupplierph
> #photoboothrental #manilaevents #eventsph #smallbusinessph
> #photoboothsoftware #studiophotuna

### TikTok

> we're officially open 🎉 first 100 people get 50% off
>
> code SAVE50PROMO — works on every plan
> monthly ₱900 · yearly ₱5,700
>
> link in bio 👀
>
> #photobooth #photoboothph #photoboothbusiness #eventsph #fyp
> #smallbusinessph #photoboothrental

---

## Posting notes

- **Put the code in the first line of the caption**, not only in the image —
  Instagram and TikTok truncate captions, and nobody retypes a code from a
  screenshot they have to scroll back to.
- **Reply to your own post with the code** as the first comment too. It is the
  one thing people come back to look for.
- **Pin the Facebook post** for the length of the promo.
- **Say when it ends**, or say "until the 100 are gone" — scarcity that never
  resolves reads as marketing noise.
- Post the 4:5 to the Instagram feed rather than the square: it takes ~25% more
  screen on a phone, for free.
