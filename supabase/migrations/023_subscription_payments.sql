-- ============================================================
-- Photuna — Migration 023: Apply each subscription payment once
--
-- The app's payment functions (paymongo-link-status, paypal-order-status)
-- granted a plan as "now + 30/365 days" every time they were called with a
-- paid link or completed order, and kept no record of which payments had
-- already been applied. Calling one again next month with the same id
-- extended the plan for free, indefinitely.
--
-- PayPal returns now also capture server-side (paypal-return), so the same
-- order can legitimately arrive twice — once from the browser coming back from
-- PayPal, once from the app's poll. Both need to converge on one grant.
--
-- Each payment is claimed here before its plan is applied. The unique
-- (provider, reference) constraint makes the claim atomic, so a second arrival
-- — a duplicate, a race, or a replay — finds it and changes nothing.
-- applied_at is set only once the license is actually written; a claim left
-- without it (the function died mid-way) is re-applied by the next arrival
-- rather than blocking the payment forever.
--
-- Written only by edge functions with the service role. Operators may read
-- their own rows.
-- ============================================================

create table if not exists public.subscription_payments (
  id              bigint generated always as identity primary key,
  provider        text        not null check (provider in ('paypal', 'paymongo')),
  reference       text        not null,   -- PayPal order id / PayMongo link id
  user_id         uuid        not null references auth.users(id) on delete cascade,
  plan            text        not null,
  plan_type       text,
  amount_centavos integer,
  created_at      timestamptz not null default now(),
  applied_at      timestamptz,
  expires_at      timestamptz,
  unique (provider, reference)
);

create index if not exists subscription_payments_user_idx
  on public.subscription_payments (user_id, created_at desc);

alter table public.subscription_payments enable row level security;

drop policy if exists "user_read_own_subscription_payments" on public.subscription_payments;
create policy "user_read_own_subscription_payments" on public.subscription_payments
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.subscription_payments from anon, authenticated;
