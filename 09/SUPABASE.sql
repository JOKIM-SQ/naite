-- S09 only. Run using a Supabase database administrator. Safe to re-run.
BEGIN;
CREATE OR REPLACE FUNCTION public.s09_image_path_valid(path text, owner_id uuid, card_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT path ~ ('^' || owner_id::text || '/' || card_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(source|thumbnail|pixel)$')
$$;
CREATE OR REPLACE FUNCTION public.s09_palette_valid(colors jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN jsonb_typeof(colors) = 'array' THEN jsonb_array_length(colors) = 5 AND NOT EXISTS
 (SELECT 1 FROM jsonb_array_elements(colors) AS item WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' !~ '^#[0-9a-fA-F]{6}$') ELSE false END
$$;
CREATE TABLE IF NOT EXISTS public.s09_cards (
 id uuid PRIMARY KEY, revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 500),
 created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
 palette jsonb NOT NULL CHECK (public.s09_palette_valid(palette)),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 32768), height integer NOT NULL CHECK (height BETWEEN 1 AND 32768),
 columns integer NOT NULL CHECK (columns IN (32,64,96,128)),
 grid_width integer NOT NULL CHECK (grid_width BETWEEN 1 AND 32768), grid_height integer NOT NULL CHECK (grid_height BETWEEN 1 AND 32768),
 pixel_mode text NOT NULL CHECK (pixel_mode IN ('original','style','detail')),
 source_path text NOT NULL, thumbnail_path text NOT NULL, pixel_path text NOT NULL,
 CHECK (public.s09_image_path_valid(source_path,user_id,id)),
 CHECK (public.s09_image_path_valid(thumbnail_path,user_id,id)),
 CHECK (public.s09_image_path_valid(pixel_path,user_id,id))
);
CREATE INDEX IF NOT EXISTS s09_cards_owner_created ON public.s09_cards(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.s09_image_cleanup (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 paths text[] NOT NULL CHECK (cardinality(paths) BETWEEN 1 AND 3), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.s09_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s09_image_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.s09_cards, public.s09_image_cleanup FROM PUBLIC,anon;
GRANT SELECT,INSERT,DELETE ON public.s09_cards TO authenticated;
REVOKE UPDATE ON public.s09_cards FROM authenticated;
GRANT UPDATE (revision,name,created_at,palette,width,height,columns,grid_width,grid_height,pixel_mode,source_path,thumbnail_path,pixel_path) ON public.s09_cards TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.s09_image_cleanup TO authenticated;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='s09_cards' AND policyname='s09_owner') THEN
 CREATE POLICY s09_owner ON public.s09_cards FOR ALL TO authenticated USING ((SELECT auth.uid()) IS NOT NULL) WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
 ELSE
 ALTER POLICY s09_owner ON public.s09_cards TO authenticated USING ((SELECT auth.uid()) IS NOT NULL) WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='s09_cards' AND policyname='s09_creator_insert') THEN
 CREATE POLICY s09_creator_insert ON public.s09_cards AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=user_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='s09_image_cleanup' AND policyname='s09_cleanup_owner') THEN
 CREATE POLICY s09_cleanup_owner ON public.s09_image_cleanup FOR ALL TO authenticated USING ((SELECT auth.uid())=user_id) WITH CHECK ((SELECT auth.uid())=user_id);
 END IF;
END $$;
-- INVOKER preserves RLS. Lock serializes competing replacements; deleted paths remain durable.
CREATE OR REPLACE FUNCTION public.s09_save_card(p_card jsonb, p_expected_revision bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE incoming public.s09_cards; previous public.s09_cards; obsolete text[];
BEGIN
 incoming := jsonb_populate_record(NULL::public.s09_cards,p_card);
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('s09:' || incoming.id::text,0));
 SELECT * INTO previous FROM public.s09_cards WHERE id=incoming.id FOR UPDATE;
 IF (previous.id IS NULL AND p_expected_revision IS NOT NULL) OR (previous.id IS NOT NULL AND previous.revision IS DISTINCT FROM p_expected_revision) THEN
 RAISE EXCEPTION '다른 탭에서 카드가 변경되었습니다. 다시 불러와 주세요.' USING ERRCODE='P0001', DETAIL='s09_revision_conflict';
 END IF;
 IF incoming.user_id IS DISTINCT FROM coalesce(previous.user_id,auth.uid()) THEN RAISE EXCEPTION '카드 최초 등록자는 변경할 수 없습니다.'; END IF;
 incoming.user_id := coalesce(previous.user_id,auth.uid());
 incoming.revision := coalesce(previous.revision,0)+1;
 IF previous.id IS NULL THEN
 INSERT INTO public.s09_cards SELECT incoming.*;
 ELSE
 UPDATE public.s09_cards SET revision=incoming.revision,
 name=incoming.name,created_at=incoming.created_at,palette=incoming.palette,width=incoming.width,height=incoming.height,
 columns=incoming.columns,grid_width=incoming.grid_width,grid_height=incoming.grid_height,pixel_mode=incoming.pixel_mode,
 source_path=incoming.source_path,thumbnail_path=incoming.thumbnail_path,pixel_path=incoming.pixel_path
 WHERE id=previous.id;
 END IF;
 SELECT array_agg(path) INTO obsolete FROM unnest(ARRAY[previous.source_path,previous.thumbnail_path,previous.pixel_path]) AS path
 WHERE path IS NOT NULL AND path <> ALL(ARRAY[incoming.source_path,incoming.thumbnail_path,incoming.pixel_path]);
 IF cardinality(obsolete)>0 THEN INSERT INTO public.s09_image_cleanup(user_id,paths) VALUES(auth.uid(),obsolete); END IF;
 RETURN incoming.revision;
END $$;
CREATE OR REPLACE FUNCTION public.s09_delete_card(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE previous public.s09_cards;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('s09:' || p_id::text,0));
 SELECT * INTO previous FROM public.s09_cards WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 DELETE FROM public.s09_cards WHERE id=p_id;
 INSERT INTO public.s09_image_cleanup(user_id,paths) VALUES(auth.uid(),ARRAY[previous.source_path,previous.thumbnail_path,previous.pixel_path]);
END $$;
REVOKE ALL ON FUNCTION public.s09_save_card(jsonb,bigint),public.s09_delete_card(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.s09_save_card(jsonb,bigint),public.s09_delete_card(uuid) TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('s09-chroma-images','s09-chroma-images',false,12582912,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='s09_images_read') THEN
 CREATE POLICY s09_images_read ON storage.objects FOR SELECT TO authenticated USING
 (bucket_id='s09-chroma-images' AND (SELECT auth.uid()) IS NOT NULL);
 ELSE
 ALTER POLICY s09_images_read ON storage.objects TO authenticated USING (bucket_id='s09-chroma-images' AND (SELECT auth.uid()) IS NOT NULL);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='s09_images_insert') THEN
 CREATE POLICY s09_images_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK
 (bucket_id='s09-chroma-images' AND (SELECT auth.uid()) IS NOT NULL AND (split_part(name,'/',1)=(SELECT auth.uid())::text OR EXISTS (SELECT 1 FROM public.s09_cards AS card WHERE card.id::text=split_part(storage.objects.name,'/',2) AND card.user_id::text=split_part(storage.objects.name,'/',1))) AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(source|thumbnail|pixel)$');
 ELSE
 ALTER POLICY s09_images_insert ON storage.objects TO authenticated WITH CHECK
 (bucket_id='s09-chroma-images' AND (SELECT auth.uid()) IS NOT NULL AND (split_part(name,'/',1)=(SELECT auth.uid())::text OR EXISTS (SELECT 1 FROM public.s09_cards AS card WHERE card.id::text=split_part(storage.objects.name,'/',2) AND card.user_id::text=split_part(storage.objects.name,'/',1))) AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(source|thumbnail|pixel)$');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='s09_images_delete') THEN
 CREATE POLICY s09_images_delete ON storage.objects FOR DELETE TO authenticated USING
 (bucket_id='s09-chroma-images' AND (SELECT auth.uid()) IS NOT NULL);
 ELSE
 ALTER POLICY s09_images_delete ON storage.objects TO authenticated USING (bucket_id='s09-chroma-images' AND (SELECT auth.uid()) IS NOT NULL);
 END IF;
END $$;

COMMIT;
