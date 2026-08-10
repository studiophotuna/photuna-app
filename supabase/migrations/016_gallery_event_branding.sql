-- ------------------------------------------------------------
-- GALLERY EVENT BRANDING
-- Operator-configured colours for the event gallery page.
-- Written by AdminDashboard (booth app) and BrandingEditor
-- (gallery admin site). Read by gallery display pages.
-- ------------------------------------------------------------

create table if not exists public.gallery_event_branding (
  id                   uuid primary key default gen_random_uuid(),
  event_id             text not null unique,
  owner_user_id        uuid references auth.users(id) on delete cascade,
  accent_color         text,
  bg_color             text,
  text_color           text,
  secondary_text_color text,
  event_name           text,
  updated_at           timestamptz not null default now()
);

alter table public.gallery_event_branding enable row level security;

-- Gallery pages (no login required) can read branding
create policy "Public can read gallery branding"
  on public.gallery_event_branding for select
  using (true);

-- Authenticated users can insert branding for any event they touch
create policy "Authenticated can insert gallery branding"
  on public.gallery_event_branding for insert
  with check (auth.role() in ('authenticated', 'service_role'));

-- Authenticated users can update branding rows they own
create policy "Authenticated can update own gallery branding"
  on public.gallery_event_branding for update
  using (auth.role() = 'service_role' or auth.uid() = owner_user_id)
  with check (auth.role() = 'service_role' or auth.uid() = owner_user_id);
