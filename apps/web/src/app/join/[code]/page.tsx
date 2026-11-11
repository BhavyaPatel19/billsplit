import Link from "next/link";
import { InvitePreviewSchema } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { serverApiUrl } from "@/lib/api";
import { getServerSession } from "@/lib/session";
import { AcceptButton } from "./accept-button";

export const metadata = { title: "Join a group · BillSplit" };

const STATUS_COPY: Record<string, string> = {
  expired: "This invite has expired. Ask for a new link.",
  revoked: "This invite was revoked by the group owner.",
  exhausted: "This invite has already been used the maximum number of times.",
  claimed: "This personal invite has already been claimed.",
};

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [session, res] = await Promise.all([
    getServerSession(),
    fetch(`${serverApiUrl()}/api/invites/${encodeURIComponent(code)}`, { cache: "no-store" }),
  ]);
  const preview = res.ok ? InvitePreviewSchema.parse(await res.json()) : null;
  const returnTo = `/join/${encodeURIComponent(code)}`;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="self-center text-2xl font-semibold tracking-tight">
        BillSplit
      </Link>
      <Card className="flex flex-col gap-6">
        {!preview ? (
          <>
            <CardTitle>Invite not found</CardTitle>
            <CardDescription>Check the link, or ask whoever sent it for a new one.</CardDescription>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <CardTitle>Join {preview.groupName}</CardTitle>
              <CardDescription>
                {preview.memberCount} {preview.memberCount === 1 ? "person is" : "people are"}{" "}
                already splitting bills here.
                {preview.placeholderName ? (
                  <>
                    {" "}
                    You will take over{" "}
                    <span className="font-medium">{preview.placeholderName}</span>, so everything
                    already split with that name becomes yours.
                  </>
                ) : null}
              </CardDescription>
            </div>
            {preview.status !== "valid" ? (
              <Alert tone="error">
                {STATUS_COPY[preview.status] ?? "This invite cannot be used."}
              </Alert>
            ) : session ? (
              <AcceptButton code={code} />
            ) : (
              <div className="flex flex-col gap-2">
                <Link href={`/signup?next=${encodeURIComponent(returnTo)}`}>
                  <Button className="w-full">Create an account to join</Button>
                </Link>
                <Link href={`/login?next=${encodeURIComponent(returnTo)}`}>
                  <Button variant="secondary" className="w-full">
                    I already have one
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
