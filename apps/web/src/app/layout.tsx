import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BillSplit",
  description:
    "Split bills with friends and roommates. Photograph a receipt, tap who had what, settle up.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request makes every page render per request, which the CSP nonce needs: a
  // prerendered page would carry scripts without this request's nonce.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
