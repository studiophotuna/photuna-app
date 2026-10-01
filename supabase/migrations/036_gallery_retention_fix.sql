-- ============================================================
-- 036_gallery_retention_fix
--
-- Guests were told one retention period, operators were sold another, and the
-- server enforced a third -- and nothing was ever actually deleted.
--
--   * gallery_retention_plans said Monthly 30 days / Yearly 90 days, while the
--     app and website sell Monthly 6 months / Yearly 12 months.
--   * Plans written by the website (pro_monthly / pro_yearly) matched no row, so
--     those galleries silently fell back to the booth's 7-day default.
--   * purge_expired_gallery_videos() and hard_delete_expired_galleries() both
--     compared `plan_key = plan_key` with a variable of the same name, which
--     PL/pgSQL rejects as ambiguous, so every nightly run failed. Even if they
--     had run, deleting rows from storage.objects does not remove the stored
--     file (and Supabase now blocks it outright).
--
-- After this migration:
--   * Retention is Free 7 days, Trial 7 days, Monthly 6 months (180 days),
--     Yearly 12 months (365 days). The legacy gallery add-on tiers keep what
--     was bought (Plus 180, Business 365); an operator gets the longer of their
--     plan and their tier.
--   * Files are deleted when the link expires. The SQL can no longer delete
--     files itself: the gallery render service, which already holds the
--     service-role key and is woken every 10 minutes by pg_cron, claims expired
--     galleries here, removes their files through the Storage API, and then
--     calls finish_gallery_deletion() to drop the row.
--
-- Existing galleries keep the expiry they were created with. That is what their
-- guests were shown at the booth, so it is not extended retroactively.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Retention periods that match what is sold.
-- Deletion happens at expiry, so the two "after" columns are 0.
-- ------------------------------------------------------------

INSERT INTO public.gallery_retention_plans
  (plan_key, label, gallery_expires_days, video_purge_after_days, hard_delete_after_days)
VALUES
  ('free',     'Free',              7,   0, 0),
  ('trial',    'Trial',             7,   0, 0),
  ('monthly',  'Monthly',         180,   0, 0),
  ('yearly',   'Yearly',          365,   0, 0),
  ('plus',     'Gallery Add-on',  180,   0, 0),
  ('business', 'Business',        365,   0, 0)
ON CONFLICT (plan_key) DO UPDATE SET
  label                  = EXCLUDED.label,
  gallery_expires_days   = EXCLUDED.gallery_expires_days,
  video_purge_after_days = EXCLUDED.video_purge_after_days,
  hard_delete_after_days = EXCLUDED.hard_delete_after_days;


-- ------------------------------------------------------------
-- 2. One answer to "how long does this operator's gallery last?"
-- The website writes pro_monthly / pro_yearly and the app writes monthly /
-- yearly; both mean the same plan. The legacy add-on tier counts only when it
-- is longer than the plan (a pro_yearly operator with the old Plus add-on gets
-- 365 days, not Plus's 180).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gallery_canonical_plan(p_plan text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_plan, 'free'))
    WHEN 'pro_yearly'  THEN 'yearly'
    WHEN 'pro_monthly' THEN 'monthly'
    WHEN 'pro'         THEN 'monthly'
    ELSE lower(coalesce(p_plan, 'free'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.gallery_retention_days(p_user_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT greatest(
        coalesce((SELECT rp.gallery_expires_days FROM public.gallery_retention_plans rp
                  WHERE rp.plan_key = public.gallery_canonical_plan(l.plan)), 7),
        coalesce((SELECT rp.gallery_expires_days FROM public.gallery_retention_plans rp
                  WHERE rp.plan_key = l.gallery_tier
                    AND l.gallery_tier IN ('plus', 'business')), 0)
      )
      FROM public.licenses l
      WHERE l.user_id = p_user_id
      LIMIT 1
    ),
    7
  );
$$;

-- Called by the booth's gallery:create handler with the operator's own login.
-- A signed-in caller always gets their own expiry, whatever id they pass, so
-- this cannot be used to look up another operator's plan. The service role
-- (no auth.uid()) may ask about anyone.
CREATE OR REPLACE FUNCTION public.gallery_default_expires_at(p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $
  SELECT now() + make_interval(days => public.gallery_retention_days(coalesce(auth.uid(), p_user_id)));
$;

-- Still referenced by nothing new, but kept consistent for anything that reads it.
CREATE OR REPLACE FUNCTION public.gallery_effective_plan_key(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN l.gallery_tier IN ('plus', 'business') THEN l.gallery_tier
    ELSE public.gallery_canonical_plan(l.plan)
  END
  FROM public.licenses l
  WHERE l.user_id = p_user_id
  LIMIT 1;
$$;

-- These take any user id, so they are not for the public API.
REVOKE ALL ON FUNCTION public.gallery_retention_days(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gallery_default_expires_at(uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gallery_effective_plan_key(uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gallery_retention_days(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.gallery_default_expires_at(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gallery_effective_plan_key(uuid) TO service_role;


-- ------------------------------------------------------------
-- 3. Retire the SQL-only cleanup that never worked.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'photuna-purge-gallery-videos') THEN
    PERFORM cron.unschedule('photuna-purge-gallery-videos');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'photuna-hard-delete-galleries') THEN
    PERFORM cron.unschedule('photuna-hard-delete-galleries');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.purge_expired_gallery_videos();
DROP FUNCTION IF EXISTS public.hard_delete_expired_galleries();


-- ------------------------------------------------------------
-- 4. Deletion handed to the render service.
--
-- claim_expired_galleries() leases a batch of expired galleries and returns the
-- storage paths they own: the session folder, plus every path their stored URLs
-- point at (older rows may not follow the folder layout). A lease that is not
-- finished within 30 minutes -- a crash mid-delete -- is claimed again.
--
-- A session folder is only offered when no other, unexpired gallery uses the
-- same event and session, so deleting it cannot take someone else's photos.
-- ------------------------------------------------------------

ALTER TABLE public.galleries
  ADD COLUMN IF NOT EXISTS deletion_claimed_at timestamptz;

-- Signed URLs carry ?token=…; the stored object path is everything before it.
CREATE OR REPLACE FUNCTION public.gallery_object_path(p_url text, p_bucket text DEFAULT 'studiophotuna')
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(split_part(public.storage_path_from_url(p_url, p_bucket), '?', 1), '');
$$;

CREATE OR REPLACE FUNCTION public.claim_expired_galleries(p_limit int DEFAULT 25)
RETURNS TABLE (
  id             uuid,
  slug           text,
  session_prefix text,
  object_paths   text[]
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT g.id
    FROM public.galleries g
    WHERE g.expires_at IS NOT NULL
      AND g.expires_at <= now()
      AND (g.deletion_claimed_at IS NULL OR g.deletion_claimed_at < now() - interval '30 minutes')
    ORDER BY g.expires_at
    LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.galleries g
       SET deletion_claimed_at = now()
      FROM due
     WHERE g.id = due.id
    RETURNING g.*
  )
  SELECT
    c.id,
    c.slug,
    CASE
      WHEN coalesce(c.event_id, '') <> ''
       AND coalesce(c.session_id, '') <> ''
       AND position('/' IN c.event_id) = 0
       AND position('/' IN c.session_id) = 0
       AND c.event_id NOT IN ('.', '..')
       AND c.session_id NOT IN ('.', '..')
       AND NOT EXISTS (
         SELECT 1 FROM public.galleries o
         WHERE o.id <> c.id
           AND o.event_id = c.event_id
           AND o.session_id = c.session_id
           AND (o.expires_at IS NULL OR o.expires_at > now())
       )
      THEN c.event_id || '/' || c.session_id
      ELSE NULL
    END,
    ARRAY(
      SELECT DISTINCT p FROM (
        SELECT public.gallery_object_path(u) AS p
        FROM unnest(
          coalesce(c.photo_urls, '{}')
          || coalesce(c.burst_video_urls, '{}')
          || ARRAY[c.final_url, c.final_video_url]
        ) AS u
      ) paths
      WHERE p IS NOT NULL
    )
  FROM claimed c;
END;
$$;

-- Drops the row once its files are gone. Refuses a gallery that is not expired,
-- so a mistaken call cannot remove a live gallery.
CREATE OR REPLACE FUNCTION public.finish_gallery_deletion(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed int;
BEGIN
  DELETE FROM public.galleries
  WHERE id = p_id
    AND expires_at IS NOT NULL
    AND expires_at <= now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_expired_galleries(int)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_gallery_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expired_galleries(int)  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_gallery_deletion(uuid) TO service_role;
