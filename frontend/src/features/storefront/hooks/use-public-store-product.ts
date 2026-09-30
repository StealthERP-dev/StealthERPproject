import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import * as istDate from "@/lib/date/ist";
export interface PublicStoreForProduct { id: string; slug: string; shop_name: string; is_open: boolean; }
export interface StorefrontProductDetail { id: string; name: string; unit: string; price: number | null; image_url: string | null; available: boolean; category_name: string | null; }
export interface StorefrontProductOffer { id: string; offerPrice: number; regularPrice: number | null; saving: number | null; }
interface FetchedOfferRow { id: string; offer_price: number; regular_price: number | null; saving: number | null; }
interface StorefrontProductData { store: PublicStoreForProduct | null; product: StorefrontProductDetail | null; offer: StorefrontProductOffer | null; }
async function fetchStorefrontProduct(slug: string, productId: string): Promise<StorefrontProductData> {
  const { data: storeRow, error: storeError } = await supabase.from("public_stores").select("id, slug, shop_name, is_open").eq("slug", slug).maybeSingle();
  if (storeError) throw storeError;
  if (!storeRow?.id || !storeRow.slug || storeRow.shop_name === null || storeRow.is_open === null) return { store: null, product: null, offer: null };
  const store: PublicStoreForProduct = { id: storeRow.id, slug: storeRow.slug, shop_name: storeRow.shop_name, is_open: storeRow.is_open };
  const { data: productRow, error: productError } = await supabase.from("products").select("id, name, unit, price, image_url, available, categories(name)").eq("store_id", store.id).eq("id", productId).eq("available", true).maybeSingle();
  if (productError) throw productError;
  if (!productRow) return { store, product: null, offer: null };
  const { categories, ...rest } = productRow;
  const product: StorefrontProductDetail = { ...rest, category_name: categories?.name ?? null };
  const dateString = istDate.istDateString(new Date());
  const { data: offerRow, error: offerError } = await supabase.from("offers").select("id, offer_price, regular_price, saving, products!inner(available)").eq("store_id", store.id).eq("product_id", productId).eq("offer_date", dateString).eq("products.available", true).not("offer_price", "is", null).maybeSingle();
  if (offerError) throw offerError;
  const fetchedOffer = offerRow as unknown as FetchedOfferRow | null;
  const offer = fetchedOffer ? { id: fetchedOffer.id, offerPrice: fetchedOffer.offer_price, regularPrice: fetchedOffer.regular_price, saving: fetchedOffer.saving } : null;
  return { store, product, offer };
}
export function usePublicStoreProduct(slug: string, productId: string) { return useQuery({ queryKey: ["storefront-product", slug, productId], queryFn: () => fetchStorefrontProduct(slug, productId) }); }
