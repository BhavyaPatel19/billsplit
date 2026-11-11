"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Link2, UserPlus, UserRoundX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  CreateParticipantBodySchema,
  InviteSchema,
  ParticipantSchema,
  type CreateParticipantBody,
  type GroupDetail,
  type Participant,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { api, ApiClientError } from "@/lib/api-client";

export function MembersPanel({ group }: { group: GroupDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateParticipantBody>({ resolver: zodResolver(CreateParticipantBodySchema) });

  const addPlaceholder = handleSubmit(async (values) => {
    setError(null);
    try {
      await api(`/groups/${group.id}/participants`, ParticipantSchema, { body: values });
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add that person");
    }
  });

  const inviteFor = async (p: Participant) => {
    setBusyId(p.id);
    setError(null);
    try {
      const invite = await api(`/groups/${group.id}/invites`, InviteSchema, {
        body: { participantId: p.id, maxUses: 1, expiresInDays: 14 },
      });
      await navigator.clipboard.writeText(invite.url).catch(() => undefined);
      setNotice(
        `Personal link for ${p.displayName} copied. When they join with it, their history is theirs.`,
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create the link");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: Participant) => {
    setBusyId(p.id);
    setError(null);
    try {
      await api(`/groups/${group.id}/participants/${p.id}`, ParticipantSchema.optional(), {
        method: "DELETE",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not remove that person");
    } finally {
      setBusyId(null);
    }
  };

  const isOwner = group.myRole === "owner";

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-medium">People</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        {group.participants.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {p.displayName}
                {p.isMe ? <span className="text-zinc-500"> (you)</span> : null}
              </p>
              <p className="text-xs text-zinc-500">
                {p.role === "owner" ? "Owner" : p.isPlaceholder ? "No account yet" : "Member"}
              </p>
            </div>
            {p.isPlaceholder ? (
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busyId === p.id}
                  onClick={() => inviteFor(p)}
                  aria-label={`Copy a personal invite link for ${p.displayName}`}
                  title="Copy a personal invite link"
                >
                  <Link2 className="size-4" aria-hidden />
                </Button>
                {isOwner ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === p.id}
                    onClick={() => remove(p)}
                    aria-label={`Remove ${p.displayName}`}
                    title="Remove"
                  >
                    <UserRoundX className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={addPlaceholder} noValidate className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="Add someone without an account"
            placeholder="Rahul"
            error={errors.displayName?.message}
            {...register("displayName")}
          />
        </div>
        <Button type="submit" variant="secondary" loading={isSubmitting} aria-label="Add person">
          <UserPlus className="size-4" aria-hidden />
        </Button>
      </form>
      <p className="text-xs text-zinc-500">
        They can be part of every split now. Send them a personal link later and the history becomes
        theirs.
      </p>
    </Card>
  );
}
