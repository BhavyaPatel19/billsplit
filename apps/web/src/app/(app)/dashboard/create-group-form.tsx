"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  CreateGroupBodySchema,
  GroupDetailSchema,
  type CreateGroupBody,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { api, ApiClientError } from "@/lib/api-client";

export function CreateGroupForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof CreateGroupBodySchema>, unknown, CreateGroupBody>({
    resolver: zodResolver(CreateGroupBodySchema),
    defaultValues: { currency: "USD" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const group = await api("/groups", GroupDetailSchema, { body: values });
      reset();
      setOpen(false);
      router.push(`/groups/${group.id}`);
      router.refresh();
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : "Could not create the group");
    }
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New group
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex w-full flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:w-auto sm:min-w-80 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {serverError ? <Alert tone="error">{serverError}</Alert> : null}
      <Field
        label="Group name"
        placeholder="Flat 4B"
        autoFocus
        error={errors.name?.message}
        {...register("name")}
      />
      <Field
        label="Currency"
        placeholder="USD"
        maxLength={3}
        className="uppercase"
        error={errors.currency?.message}
        {...register("currency", { setValueAs: (v: string) => v.toUpperCase() })}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Create
        </Button>
      </div>
    </form>
  );
}
