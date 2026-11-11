"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const Schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type Values = z.infer<typeof Schema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setServerError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setServerError(error.message ?? "Could not reset the password");
      return;
    }
    router.push("/login?reset=1");
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {serverError ? <Alert tone="error">{serverError}</Alert> : null}
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register("confirm")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Update password
      </Button>
    </form>
  );
}
