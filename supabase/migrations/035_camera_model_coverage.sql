-- Which camera models are proven to work, from operators' own cameras.
--
-- Photuna ships support for far more cameras than can be tested: 31 Nikon module
-- families alone, none of which the business owns. Operators' cameras are the
-- only realistic test fleet, so booths report the models they meet and how far
-- each one got. The result is a catalogue of models proven in the field and a
-- list still unproven.
--
-- A model is only "working" once it has done real work — a full-resolution
-- capture AND a live view frame. Detection proves nothing: a camera can
-- enumerate over USB and still fail to take a photo.
--
-- Two tables:
--   camera_model_reports  the evidence, one row per booth per model per stage.
--                         Operators read and write only their own.
--   camera_models         the catalogue built from that evidence. Admins read
--                         it; nobody writes it directly — only the RPC below,
--                         which runs as its owner, so one operator's booth can
--                         never edit a global verdict.
--
-- Booths carry no service key, so they call report_camera_model() as the signed
-- in operator. It is security definer for exactly that reason: the operator may
-- add evidence but may not touch the catalogue.
--
-- Nothing here identifies a guest or an event. The device is a hash the booth
-- already computes; it is stored as plain text and deliberately NOT a foreign
-- key into license_devices, so camera reporting can never affect seat counting.

-- ── 1. Evidence ────────────────────────────────────────────────────────────────

create table if not exists public.camera_model_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_hash  text not null,
  model_key    text not null,
  brand        text not null,
  model_label  text not null,
  stage        text not null check (stage in ('detected', 'capture', 'liveview', 'failed')),
  error_code   text,
  app_version  text,
  created_at   timestamptz not null default now(),
  -- One row per booth per model per stage. A repeated send is the same record,
  -- so retries after a flaky connection cannot inflate the counts.
  constraint camera_model_reports_unique
    unique (user_id, device_hash, model_key, stage, error_code)
);

alter table public.camera_model_reports enable row level security;

create index if not exists camera_model_reports_model_idx
  on public.camera_model_reports (model_key, created_at desc);
create index if not exists camera_model_reports_user_idx
  on public.camera_model_reports (user_id, created_at desc);

grant select on public.camera_model_reports to authenticated;

drop policy if exists "Operators read their camera reports" on public.camera_model_reports;
create policy "Operators read their camera reports"
  on public.camera_model_reports for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

-- No insert policy on purpose: writes go through report_camera_model() only.

-- ── 2. The catalogue ───────────────────────────────────────────────────────────

create table if not exists public.camera_models (
  model_key            text primary key,
  brand                text not null,
  model_label          text not null,
  -- detected: seen only. partial: one half proven. working: capture AND live view.
  status               text not null default 'detected'
                       check (status in ('detected', 'partial', 'working')),
  capture_confirmed    boolean not null default false,
  live_view_confirmed  boolean not null default false,
  operators_seen       integer not null default 0,
  failure_count        integer not null default 0,
  last_error_code      text,
  -- Room for the business to annotate a model ("needs firmware 1.2").
  notes                text,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  confirmed_at         timestamptz,
  constraint camera_models_notes_len check (notes is null or char_length(notes) <= 2000)
);

alter table public.camera_models enable row level security;

create index if not exists camera_models_status_idx on public.camera_models (status, brand, model_label);

grant select on public.camera_models to authenticated;
grant update (notes) on public.camera_models to authenticated;

drop policy if exists "Admins read the camera catalogue" on public.camera_models;
create policy "Admins read the camera catalogue"
  on public.camera_models for select
  to authenticated
  using (public.current_user_is_admin());

drop policy if exists "Admins annotate the camera catalogue" on public.camera_models;
create policy "Admins annotate the camera catalogue"
  on public.camera_models for update
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ── 3. The only way in ─────────────────────────────────────────────────────────

create or replace function public.report_camera_model(
  p_device_hash text,
  p_brand       text,
  p_model       text,
  p_stage       text,
  p_error_code  text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_device  text := left(nullif(trim(p_device_hash), ''), 128);
  v_brand   text := lower(left(coalesce(nullif(trim(p_brand), ''), 'unknown'), 24));
  v_model   text := left(nullif(trim(p_model), ''), 80);
  v_stage   text := lower(left(coalesce(nullif(trim(p_stage), ''), ''), 16));
  v_code    text := left(nullif(trim(p_error_code), ''), 40);
  v_version text := left(nullif(trim(p_app_version), ''), 32);
  v_key     text;
  v_capture boolean;
  v_live    boolean;
  v_status  text;
  v_ops     integer;
  v_fails   integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_device is null or v_model is null then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if v_stage not in ('detected', 'capture', 'liveview', 'failed') then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;

  -- Only a failure carries a code; anything else would key the unique
  -- constraint on noise and let one booth write the same fact repeatedly.
  if v_stage <> 'failed' then
    v_code := null;
  end if;

  v_key := v_brand || ':' || lower(regexp_replace(v_model, '\s+', ' ', 'g'));

  insert into public.camera_model_reports
    (user_id, device_hash, model_key, brand, model_label, stage, error_code, app_version)
  values
    (v_uid, v_device, v_key, v_brand, v_model, v_stage, v_code, v_version)
  on conflict on constraint camera_model_reports_unique do nothing;

  -- Rebuild the verdict from the evidence rather than trusting this one call,
  -- so the catalogue is always a function of what booths actually reported.
  select
    bool_or(stage = 'capture'),
    bool_or(stage = 'liveview'),
    count(distinct user_id),
    count(*) filter (where stage = 'failed')
  into v_capture, v_live, v_ops, v_fails
  from public.camera_model_reports
  where model_key = v_key;

  v_capture := coalesce(v_capture, false);
  v_live    := coalesce(v_live, false);

  -- Proven means both halves. One half is progress, not proof.
  v_status := case
                when v_capture and v_live then 'working'
                when v_capture or v_live  then 'partial'
                else 'detected'
              end;

  insert into public.camera_models as m
    (model_key, brand, model_label, status, capture_confirmed, live_view_confirmed,
     operators_seen, failure_count, last_error_code, last_seen_at,
     confirmed_at)
  values
    (v_key, v_brand, v_model, v_status, v_capture, v_live,
     coalesce(v_ops, 0), coalesce(v_fails, 0), v_code, now(),
     case when v_status = 'working' then now() end)
  on conflict (model_key) do update
    set status              = v_status,
        capture_confirmed   = v_capture,
        live_view_confirmed = v_live,
        operators_seen      = coalesce(v_ops, 0),
        failure_count       = coalesce(v_fails, 0),
        -- Keep the newest reason, but never blank a known one with a success.
        last_error_code     = coalesce(v_code, m.last_error_code),
        model_label         = m.model_label,
        last_seen_at        = now(),
        -- Proof is one way: once a model has worked somewhere it stays proven,
        -- or one bad venue would un-prove a good camera for everyone.
        confirmed_at        = coalesce(m.confirmed_at, case when v_status = 'working' then now() end);

  return jsonb_build_object('ok', true, 'modelKey', v_key, 'status', v_status);
end;
$$;

revoke all on function public.report_camera_model(text, text, text, text, text, text) from public, anon;
grant execute on function public.report_camera_model(text, text, text, text, text, text) to authenticated;
