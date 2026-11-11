import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ResendButton } from "./resend-button";

export const metadata = { title: "Verify your email · BillSplit" };

const ERRORS: Record<string, string> = {
  invalid_token: "That link is invalid or has already been used.",
  token_expired: "That link has expired. Request a new one below.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email, error } = await searchParams;
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>Check your inbox</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We sent a verification link to <span className="font-medium">{email}</span>. It is
              valid for 24 hours.
            </>
          ) : (
            "We sent you a verification link. It is valid for 24 hours."
          )}
        </CardDescription>
      </div>
      {error ? <Alert tone="error">{ERRORS[error] ?? "Verification failed."}</Alert> : null}
      {email ? <ResendButton email={email} /> : null}
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Verified already?{" "}
        <Link
          href="/login"
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Sign in
        </Link>
      </p>
    </Card>
  );
}
