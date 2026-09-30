-- Phase 1 storage (PLAT-05): product-images public bucket + owner-folder-scoped
-- write policies on storage.objects. Per research Pitfall 4, bucket public=true
-- governs reads only — write-scoping to the vendor's own <store_id>/ folder is
-- entirely from the storage.objects policies below, keyed on
-- private.owned_store_id() (defined in the Phase 1 RLS migration). No anon
-- policy is created on storage.objects: customers read through the public
-- bucket URL, which needs none.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "product-images: owner reads own folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select private.owned_store_id())::text
);

create policy "product-images: owner uploads to own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select private.owned_store_id())::text
);

create policy "product-images: owner updates own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select private.owned_store_id())::text
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select private.owned_store_id())::text
);

create policy "product-images: owner deletes from own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select private.owned_store_id())::text
);
