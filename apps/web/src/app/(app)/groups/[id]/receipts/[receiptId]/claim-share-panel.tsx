"use client";

import { Check, Copy, Link2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ClaimLinkSchema,
  ReceiptClaimsResponseSchema,
  type ClaimLink,
  type GroupDetail,
  type ReceiptClaim,
} from "@billsplit/contracts";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * Lets the host share a link so friends can tap what they had, and shows the claims arriving
 * live. The claims feed the split on the next page.
 */
export function ClaimSharePanel({
  group,
  receiptId,
  itemCount,
  initialLink,
  initialClaims,
}: {
  group: GroupDetail;
  receiptId: string;
  itemCount: number;
  initialLink: ClaimLink | null;
  initialClaims: ReceiptClaim[];
}) {
  const base = `/groups/${group.id}/receipts/${receiptId}`;
  const [link, setLink] = useState(initialLink);
  const [claims, setClaims] = useState(initialClaims);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Claims arrive over server-sent events; the browser reconnects by itself if the stream drops.
  useEffect(() => {
    const source = new EventSource(`/api${base}/claims/stream`);
    source.addEventListener("claims", (event) => {
      try {
        const parsed = ReceiptClaimsResponseSchema.safeParse(JSON.parse(event.data as string));
        if (parsed.success) setClaims(parsed.data.claims);
      } catch {
        // A malformed event is skipped; the next one carries the full list again.
      }
    });
    return () => source.close();
  }, [base]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const claimedLines = new Set(claims.map((c) => c.itemIndex)).size;
  const perPerson = group.participants
    .map((p) => ({
      id: p.id,
      name: p.isMe ? "You" : p.displayName,
      lines: claims.filter((c) => c.participantId === p.id).length,
    }))
    .filter((p) => p.lines > 0);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
        <h2 className="text-sm font-semibold">Let friends claim their items</h2>
      </div>

      {link ? (
        <>
          <div className="flex gap-2">
            <input
              readOnly
              aria-label="Claim link"
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-9 px-3 text-xs"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
              }
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Anyone with the link can tap items, no account needed. It works until{" "}
            {new Date(link.expiresAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .{" "}
            <button
              type="button"
              disabled={busy}
              className="font-medium text-red-700 underline underline-offset-2 disabled:opacity-60 dark:text-red-400"
              onClick={() =>
                void run(async () => {
                  await api(`${base}/claim-link`, z.unknown(), { method: "DELETE" });
                  setLink(null);
                })
              }
            >
              Turn off link
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="text-xs text-zinc-500">
            Share a link and everyone taps what they had on their own phone. You still review the
            split before it is saved.
          </p>
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                setLink(await api(`${base}/claim-link`, ClaimLinkSchema, { body: {} }));
              })
            }
          >
            <Link2 className="size-4" aria-hidden /> Get a link to share
          </Button>
        </>
      )}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div
        aria-live="polite"
        className="flex flex-col gap-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      >
        <p className="text-sm font-medium tabular-nums">
          {claimedLines} of {itemCount} {itemCount === 1 ? "line" : "lines"} claimed
        </p>
        {perPerson.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {perPerson.map((p) => (
              <li
                key={p.id}
                className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                {p.name} · {p.lines}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">Nobody has tapped anything yet.</p>
        )}
        <p className="text-xs text-zinc-500">Changing the line items clears what people claimed.</p>
      </div>
    </Card>
  );
}
