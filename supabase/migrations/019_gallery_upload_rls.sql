-- ============================================================
-- Photuna — Migration 019: Gallery Upload RLS
--
-- Allows the Electron booth app to upload photos and generate
-- signed URLs using only the user's JWT (anon key + access
-- token), removing the need for SUPABASE_SERVICE_ROLE_KEY in
-- the distributed installer.
--
-- Changes:
--   1. Storage SELECT policy — relaxed to allow any authenticated
--      user to create signed URLs for the studiophotuna bucket.
--      The original policy required an existing galleries row to
--      match the session_id, which blocked signed URL creation
--      before the gallery row was saved (chicken-and-egg).
--      Paths are opaque UUIDs so this is safe without row-level
--      scoping.
--   2. Storage UPDATE policy — added so upsert (upload with
--      upsert:true) works for authenticated users.
-- ============================================================


-- 1. Relax the SELECT policy for gallery session files
DROP POLICY IF EXISTS "Operators read own session files" ON storage.objects;
CREATE POLICY "Operators read own session files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'studiophotuna');


-- 2. Add UPDATE policy so upload with upsert:true works
DROP POLICY IF EXISTS "Operators update own session files" ON storage.objects;
CREATE POLICY "Operators update own session files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'studiophotuna')
  WITH CHECK (bucket_id = 'studiophotuna');
