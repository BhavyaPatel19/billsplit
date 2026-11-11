import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchApiHealth } from "@/lib/api";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const features = [
  ["Photograph the receipt", "Items, tax and tip are read for you. Fix anything in a tap."],
  ["Tap who had what", "Split a dish three ways, or give someone 10% for the bite they stole."],
  ["Fair tax and tip", "Spread in proportion to what each person actually ordered."],
  [
    "Friends without accounts",
    "Add a placeholder now; it merges into their account when they join.",
  ],
] as const;

export default async function HomePage() {
  const [health, session] = await Promise.all([fetchApiHealth(), getServerSession()]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-12">
      <header className="flex items-center justify-between">
        <span className="text-xl font-semibold tracking-tight">BillSplit</span>
        <nav className="flex items-center gap-2">
          {session ? (
            <Link href="/dashboard">
              <Button size="sm">Open app</Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button size="sm" variant="ghost">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mt-20 flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Split the bill in a minute, not an argument.
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Snap the receipt, tap who had what, settle up. Built for roommates, trips and group
          dinners.
        </p>
        <div className="mt-2 flex gap-3">
          <Link href={session ? "/dashboard" : "/signup"}>
            <Button size="lg">{session ? "Open app" : "Create a free account"}</Button>
          </Link>
        </div>
      </section>

      <section className="mt-20 grid gap-6 sm:grid-cols-2">
        {features.map(([title, body]) => (
          <div key={title} className="flex flex-col gap-1">
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-20 text-xs text-zinc-400">
        {health.ok ? `api ${health.data.version}` : `api unreachable: ${health.error}`}
      </footer>
    </main>
  );
}
