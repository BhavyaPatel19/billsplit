import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";

export const metadata = { title: "Choose a new password · BillSplit" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Every other session will be signed out.</CardDescription>
      </div>
      {!token || error ? (
        <>
          <Alert tone="error">This reset link is invalid or has expired.</Alert>
          <Link
            href="/forgot-password"
            className="text-center text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Request a new one
          </Link>
        </>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </Card>
  );
}
