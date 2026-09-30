"use client";

// The Add/Edit product form (PROD-03/04/05/06). Copies setup-form.tsx's
// file organisation: class constants at module scope, one derived validity
// boolean, and a submit handler that calls the container's submit-start
// callback before `mutate`, passing the container's success callback in as
// `mutate`'s second argument — exactly setup-form.tsx's shape (module-scope
// constants: setup-form.tsx:28-31; validity + submit: setup-form.tsx:57-68).
//
// The validity rule is exactly the prototype's: a name with at least one
// non-space character, and nothing else (App.tsx's
// `canSave = name.trim().length >= 1`). Category, unit, price and
// availability never block Save (PROD-03).
//
// Category (Task 2, PROD-05): one local `selectedCategory` string state,
// exactly like the prototype's own `selectedCategory` — "" means the "None"
// chip, otherwise it holds a category NAME, never an id, because the same
// state has to represent three different things indistinguishably: a
// suggestion chip never before created for this shop, one of the shop's own
// persisted categories, or a name just typed through "Create new". At
// submit time the name is looked up against the shop's persisted categories
// (useCategories): a match resolves directly to that row's id
// (categoryId), no upsert needed; no match means the name is new — even a
// suggestion chip counts as new until a real row exists for it — and is
// carried as newCategoryName for use-save-product.ts's mutation to resolve
// through the upsert. A name typed into the create-new field is only ever
// carried on this state, never written itself — writing it before Save
// would orphan a category row every time the vendor backs out unsaved, and
// this phase ships no delete path to clean one up.
//
// Selling unit + price (Task 3, D-06/D-07): unit defaults to the first
// option so it is never truly empty, matching the prototype. The price
// field runs every keystroke through format-price.ts's sanitiser, so an
// unparseable value can never be typed in the first place — the
// Save-enabled condition stays name-only while nothing the vendor typed is
// silently dropped at save time.
//
// Photo (plan 03-04, PROD-04): a file picked in the source sheet is run
// through process-photo.ts before the form ever holds anything uploadable
// — the form only ever carries an already-small, already-verified JPEG
// blob plus an object-URL preview, never the raw picked file. On any
// pipeline failure the field reverts to its empty state (D-01) rather than
// showing a half-resized preview, and the message reuses use-save-product's
// own lookup rather than a second copy of the same three sentences. The
// preview URL is revoked whenever it is replaced so repeated picks don't
// leak object URLs.
//
// Edit-mode pre-fill (plan 03-05, PROD-07): an optional existing row seeds
// every field's state through a LAZY initialiser — never an effect that sets
// state on mount, which would trip this project's lint rule and reintroduce
// a render-order dependency (see login-form.tsx for the shipped precedent of
// this exact technique). The photo field seeds only the preview URL from the
// row's own stored image, never a blob: no new blob means no new upload, so
// a save that does not touch the photo leaves the stored image untouched.
// The screen header (Add/Edit product) and the shipped back button live here
// too — a gap left open by an earlier plan in this phase, closed now because
// this is where the container first needed two distinct header states.

import { useState, type ChangeEvent } from "react";
import { Camera, Check, Plus, X } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Toggle } from "@/components/ui/toggle";
import { useAuth } from "@/features/auth/auth-provider";
import { useCategories } from "@/features/products/hooks/use-categories";
import {
  getSuggestedCategories,
  UNIT_OPTIONS,
} from "@/features/products/constants";
import {
  sanitizePriceInput,
  parsePriceInput,
  formatPriceDisplay,
} from "@/features/products/lib/format-price";
import {
  processPhoto,
  type ProcessPhotoErrorCode,
} from "@/features/products/lib/process-photo";
import { PhotoSourceSheet } from "@/features/products/components/photo-source-sheet";
import {
  useSaveProduct,
  saveProductMessage,
  SaveProductError,
  type SaveProductInput,
} from "@/features/products/hooks/use-save-product";
import type { Product } from "@/features/products/hooks/use-products";

const inputClass =
  "w-full h-12 px-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all";
const fieldLabelClass = "block text-sm font-medium text-foreground mb-2.5";
const chipClass =
  "flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-all active:scale-95";

function setValue(setter: (value: string) => void) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
  };
}

export function ProductForm({
  storeId,
  mode = "create",
  initialProduct = null,
  onSubmitStart,
  onSuccess,
}: {
  storeId: string;
  mode?: "create" | "update";
  /** The existing row an update mode seeds every field from. Null in create
   * mode, or when the row could not be resolved yet. */
  initialProduct?: Product | null;
  // Fired the instant a submit is accepted, BEFORE the mutation runs — the
  // container needs this to hold its flow identity before anything else
  // could swap the form out from under its own mutation.
  onSubmitStart: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(() => initialProduct?.name ?? "");
  const [available, setAvailable] = useState(
    () => initialProduct?.available ?? true,
  );
  const [selectedCategory, setSelectedCategory] = useState(
    () => initialProduct?.category_name ?? "",
  );
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryText, setNewCategoryText] = useState("");
  const [unit, setUnit] = useState<string>(
    () => initialProduct?.unit ?? UNIT_OPTIONS[0],
  );
  const [priceText, setPriceText] = useState(() =>
    initialProduct ? formatPriceDisplay(initialProduct.price) : "",
  );
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(
    () => initialProduct?.image_url ?? null,
  );
  const [photoPending, setPhotoPending] = useState(false);
  const [photoErrorCode, setPhotoErrorCode] =
    useState<ProcessPhotoErrorCode | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const saveProduct = useSaveProduct(storeId);
  const { store } = useAuth();
  const categoriesQuery = useCategories(storeId);

  function handlePhotoFile(file: File) {
    setPhotoErrorCode(null);
    setPhotoPending(true);
    processPhoto(file)
      .then((result) => {
        setPhotoPending(false);
        if (result.error) {
          setPhotoErrorCode(result.error);
          setPhotoBlob(null);
          setPhotoPreviewUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return null;
          });
          return;
        }
        setPhotoBlob(result.blob);
        const nextUrl = URL.createObjectURL(result.blob);
        setPhotoPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return nextUrl;
        });
      })
      .catch(() => {
        setPhotoPending(false);
        setPhotoErrorCode("undecodable");
      });
  }

  const suggestedCategories = getSuggestedCategories(
    store?.business_types ?? [],
  );
  const persistedCategories = categoriesQuery.data ?? [];
  const categoryOptions = [
    ...suggestedCategories,
    ...persistedCategories
      .map((category) => category.name)
      .filter((categoryName) => !suggestedCategories.includes(categoryName)),
  ];

  const isValid = name.trim().length >= 1;
  const canSubmit = isValid && !saveProduct.isPending;

  function handleConfirmNewCategory() {
    const trimmed = newCategoryText.trim();
    if (trimmed) {
      setSelectedCategory(trimmed);
    }
    setShowNewCategoryInput(false);
    setNewCategoryText("");
  }

  // Selecting an existing chip (including "None") always wins over an
  // open, unconfirmed "Create new" input — close it and discard its draft
  // text so the two paths can never silently fight over selectedCategory.
  function selectExistingCategory(name: string) {
    setSelectedCategory(name);
    setShowNewCategoryInput(false);
    setNewCategoryText("");
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmitStart();

    const matchedCategory = persistedCategories.find(
      (category) => category.name === selectedCategory,
    );

    const input: SaveProductInput = {
      mode,
      productId: initialProduct?.id,
      name,
      categoryId:
        selectedCategory === "" ? null : (matchedCategory?.id ?? null),
      newCategoryName:
        selectedCategory === "" || matchedCategory ? null : selectedCategory,
      unit,
      price: parsePriceInput(priceText),
      available,
      photoBlob,
    };
    saveProduct.mutate(input, { onSuccess });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 pt-5 pb-4">
        <BackButton />
        <h1 className="text-[17px] font-semibold text-foreground">
          {mode === "update" ? "Edit product" : "Add product"}
        </h1>
      </div>
      <div className="scrollbar-hide flex flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-6 px-5 pt-5 pb-32">
          <div>
            <label className={fieldLabelClass}>Photo</label>
            <div className="relative">
              {photoPreviewUrl ? (
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a just-created object URL is a local blob: reference, never a next/image-optimisable remote source */}
                  <img
                    src={photoPreviewUrl}
                    alt="Product"
                    className={`h-full w-full object-cover ${photoPending ? "opacity-50" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoSheetOpen(true);
                    }}
                    disabled={photoPending}
                    className="absolute right-3 bottom-3 h-11 rounded-xl bg-black/50 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-transform active:scale-95 disabled:opacity-60"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPhotoSheetOpen(true);
                  }}
                  disabled={photoPending}
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-border bg-muted transition-opacity active:opacity-70 disabled:opacity-60"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background">
                    <Camera className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Add photo
                  </p>
                </button>
              )}
              {photoPending && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl">
                  <p className="text-sm text-muted-foreground">Processing…</p>
                </div>
              )}
            </div>
            {photoErrorCode && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {saveProductMessage(new SaveProductError(photoErrorCode))}
              </p>
            )}
            {photoSheetOpen && (
              <PhotoSourceSheet
                onClose={() => {
                  setPhotoSheetOpen(false);
                }}
                onFileSelected={handlePhotoFile}
              />
            )}
          </div>

          <div>
            <label htmlFor="product-name" className={fieldLabelClass}>
              Product name
            </label>
            <input
              id="product-name"
              type="text"
              autoFocus
              placeholder="e.g. Tomatoes, Handmade Wooden Lamp…"
              value={name}
              onChange={setValue(setName)}
              className={inputClass}
            />
          </div>

          <div>
            <div className="mb-2.5 flex items-baseline justify-between">
              <label className="text-sm font-medium text-foreground">
                Category
              </label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  selectExistingCategory("");
                }}
                className={`${chipClass} ${
                  selectedCategory === ""
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {selectedCategory === "" && (
                  <Check className="h-3 w-3 flex-shrink-0" />
                )}
                None
              </button>
              {categoryOptions.map((categoryName) => (
                <button
                  key={categoryName}
                  type="button"
                  onClick={() => {
                    selectExistingCategory(
                      selectedCategory === categoryName ? "" : categoryName,
                    );
                  }}
                  className={`${chipClass} ${
                    selectedCategory === categoryName
                      ? "bg-foreground text-background"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {selectedCategory === categoryName && (
                    <Check className="h-3 w-3 flex-shrink-0" />
                  )}
                  {categoryName}
                </button>
              ))}
              {selectedCategory &&
                !categoryOptions.includes(selectedCategory) &&
                !showNewCategoryInput && (
                  <span
                    className={`${chipClass} bg-foreground text-background`}
                  >
                    <Check className="h-3 w-3 flex-shrink-0" />
                    {selectedCategory}
                  </span>
                )}
              {showNewCategoryInput ? (
                <div className="mt-1 flex w-full items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Category name…"
                    value={newCategoryText}
                    onChange={setValue(setNewCategoryText)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmNewCategory();
                      if (e.key === "Escape") {
                        setShowNewCategoryInput(false);
                        setNewCategoryText("");
                      }
                    }}
                    className="h-12 flex-1 rounded-xl border border-border bg-muted px-3.5 text-sm text-foreground transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleConfirmNewCategory}
                    className="h-11 flex-shrink-0 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-transform active:scale-95"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewCategoryInput(false);
                      setNewCategoryText("");
                    }}
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-muted transition-transform active:scale-95"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCategoryInput(true);
                  }}
                  className="flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-border bg-muted px-3.5 text-sm font-medium text-muted-foreground transition-transform active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create new
                </button>
              )}
            </div>
          </div>

          <div>
            <label className={fieldLabelClass}>Selling unit</label>
            <div className="flex flex-wrap gap-2">
              {UNIT_OPTIONS.map((unitOption) => (
                <button
                  key={unitOption}
                  type="button"
                  onClick={() => {
                    setUnit(unitOption);
                  }}
                  className={`${chipClass} ${
                    unit === unitOption
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {unit === unitOption && (
                    <Check className="h-3 w-3 flex-shrink-0" />
                  )}
                  {unitOption}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-baseline justify-between">
              <label
                htmlFor="product-price"
                className="text-sm font-medium text-foreground"
              >
                Price
              </label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-muted-foreground">
                ₹
              </span>
              <input
                id="product-price"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={priceText}
                onChange={(e) => {
                  setPriceText(sanitizePriceInput(e.target.value));
                }}
                className="h-12 w-full rounded-xl border border-border bg-muted pr-4 pl-8 text-foreground transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-foreground">
                Available today
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {available
                  ? "Will show as available to customers"
                  : "Will be hidden from customers"}
              </p>
            </div>
            <Toggle
              checked={available}
              onChange={() => {
                setAvailable((v) => !v);
              }}
            />
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-border bg-background px-5 pt-4 pb-8">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`h-14 w-full rounded-2xl text-base font-semibold transition-all ${
              isValid
                ? "bg-foreground text-background active:scale-[0.98]"
                : "cursor-not-allowed bg-foreground/15 text-foreground/35"
            }`}
          >
            {saveProduct.isPending ? "Saving…" : "Save product"}
          </button>
          {saveProduct.isError && (
            <p
              role="alert"
              className="mt-3 text-center text-sm text-destructive"
            >
              {saveProductMessage(saveProduct.error)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
