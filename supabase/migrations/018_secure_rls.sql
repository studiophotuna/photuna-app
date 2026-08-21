-- 018_secure_rls.sql
-- Adds RLS policies so the Electron app can read licenses, discount codes, and
-- manage devices directly via the anon client (user JWT), removing the need for
-- the service-role key in the distributed installer.

-- ─── licenses ────────────────────────────────────────────────────────────────
-- Allow authenticated users to read their own license row.
-- Admin/superadmin reads (for the admin panel) still use the service role key
-- via Supabase Edge Functions, which bypass RLS automatically.

DROP POLICY IF EXISTS "user_read_own_license" ON licenses;
CREATE POLICY "user_read_own_license" ON licenses
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── discount_codes ───────────────────────────────────────────────────────────
-- Allow any authenticated user to read currently-active discount codes so the
-- app can validate them client-side without hitting the embedded server.
-- Expired, inactive, and future codes are hidden by the USING clause.

DROP POLICY IF EXISTS "authenticated_read_active_discounts" ON discount_codes;
CREATE POLICY "authenticated_read_active_discounts" ON discount_codes
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (valid_from  IS NULL OR valid_from  <= now())
    AND (valid_until IS NULL OR valid_until >  now())
  );

-- ─── license_devices ─────────────────────────────────────────────────────────
-- Allow authenticated users to upsert and delete their own device registrations.
-- The app calls this directly when a device first connects.

DROP POLICY IF EXISTS "user_manage_own_devices" ON license_devices;
CREATE POLICY "user_manage_own_devices" ON license_devices
  FOR ALL TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
