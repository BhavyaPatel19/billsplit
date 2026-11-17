import type { Metadata } from "next";
import Link from "next/link";
import { UnsubscribeStatusSchema } from "@billsplit/contracts";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { serverApiUrl } from "@/lib/api";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = {
  title: "Unsubscribe · BillSplit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Looking only: mail scanners open links, so nothing changes until the button is pressed.
  const res = await fetch(`${serverApiUrl()}/api/unsubscribe/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  const status = res.ok ? UnsubscribeStatusSchema.parse(await res.json()) : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="self-center text-2xl font-semibold tracking-tight">
        BillSplit
      </Link>
      <Card className="flex flex-col gap-4">
        {status ? (
          <UnsubscribeButton token={token} initial={status} />
        ) : (
          <>
            <CardTitle>Link not found</CardTitle>
            <CardDescription>
              Sign in and change your emails under Settings instead.
            </CardDescription>
          </>
        )}
      </Card>
    </main>
  );
}
