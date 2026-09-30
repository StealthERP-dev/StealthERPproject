"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, Package } from "lucide-react";
import type { ReactNode } from "react";

export const VENDOR_NAV_ITEMS = [
  { id: "home", label: "Home", href: "/" },
  { id: "products", label: "Products", href: "/manage" },
  { id: "orders", label: "Orders", href: "/orders" },
] as const;

type VendorNavItemId = (typeof VENDOR_NAV_ITEMS)[number]["id"];

const NAV_ICONS: Record<VendorNavItemId, ReactNode> = {
  home: <Home className="h-[22px] w-[22px]" strokeWidth={1.75} />,
  products: <Package className="h-[22px] w-[22px]" strokeWidth={1.75} />,
  orders: <ClipboardList className="h-[22px] w-[22px]" strokeWidth={1.75} />,
};

/** Rendered height of the nav bar (excludes the safe-area inset), used by the
 * (vendor) layout to reserve matching bottom padding so content is never hidden. */
export const BOTTOM_NAV_HEIGHT_PX = 72;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ newOrderCount = 0 }: { newOrderCount?: number }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 mx-auto max-w-[390px] border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
      <div className="flex">
        {VENDOR_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-3.5 transition-colors ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {NAV_ICONS[item.id]}
              <span className="text-[10px] font-semibold tracking-wide">
                {item.label}
              </span>
              {item.id === "orders" && newOrderCount > 0 && (
                <span className="absolute top-2.5 left-[calc(50%+9px)] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#D97706] text-[9px] font-bold text-white">
                  {newOrderCount}
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-t-full bg-foreground" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
