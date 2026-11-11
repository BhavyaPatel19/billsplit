"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { GoogleButton } from "@/components/google-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Tell us what to call you").max(80),
  email: z.email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters").max(128),
});
type SignupValues = z.infer<typeof SignupSchema>;

export function SignupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({ resolver: zodResolver(SignupSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const { error } = await authClient.signUp.email({
      ...values,
      callbackURL: "/dashboard?verified=1",
    });
    if (error) {
      setServerError(error.message ?? "Could not create the account");
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {serverError ? <Alert tone="error">{serverError}</Alert> : null}
      <Field label="Name" autoComplete="name" error={errors.name?.message} {...register("name")} />
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
        autoComplete="new-password"
        hint="At least 10 characters. A few random words work well."
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Create account
      </Button>
      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <GoogleButton />
        </>
      ) : null}
    </form>
  );
}
