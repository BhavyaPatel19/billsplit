import Link from "next/link";
import { Suspense } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { fetchMeta } from "@/lib/api";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account · BillSplit" };

export default async function SignupPage() {
  const meta = await fetchMeta();
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Free for you and your roommates. We only email you to verify it.
        </CardDescription>
      </div>
      <Suspense>
        <SignupForm googleEnabled={meta.features.googleSignIn} />
      </Suspense>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
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
