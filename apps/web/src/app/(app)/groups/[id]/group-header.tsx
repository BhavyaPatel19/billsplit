"use client";

import { ArrowLeft, Link2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InviteSchema, type GroupDetail } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api-client";

export function GroupHeader({ group }: { group: GroupDetail }) {
  const router = useRouter();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"invite" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createInvite = async () => {
    setBusy("invite");
    setError(null);
    try {
      const invite = await api(`/groups/${group.id}/invites`, InviteSchema, { body: {} });
      setInviteUrl(invite.url);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create an invite link");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await api(`/groups/${group.id}`, InviteSchema.optional(), { method: "DELETE" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not delete the group");
      setBusy(null);
    }
  };

  return (
    <header className="flex flex-col gap-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden /> All groups
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {group.memberCount} {group.memberCount === 1 ? "person" : "people"} · {group.currency}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === "invite"} onClick={createInvite}>
            <Link2 className="size-4" aria-hidden /> Invite link
          </Button>
          {group.myRole === "owner" ? (
            confirmDelete ? (
              <>
                <Button variant="danger" loading={busy === "delete"} onClick={remove}>
                  Delete for everyone
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete group"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )
          ) : null}
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {inviteUrl ? (
        <Alert tone="success" title="Share this link (valid for 7 days)">
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white/60 px-2 py-1 text-xs dark:bg-black/30">
              {inviteUrl}
            </code>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Alert>
      ) : null}
    </header>
  );
}
