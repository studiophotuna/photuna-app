-- Sync the operator's tone library (custom slider tones and imported LUTs)
-- across devices, alongside events, templates, frames and palettes.
--
-- Additive and nullable. Older app versions never send the column, so their
-- saves leave it untouched.

alter table public.booth_settings
  add column if not exists tones jsonb;

comment on column public.booth_settings.tones is
  'Operator-made tones: slider adjustments and imported 3D LUTs (baked to 33 points, base64).';
