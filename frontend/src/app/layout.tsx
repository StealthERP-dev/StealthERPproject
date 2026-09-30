import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Store",
  // Gives iOS the home-screen label (D-02's short name "My Shop", not the
  // browser-tab title above) and the web-app-capable tag. Next 16.3.5 emits
  // the standardised `mobile-web-app-capable` meta from `capable: true`
  // (metadata.js:602-613) — it does not infer any of this from the manifest
  // file convention.
  appleWebApp: {
    capable: true,
    title: "My Shop",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F9F8F5",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={figtree.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
