"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SettlementSchema, type BalancesResponse, type GroupDetail } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

export function BalancesPanel({
  group,
  balances,
}: {
  group: GroupDetail;
  balances: BalancesResponse;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (pid: string) => {
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "You" : p.displayName) : "Someone";
  };
  const fmt = (n: number) => money(n, balances.currency);

  const record = async (fromId: string, toId: string, amountCents: number) => {
    const key = `${fromId}-${toId}-${amountCents}`;
    setBusy(key);
    setError(null);
    try {
      await api(`/groups/${group.id}/settlements`, SettlementSchema, {
        body: { fromId, toId, amountCents },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not record the payment");
    } finally {
      setBusy(null);
    }
  };

  const settled = balances.transfers.length === 0;

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-medium">Balances</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="flex flex-col gap-1.5 text-sm">
        {balances.balances.map((b) => (
          <li key={b.participantId} className="flex justify-between gap-3">
            <span>{name(b.participantId)}</span>
            <span
              className={cn(
                "font-mono tabular-nums",
                b.netCents > 0 && "text-emerald-700 dark:text-emerald-400",
                b.netCents < 0 && "text-red-600 dark:text-red-400",
              )}
            >
              {b.netCents > 0 ? "gets back " : b.netCents < 0 ? "owes " : ""}
              {fmt(Math.abs(b.netCents))}
            </span>
          </li>
        ))}
      </ul>

      {settled ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden /> Everyone is settled up.
        </p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Settle up in {balances.transfers.length}{" "}
            {balances.transfers.length === 1 ? "payment" : "payments"}
          </h3>
          <ul className="flex flex-col gap-2">
            {balances.transfers.map((t) => {
              const key = `${t.fromId}-${t.toId}-${t.amountCents}`;
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    {name(t.fromId)} <ArrowRight className="size-3.5 text-zinc-400" aria-hidden />{" "}
                    {name(t.toId)}
                    <span className="font-mono font-medium tabular-nums">{fmt(t.amountCents)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === key}
                    onClick={() => record(t.fromId, t.toId, t.amountCents)}
                  >
                    Mark as paid
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-zinc-500">
            Pay however you like (Venmo, Zelle, cash), then mark it here.
          </p>
        </div>
      )}
    </Card>
  );
}
