-- ============================================================
-- Photuna — Migration 021: Booth PC limits per plan
--
-- license_devices has recorded every machine an account signs in on, but
-- nothing ever limited it: the old Express licensing server enforced a cap in
-- /license/attach-device, and when device tracking moved to direct Supabase
-- writes the cap was left behind. The only rule left was RLS checking that a
-- row was yours, not how many you had.
--
-- Allowance per plan:
--   free 1 · trial 2 · monthly 3 · yearly 5
-- Only the Windows app registers a machine, so the phone or browser used for
-- Remote Booth never takes a seat — these are booth PCs.
--
-- Grandfathering: a machine that is already registered is always admitted,
-- even when the account is over its allowance (after a downgrade, say). The
-- limit only decides whether a NEW machine may join. A seat is freed by
-- releasing a machine in Account Center → Devices, or automatically by the
-- weekly photuna-prune-license-devices job after 90 days unseen.
--
-- Writes now go through register_device() only. Direct INSERT/UPDATE by
-- clients is removed, because a count enforced in a function the caller can
-- simply go around is not a limit. DELETE stays, which is how Release works.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Allowance for a plan
-- ------------------------------------------------------------
-- pro_monthly / pro_yearly are the website's spellings of the same plans;
-- plus / business are the retired gallery tiers, still honoured for anyone
-- who bought them.
create or replace function public.device_limit_for_plan(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_plan, 'free'))
    when 'yearly'      then 5
    when 'pro_yearly'  then 5
    when 'business'    then 5
    when 'monthly'     then 3
    when 'pro_monthly' then 3
    when 'pro'         then 3
    when 'plus'        then 3
    when 'trial'       then 2
    else 1
  end;
$$;


-- ------------------------------------------------------------
-- 2. Allowance for an account right now
-- ------------------------------------------------------------
-- A lapsed plan falls back to the free allowance. Plan and expiry are used
-- rather than state: the website parks a paying customer in
-- 'pending_verification' mid-checkout, and that should not shrink their seats.
create or replace function public._device_limit_for_user(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when l.expires_at is not null and l.expires_at < now() then 1
    else public.device_limit_for_plan(l.plan)
  end
  from (select 1) as one
  left join public.licenses l on l.user_id = p_user_id;
$$;


-- ------------------------------------------------------------
-- 3. Register (or refresh) the calling machine
-- ------------------------------------------------------------
-- Returns jsonb: { ok, status, limit, used }
--   status 'known'         — already registered; last_seen refreshed
--   status 'migrated'      — was registered under its old fingerprint; the
--                            seat moved across, nothing new consumed
--   status 'added'         — took a free seat
--   status 'limit_reached' — ok:false; every seat is taken
--
-- p_legacy_fingerprint exists because the original fingerprint hashed the
-- Windows build number and hostname, so a feature update or a PC rename made
-- the same machine look new. Clients now send a stable id plus the old hash,
-- and the first call from each machine carries its existing seat over.
create or replace function public.register_device(
  p_fingerprint        text,
  p_platform           text default 'unknown',
  p_legacy_fingerprint text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_platform text := coalesce(nullif(trim(p_platform), ''), 'unknown');
  v_limit    integer;
  v_used     integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_fingerprint is null or length(p_fingerprint) not between 32 and 128 then
    raise exception 'invalid_fingerprint' using errcode = '22023';
  end if;

  -- One registration per account at a time, so two machines signing in
  -- together cannot both take the last seat.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 21));

  v_limit := public._device_limit_for_user(v_uid);

  -- Known machine: always admitted, whatever the count.
  update public.license_devices
     set last_seen_at = now(), platform = v_platform
   where user_id = v_uid and fingerprint = p_fingerprint;
  if found then
    select count(*) into v_used from public.license_devices where user_id = v_uid;
    return jsonb_build_object('ok', true, 'status', 'known', 'limit', v_limit, 'used', v_used);
  end if;

  -- Registered under the old fingerprint: move the seat, consume nothing.
  if p_legacy_fingerprint is not null and p_legacy_fingerprint <> p_fingerprint then
    update public.license_devices
       set fingerprint = p_fingerprint, last_seen_at = now(), platform = v_platform
     where user_id = v_uid and fingerprint = p_legacy_fingerprint;
    if found then
      select count(*) into v_used from public.license_devices where user_id = v_uid;
      return jsonb_build_object('ok', true, 'status', 'migrated', 'limit', v_limit, 'used', v_used);
    end if;
  end if;

  -- New machine: only into a free seat.
  select count(*) into v_used from public.license_devices where user_id = v_uid;
  if v_used >= v_limit then
    return jsonb_build_object('ok', false, 'status', 'limit_reached', 'limit', v_limit, 'used', v_used);
  end if;

  insert into public.license_devices (user_id, fingerprint, platform, last_seen_at)
  values (v_uid, p_fingerprint, v_platform, now());

  return jsonb_build_object('ok', true, 'status', 'added', 'limit', v_limit, 'used', v_used + 1);
end;
$$;


-- ------------------------------------------------------------
-- 4. Read-only allowance for the Devices tab
-- ------------------------------------------------------------
create or replace function public.my_device_allowance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_used integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select count(*) into v_used from public.license_devices where user_id = v_uid;
  return jsonb_build_object('limit', public._device_limit_for_user(v_uid), 'used', v_used);
end;
$$;


-- ------------------------------------------------------------
-- 5. Access
-- ------------------------------------------------------------
-- SECURITY DEFINER functions are executable by PUBLIC unless revoked.
revoke all on function public.device_limit_for_plan(text)             from public, anon;
revoke all on function public._device_limit_for_user(uuid)            from public, anon, authenticated;
revoke all on function public.register_device(text, text, text)       from public, anon;
revoke all on function public.my_device_allowance()                   from public, anon;

grant execute on function public.device_limit_for_plan(text)          to authenticated;
grant execute on function public.register_device(text, text, text)    to authenticated;
grant execute on function public.my_device_allowance()                to authenticated;

-- Replace the catch-all client policy with read + release only. Inserts and
-- updates now happen solely inside register_device(), which runs as owner.
-- "Service role manages devices" is left as it was.
drop policy if exists "user_manage_own_devices"     on public.license_devices;
drop policy if exists "Users can read own devices"  on public.license_devices;
drop policy if exists "user_read_own_devices"       on public.license_devices;
drop policy if exists "user_release_own_devices"    on public.license_devices;

create policy "user_read_own_devices" on public.license_devices
  for select to authenticated
  using (user_id = auth.uid());

create policy "user_release_own_devices" on public.license_devices
  for delete to authenticated
  using (user_id = auth.uid());
