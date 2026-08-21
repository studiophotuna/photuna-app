-- Discount codes for subscription and gallery plans.
-- Codes are stored uppercase by convention; look up with upper(?) on the client side.
create table if not exists discount_codes (
  id               uuid        primary key default gen_random_uuid(),
  code             text        unique not null,
  discount_type    text        not null check (discount_type in ('percent', 'fixed_php')),
  discount_value   numeric     not null,
  applies_to       text[]      not null default '{}',  -- empty = all plans; e.g. ['monthly','yearly']
  max_uses         int,                                 -- null = unlimited
  uses_count       int         not null default 0,
  valid_from       timestamptz,
  valid_until      timestamptz,
  stripe_coupon_id text,                                -- maps to a Stripe coupon when using Stripe checkout
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now()
);

alter table discount_codes enable row level security;

-- Admin users (role = admin or superadmin in the profiles table) can read/write all codes.
-- The licensing API server uses the service role key and bypasses RLS entirely.
-- All other authenticated users have no access — validation goes through server.js.
create policy "admin_read_write" on discount_codes
  to authenticated
  using (
    (select role from profiles where id = auth.uid()) in ('admin', 'superadmin')
  )
  with check (
    (select role from profiles where id = auth.uid()) in ('admin', 'superadmin')
  );
