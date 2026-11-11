import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { fetchMeta } from "@/lib/api";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · BillSplit" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const [{ next, reset }, meta] = await Promise.all([searchParams, fetchMeta()]);
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to see who owes whom.</CardDescription>
      </div>
      <LoginForm
        googleEnabled={meta.features.googleSignIn}
        next={next ?? "/dashboard"}
        justReset={reset === "1"}
      />
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        New here?{" "}
        <Link
          href="/signup"
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Create an account
        </Link>
      </p>
    </Card>
  );
}
