import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import * as istDate from "@/lib/date/ist";
import type { Database } from "@/lib/supabase/database.types";

export interface PublicStore { id: string; slug: string; shop_name: string; is_open: boolean; }
export type StorefrontProduct = Pick<Database["public"]["Tables"]["products"]["Row"], "id" | "name" | "unit" | "price" | "image_url"> & { category_name: string | null };
export interface StorefrontOffer { id: string; productId: string; productName: string; productImageUrl: string | null; offerPrice: number; regularPrice: number | null; saving: number | null; }
interface FetchedOfferRow { id: string; product_id: string; offer_price: number; regular_price: number | null; saving: number | null; products: { name: string; image_url: string | null; unit: string; available: boolean }; }
interface StorefrontData { store: PublicStore | null; products: StorefrontProduct[]; offers: StorefrontOffer[]; }
async function fetchStorefront(slug: string): Promise<StorefrontData> {
  const { data: row, error: storeError } = await supabase.from("public_stores").select("id, slug, shop_name, is_open").eq("slug", slug).maybeSingle();
  if (storeError) throw storeError;
  if (!row?.id || !row.slug || row.shop_name === null || row.is_open === null) return { store: null, products: [], offers: [] };
  const store: PublicStore = { id: row.id, slug: row.slug, shop_name: row.shop_name, is_open: row.is_open };
  const { data: products, error: productsError } = await supabase.from("products").select("id, name, unit, price, image_url, categories(name)").eq("store_id", store.id).eq("available", true).order("name");
  if (productsError) throw productsError;
  const dateString = istDate.istDateString(new Date());
  const { data: offerRows, error: offersError } = await supabase.from("offers").select("id, product_id, offer_price, regular_price, saving, products!inner(name, image_url, unit, available)").eq("store_id", store.id).eq("offer_date", dateString).eq("products.available", true).not("offer_price", "is", null);
  if (offersError) throw offersError;
  const offers: StorefrontOffer[] = (offerRows as unknown as FetchedOfferRow[]).map(o => ({ id: o.id, productId: o.product_id, productName: o.products.name, productImageUrl: o.products.image_url, offerPrice: o.offer_price, regularPrice: o.regular_price, saving: o.saving }));
  return { store, products: products.map(({ categories, ...product }) => ({ ...product, category_name: categories?.name ?? null })), offers };
}
export function usePublicStore(slug: string) { return useQuery({ queryKey: ["storefront", slug], queryFn: () => fetchStorefront(slug) }); }
