import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="self-center text-2xl font-semibold tracking-tight">
        BillSplit
      </Link>
      {children}
    </main>
  );
}
