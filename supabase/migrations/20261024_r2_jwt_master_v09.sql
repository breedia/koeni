-- KOESELL v0.9: R2 master registration via authenticated seller JWT and RLS.
-- Cloudflare Pages Functions validate the logged-in seller and write the actual R2 object.
-- This replaces the need to copy a privileged Supabase key into Cloudflare.
-- Checkout MUST verify existence of the R2 object before enabling paid transactions.
DROP POLICY IF EXISTS voice_product_owner_insert ON public.voice_products;
CREATE POLICY voice_product_owner_insert ON public.voice_products FOR INSERT TO authenticated
WITH CHECK (
  storage_backend IN ('supabase','r2')
  AND owner_id=(select auth.uid())
  AND NOT koesell_private.is_banned((select auth.uid()))
  AND master_path LIKE (select auth.uid())::text || '/' || listing_id::text || '/%'
  AND (storage_backend='supabase' OR master_path ~ (
   '^' || (select auth.uid())::text || '/' || listing_id::text ||
   '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](mp3|m4a|wav|ogg|webm|aac|flac)$'))
  AND EXISTS (SELECT 1 FROM public.voice_listings l
    WHERE l.id=listing_id AND l.owner_id=(select auth.uid())
    AND l.listing_type='stock' AND l.is_published=true
    AND l.review_status='approved')
);