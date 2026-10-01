-- Fix: storage.buckets has RLS enabled but no SELECT policy.
-- The Supabase storage client needs to read bucket metadata to verify
-- the bucket exists before accepting an upload. Without this policy,
-- every upload attempt fails because the bucket is invisible to authenticated users.

DROP POLICY IF EXISTS "authenticated can read buckets" ON storage.buckets;
CREATE POLICY "authenticated can read buckets" ON storage.buckets
  FOR SELECT TO authenticated
  USING (true);
