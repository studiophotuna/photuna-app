-- Guest consent that is actually recorded, guest surveys, and emailed gallery links.
--
-- 1. booth_consent_logs has only ever accepted writes from the service role, but
--    the booth writes as the signed-in operator (packaged builds carry no service
--    key). Every insert was rejected and swallowed: the table was empty while
--    galleries were being created. Operators now record consent for their own
--    sessions, together with the disclaimer text the guest agreed to.
-- 2. booth_survey_responses holds the answers guests give on the optional survey
--    screen, one row per session.
-- 3. gallery_email_shares is the send log of the send-gallery-email function. It
--    stores a hash of the guest's address, never the address, and is written only
--    by that function (service role).

-- ── 1. Consent ─────────────────────────────────────────────────────────────────

alter table public.booth_consent_logs
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  add column if not exists disclaimer_hash text,
  add column if not exists disclaimer_text text;

alter table public.booth_consent_logs
  drop constraint if exists booth_consent_logs_disclaimer_text_len;
alter table public.booth_consent_logs
  add constraint booth_consent_logs_disclaimer_text_len
  check (disclaimer_text is null or char_length(disclaimer_text) <= 8000);

create index if not exists booth_consent_logs_user_idx
  on public.booth_consent_logs (user_id, consented_at desc);

grant select, insert on public.booth_consent_logs to authenticated;

drop policy if exists "Operators record consent for their sessions" on public.booth_consent_logs;
create policy "Operators record consent for their sessions"
  on public.booth_consent_logs for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Operators read their consent logs" on public.booth_consent_logs;
create policy "Operators read their consent logs"
  on public.booth_consent_logs for select
  to authenticated
  using (user_id = auth.uid());

-- ── 2. Survey responses ────────────────────────────────────────────────────────

create table if not exists public.booth_survey_responses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id       text not null,
  session_id     text not null,
  survey_version text,
  answers        jsonb not null default '[]'::jsonb,
  submitted_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint booth_survey_responses_session_unique unique (user_id, session_id),
  constraint booth_survey_responses_answers_array check (jsonb_typeof(answers) = 'array'),
  constraint booth_survey_responses_answers_size check (pg_column_size(answers) <= 32768)
);

alter table public.booth_survey_responses enable row level security;

create index if not exists booth_survey_responses_event_idx
  on public.booth_survey_responses (user_id, event_id, submitted_at desc);

grant select, insert, delete on public.booth_survey_responses to authenticated;

drop policy if exists "Operators record survey answers" on public.booth_survey_responses;
create policy "Operators record survey answers"
  on public.booth_survey_responses for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Operators read their survey answers" on public.booth_survey_responses;
create policy "Operators read their survey answers"
  on public.booth_survey_responses for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Operators delete their survey answers" on public.booth_survey_responses;
create policy "Operators delete their survey answers"
  on public.booth_survey_responses for delete
  to authenticated
  using (user_id = auth.uid());

-- ── 3. Emailed gallery links ───────────────────────────────────────────────────

create table if not exists public.gallery_email_shares (
  id                  uuid primary key default gen_random_uuid(),
  request_id          text not null unique,
  user_id             uuid not null references auth.users (id) on delete cascade,
  gallery_slug        text not null,
  email_hash          text not null,
  status              text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error               text,
  created_at          timestamptz not null default now()
);

alter table public.gallery_email_shares enable row level security;

create index if not exists gallery_email_shares_user_idx
  on public.gallery_email_shares (user_id, created_at desc);
create index if not exists gallery_email_shares_slug_idx
  on public.gallery_email_shares (gallery_slug);

grant select on public.gallery_email_shares to authenticated;

drop policy if exists "Operators read their email sends" on public.gallery_email_shares;
create policy "Operators read their email sends"
  on public.gallery_email_shares for select
  to authenticated
  using (user_id = auth.uid());
