import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            BillSplit
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <span className="hidden text-zinc-600 sm:inline dark:text-zinc-400">
              {session.user.name}
            </span>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
