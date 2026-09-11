-- ============================================================
-- Photuna — Migration 022: Tell devices apart, count seats safely
--
-- 021 limited how many devices an account may use, but every row still read
-- "Windows PC" — an operator with two booths could not tell which was which,
-- so the count was visible but individual devices could not be monitored.
--
-- Each device row now carries:
--   device_name   what the device calls itself (Windows computer name, or
--                 "iPad"), refreshed on every registration
--   custom_name   what the operator calls it ("Front booth"); never touched
--                 by registration, so a rename sticks
--   device_type   windows | mac | ipad | android_tablet — tablets are booth
--                 devices and take a seat like a PC. Phones and browsers do
--                 not register at all, so they never appear here.
--   app_version   the build it last ran, so an outdated booth is visible
--   seat_counted  true once the device has checked in through
--                 register_device(); only these rows take a seat
--
-- Why seat_counted. Rows written before 021 carry the old fingerprint, which
-- hashed the Windows build number and computer name. On a PC that has taken a
-- Windows feature update since, that fingerprint no longer matches, so on its
-- first launch of the new app it registers as a new device — and if the stale
-- row still counted, an operator could be locked out of their own booth on
-- update day. Stale rows therefore stay visible but take no seat: a row that
-- does match is carried over and starts counting, and one that never matches
-- is cleared by the 90-day prune or released by the operator. Counting old
-- rows would enforce nothing anyway, since the old app cannot be refused.
--
-- register_device() gains the identity values as optional trailing
-- parameters. It is dropped and recreated rather than overloaded: two versions
-- differing only in defaulted arguments make PostgREST calls ambiguous. Every
-- existing call passes a subset of the new parameters by name, so all still
-- resolve.
-- ============================================================


alter table public.license_devices
  add column if not exists device_name  text,
  add column if not exists custom_name  text,
  add column if not exists device_type  text,
  add column if not exists app_version  text,
  add column if not exists seat_counted boolean not null default false;

-- Free text from the client, so bounded here rather than trusted.
alter table public.license_devices
  drop constraint if exists license_devices_device_name_len,
  drop constraint if exists license_devices_custom_name_len,
  drop constraint if exists license_devices_device_type_len,
  drop constraint if exists license_devices_app_version_len;
alter table public.license_devices
  add constraint license_devices_device_name_len check (device_name is null or length(device_name) <= 64),
  add constraint license_devices_custom_name_len check (custom_name is null or length(custom_name) <= 40),
  add constraint license_devices_device_type_len check (device_type is null or length(device_type) <= 24),
  add constraint license_devices_app_version_len check (app_version is null or length(app_version) <= 32);


drop function if exists public.register_device(text, text, text);

create or replace function public.register_device(
  p_fingerprint        text,
  p_platform           text default 'unknown',
  p_legacy_fingerprint text default null,
  p_device_name        text default null,
  p_device_type        text default null,
  p_app_version        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_platform text := left(coalesce(nullif(trim(p_platform), ''), 'unknown'), 64);
  v_name     text := left(nullif(trim(p_device_name), ''), 64);
  v_type     text := left(nullif(lower(trim(p_device_type)), ''), 24);
  v_version  text := left(nullif(trim(p_app_version), ''), 32);
  v_limit    integer;
  v_used     integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_fingerprint is null or length(p_fingerprint) not between 32 and 128 then
    raise exception 'invalid_fingerprint' using errcode = '22023';
  end if;

  -- One registration per account at a time, so two devices signing in
  -- together cannot both take the last seat.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 21));

  v_limit := public._device_limit_for_user(v_uid);

  -- Known device: always admitted, whatever the count. Identity fields are
  -- refreshed only when supplied, so an older client never blanks them.
  update public.license_devices
     set last_seen_at = now(),
         platform     = v_platform,
         device_name  = coalesce(v_name, device_name),
         device_type  = coalesce(v_type, device_type),
         app_version  = coalesce(v_version, app_version),
         seat_counted = true
   where user_id = v_uid and fingerprint = p_fingerprint;
  if found then
    select count(*) into v_used from public.license_devices where user_id = v_uid and seat_counted;
    return jsonb_build_object('ok', true, 'status', 'known', 'limit', v_limit, 'used', v_used);
  end if;

  -- Registered under its old fingerprint: carry that row over. It becomes a
  -- counted seat now; it was already this device, so nothing new is consumed
  -- from the operator's point of view. Admitted regardless of the count, like
  -- any device the account already had.
  if p_legacy_fingerprint is not null and p_legacy_fingerprint <> p_fingerprint then
    update public.license_devices
       set fingerprint  = p_fingerprint,
           last_seen_at = now(),
           platform     = v_platform,
           device_name  = coalesce(v_name, device_name),
           device_type  = coalesce(v_type, device_type),
           app_version  = coalesce(v_version, app_version),
           seat_counted = true
     where user_id = v_uid and fingerprint = p_legacy_fingerprint;
    if found then
      select count(*) into v_used from public.license_devices where user_id = v_uid and seat_counted;
      return jsonb_build_object('ok', true, 'status', 'migrated', 'limit', v_limit, 'used', v_used);
    end if;
  end if;

  -- New device: only into a free seat.
  select count(*) into v_used from public.license_devices where user_id = v_uid and seat_counted;
  if v_used >= v_limit then
    return jsonb_build_object('ok', false, 'status', 'limit_reached', 'limit', v_limit, 'used', v_used);
  end if;

  insert into public.license_devices
    (user_id, fingerprint, platform, last_seen_at, device_name, device_type, app_version, seat_counted)
  values
    (v_uid, p_fingerprint, v_platform, now(), v_name, v_type, v_version, true);

  return jsonb_build_object('ok', true, 'status', 'added', 'limit', v_limit, 'used', v_used + 1);
end;
$$;


-- Same rule for the count shown to operators.
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
  select count(*) into v_used from public.license_devices where user_id = v_uid and seat_counted;
  return jsonb_build_object('limit', public._device_limit_for_user(v_uid), 'used', v_used);
end;
$$;


-- Operator-chosen label. An empty name clears it back to the device's own.
create or replace function public.rename_device(p_fingerprint text, p_name text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.license_devices
     set custom_name = left(nullif(trim(p_name), ''), 40)
   where user_id = v_uid and fingerprint = p_fingerprint;
  return found;
end;
$$;


revoke all on function public.register_device(text, text, text, text, text, text) from public, anon;
revoke all on function public.rename_device(text, text)                           from public, anon;
revoke all on function public.my_device_allowance()                               from public, anon;
grant execute on function public.register_device(text, text, text, text, text, text) to authenticated;
grant execute on function public.rename_device(text, text)                           to authenticated;
grant execute on function public.my_device_allowance()                               to authenticated;
