-- ============================================================
-- 020_secure_delete_event_storage
--
-- Hardens public.delete_event_storage(), added in 008_archive_and_cleanup.
--
-- The original definition is SECURITY DEFINER with no ownership check and no
-- GRANT/REVOKE statements. Postgres grants EXECUTE to PUBLIC by default, so
-- through PostgREST the `anon` and `authenticated` roles can both call it with
-- an arbitrary p_event_id — deleting any other operator's storage objects and
-- hard-deleting their gallery rows.
--
-- This migration:
--   1. Adds an ownership check, so a caller may only clean up an event they own.
--   2. Revokes EXECUTE from PUBLIC/anon and grants it to authenticated only.
--   3. Leaves service_role able to call it unrestricted (bypasses the check via
--      a NULL auth.uid(), used by the scheduled cleanup job and the desktop
--      app's dev-only privileged path).
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_event_storage(p_event_id text, p_bucket text DEFAULT 'studiophotuna')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
  caller  uuid := auth.uid();
BEGIN
  -- service_role / trusted server-side callers have no auth.uid() and are
  -- allowed through. An end user must own the event they are cleaning up.
  IF caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.galleries
      WHERE event_id = p_event_id
        AND owner_user_id = caller
    ) THEN
      RAISE EXCEPTION 'not_authorised_for_event %', p_event_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Remove all storage objects under this event prefix
  WITH removed AS (
    DELETE FROM storage.objects
    WHERE bucket_id = p_bucket
      AND name LIKE p_event_id || '/%'
    RETURNING id
  )
  SELECT count(*) INTO deleted FROM removed;

  -- Hard-delete gallery rows for this event (video/photo files already gone)
  DELETE FROM public.galleries WHERE event_id = p_event_id;

  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_event_storage(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_event_storage(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_event_storage(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_event_storage(text, text) TO service_role;
