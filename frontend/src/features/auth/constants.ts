export const BUSINESS_TYPE_OPTIONS = [
  "Fruits",
  "Vegetables",
  "Grocery",
  "Bakery & Confectionery",
  "Fish & Seafood",
  "Chicken & Poultry",
  "Meat",
  "Clothing & Fashion",
  "Footwear",
  "Mobile & Accessories",
  "Electronics",
  "Pharmacy & Personal Care",
  "Home & Kitchen",
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_OPTIONS)[number];

// The auth error taxonomy (AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES,
// GENERIC_AUTH_ERROR) used to live here but moved into
// src/features/auth/lib/auth-error.ts (IN-03) — they were consumed only by
// that one file, so the cross-file import (and the `allowImportingTsExtensions`
// tsconfig flag it required) was surface area with no other consumer to
// justify it.
