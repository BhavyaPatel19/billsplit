"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { GoogleButton } from "@/components/google-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const LoginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type LoginValues = z.infer<typeof LoginSchema>;

export function LoginForm({
  googleEnabled,
  next,
  justReset,
}: {
  googleEnabled: boolean;
  next: string;
  justReset: boolean;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(LoginSchema) });

  // Only allow same-site redirects.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setUnverified(null);
    const { error } = await authClient.signIn.email({ ...values, callbackURL: safeNext });
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(values.email);
      } else {
        setServerError("Wrong email or password");
      }
      return;
    }
    router.push(safeNext);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {justReset ? <Alert tone="success">Password updated. Sign in with the new one.</Alert> : null}
      {serverError ? <Alert tone="error">{serverError}</Alert> : null}
      {unverified ? (
        <Alert tone="info" title="Verify your email first">
          We sent a link to {unverified}.{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() =>
              authClient.sendVerificationEmail({ email: unverified, callbackURL: "/dashboard" })
            }
          >
            Send it again
          </button>
        </Alert>
      ) : null}
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <div className="-mt-2 text-right">
        <Link
          href="/forgot-password"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          Forgot password?
        </Link>
      </div>
      <Button type="submit" loading={isSubmitting} className="w-full">
        Sign in
      </Button>
      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <GoogleButton callbackURL={safeNext} />
        </>
      ) : null}
    </form>
  );
}
