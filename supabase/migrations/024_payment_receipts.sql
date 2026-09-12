-- ============================================================
-- Photuna — Migration 024: Payment receipts operators can look at
--
-- subscription_payments already records every payment as it is applied, which
-- makes it the one honest source for a billing history. It was written for
-- correctness (apply a payment once), not for reading, so it lacks the things
-- a receipt has to show: a number to quote, the currency, how it was paid,
-- what it was for, and the period it covers.
--
-- This is a payment receipt, deliberately NOT a BIR Official Receipt. No TIN,
-- no OR series, no VAT breakdown — a computer-generated OR needs BIR
-- accreditation, and labelling this as one when it is not would be worse than
-- useless to an operator. The columns are laid out so those fields can be
-- added later without moving any data.
--
-- Receipt numbers come from a sequence, assigned on insert, and never change.
-- ============================================================

alter table public.subscription_payments
  add column if not exists currency       text not null default 'PHP',
  add column if not exists receipt_number text,
  add column if not exists paid_at        timestamptz,
  add column if not exists method         text,
  add column if not exists description    text,
  add column if not exists period_start   timestamptz,
  add column if not exists period_end     timestamptz,
  -- 'app' | 'website' | 'backfill' — where the record came from, so a
  -- reconstructed history is never passed off as a live one.
  add column if not exists source         text;

alter table public.subscription_payments
  drop constraint if exists subscription_payments_receipt_number_key;
alter table public.subscription_payments
  add constraint subscription_payments_receipt_number_key unique (receipt_number);

create sequence if not exists public.receipt_number_seq;

-- SP-000123. A plain running number: an operator only needs something short
-- and unambiguous to quote at support, and a per-year reset would make two
-- receipts able to share a number across years.
create or replace function public.assign_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.receipt_number is null then
    new.receipt_number := 'SP-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0');
  end if;
  if new.paid_at is null then
    new.paid_at := coalesce(new.applied_at, new.created_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists subscription_payments_receipt_number on public.subscription_payments;
create trigger subscription_payments_receipt_number
  before insert on public.subscription_payments
  for each row execute function public.assign_receipt_number();

-- Rows written before this migration (the app payments made today) get their
-- numbers and their missing detail filled in from what is already known.
update public.subscription_payments
   set receipt_number = 'SP-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0')
 where receipt_number is null;

update public.subscription_payments
   set paid_at      = coalesce(paid_at, applied_at, created_at),
       period_start = coalesce(period_start, applied_at, created_at),
       period_end   = coalesce(period_end, expires_at),
       source       = coalesce(source, 'app'),
       method       = coalesce(method, case provider when 'paypal' then 'PayPal' when 'paymongo' then 'PayMongo' end),
       description  = coalesce(description, case plan
                        when 'monthly'  then 'Photuna Pro — Monthly'
                        when 'yearly'   then 'Photuna Pro — Yearly'
                        when 'plus'     then 'Photuna Gallery Plus'
                        when 'business' then 'Photuna Gallery Business'
                        else 'Photuna subscription' end)
 where paid_at is null or description is null or source is null;

create index if not exists subscription_payments_user_paid_idx
  on public.subscription_payments (user_id, paid_at desc);
