import Link from "next/link";
import type { Metadata } from "next";
import { ClaimPageSchema } from "@billsplit/contracts";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { serverApiUrl } from "@/lib/api";
import { ClaimBoard } from "./claim-board";

// The token in the URL is the only credential, so keep it out of search indexes and referrers.
export const metadata: Metadata = {
  title: "Claim your items · BillSplit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const PROBLEMS: Record<number, { title: string; body: string }> = {
  409: {
    title: "This receipt is not ready yet",
    body: "It is still being read. Try again in a moment.",
  },
  410: {
    title: "This link no longer works",
    body: "It expired or was turned off. Ask whoever sent it for a new one.",
  },
};
const NOT_FOUND = {
  title: "Link not found",
  body: "Check the link, or ask whoever sent it for a new one.",
};

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${serverApiUrl()}/api/claim-links/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  const page = res.ok ? ClaimPageSchema.parse(await res.json()) : null;
  const problem = page ? null : (PROBLEMS[res.status] ?? NOT_FOUND);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-8">
      <Link href="/" className="self-center text-2xl font-semibold tracking-tight">
        BillSplit
      </Link>
      {page ? (
        <ClaimBoard token={token} initial={page} />
      ) : (
        <Card className="flex flex-col gap-2">
          <CardTitle>{problem!.title}</CardTitle>
          <CardDescription>{problem!.body}</CardDescription>
        </Card>
      )}
    </main>
  );
}
