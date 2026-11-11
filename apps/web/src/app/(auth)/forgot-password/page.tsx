"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const Schema = z.object({ email: z.email("Enter a valid email address") });
type Values = z.infer<typeof Schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    // Always report success so the form cannot be used to probe which emails exist.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
  });

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we will send a link that is valid for one hour.
        </CardDescription>
      </div>
      {sent ? (
        <Alert tone="success">
          If an account exists for that email, the reset link is on its way.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <Button type="submit" loading={isSubmitting} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        <Link
          href="/login"
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
