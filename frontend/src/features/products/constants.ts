export const SMART_CATEGORIES: Record<string, readonly string[]> = {
  Fruits: ["Fresh Fruits", "Seasonal"],
  Vegetables: ["Vegetables", "Leafy Greens", "Herbs"],
  Grocery: ["Staples", "Dairy", "Beverages", "Snacks", "Household"],
  "Bakery & Confectionery": ["Bread", "Cakes", "Pastries", "Sweets"],
  "Fish & Seafood": ["Fresh Fish", "Seafood"],
  "Chicken & Poultry": ["Chicken", "Eggs"],
  Meat: ["Beef", "Mutton", "Other Meat"],
  "Clothing & Fashion": ["Men", "Women", "Kids", "Accessories"],
  Footwear: ["Men's", "Women's", "Kids'"],
  "Mobile & Accessories": [
    "Phones",
    "Cases",
    "Chargers",
    "Audio",
    "Accessories",
  ],
  Electronics: ["Phones & Devices", "Accessories", "Home Electronics"],
  "Pharmacy & Personal Care": ["Medicine", "Personal Care", "Wellness"],
  "Home & Kitchen": ["Kitchen", "Home", "Storage"],
};

export const UNIT_OPTIONS = [
  "piece",
  "kg",
  "500g",
  "pack",
  "dozen",
  "litre",
] as const;

export function stockImageUrl(id: string): string {
  return `https://images.unsplash.com/photo-${id}?w=400&h=400&fit=crop&auto=format`;
}

const STOCK_IMAGE_IDS = [
  "1582284540020-8acbe03f4924",
  "1603036966599-dd8428837323",
  "1568584711271-6c929fb49b60",
  "1619546813926-a78fa6372cd2",
  "1608198093002-ad4e005484ec",
  "1506976785307-8732e854ad03",
  "1605197378298-02bf0af1c896",
  "1542838132-92c53300491e",
] as const;

export const STOCK_IMAGES = STOCK_IMAGE_IDS.map(stockImageUrl);

export function getSuggestedCategories(
  businessTypes: readonly string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const businessType of businessTypes) {
    for (const category of SMART_CATEGORIES[businessType] ?? []) {
      if (!seen.has(category)) {
        seen.add(category);
        result.push(category);
      }
    }
  }
  return result;
}
