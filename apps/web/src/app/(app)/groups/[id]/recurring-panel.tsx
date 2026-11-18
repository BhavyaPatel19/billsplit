"use client";

import { CalendarClock, Pause, Play, Plus, SkipForward, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  RecurringExpenseSchema,
  type GroupDetail,
  type RecurringExpense,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";
import { money } from "@/lib/money";
import { describeCadence, formatDate } from "@/lib/recurring";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<RecurringExpense["status"], string> = {
  active: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  paused: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  ended: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

type Action = "pause" | "resume" | "skip" | "stop";

export function RecurringPanel({
  group,
  initial,
}: {
  group: GroupDetail;
  initial: RecurringExpense[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meId = group.myParticipantId;
  const isOwner = group.participants.some((p) => p.isMe && p.role === "owner");
  const name = (pid: string | null) => {
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "you" : p.displayName) : "a former member";
  };

  const run = async (r: RecurringExpense, action: Action) => {
    setBusy(`${r.id}:${action}`);
    setError(null);
    const path = `/groups/${group.id}/recurring/${r.id}`;
    try {
      if (action === "stop") {
        await api(path, RecurringExpenseSchema, { method: "DELETE" });
        setItems((list) => list.filter((x) => x.id !== r.id));
        setConfirmStop(null);
      } else {
        const updated =
          action === "skip"
            ? await api(`${path}/skip`, RecurringExpenseSchema, { body: {} })
            : await api(path, RecurringExpenseSchema, {
                method: "PATCH",
                body: { paused: action === "pause" },
              });
        setItems((list) => list.map((x) => (x.id === r.id ? updated : x)));
      }
      // Resuming can post today's bill, which changes expenses and balances.
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not update it");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="recurring" className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Recurring</h2>
        <Link
          href={`/groups/${group.id}/expenses/new`}
          className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          <Plus className="size-4" aria-hidden /> Add a repeating bill
        </Link>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {items.length === 0 ? (
        <Card className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <CalendarClock className="size-5 shrink-0 text-zinc-400" aria-hidden />
          Rent, Wi-Fi or utilities? Add an expense and pick a Repeat option, and it posts itself.
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {items.map((r) => {
            const canManage = isOwner || r.createdById === meId;
            const isBusy = (a: Action) => busy === `${r.id}:${a}`;
            return (
              <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{r.description}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                          STATUS_STYLE[r.status],
                        )}
                      >
                        {r.status}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {money(r.totalCents, r.currency)} · {describeCadence(r)}
                      {r.endOn ? ` until ${formatDate(r.endOn)}` : ""}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {r.nextOn && r.status === "active"
                        ? `Next: ${formatDate(r.nextOn)}`
                        : r.status === "ended"
                          ? "No more postings"
                          : "Not posting while paused"}
                      {` · posted ${r.postedCount}× · set up by ${name(r.createdById)}`}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {r.status === "active" ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={isBusy("skip")}
                            onClick={() => run(r, "skip")}
                            title="Skip the next posting"
                          >
                            <SkipForward className="size-4" aria-hidden /> Skip next
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={isBusy("pause")}
                            onClick={() => run(r, "pause")}
                          >
                            <Pause className="size-4" aria-hidden /> Pause
                          </Button>
                        </>
                      ) : null}
                      {r.status === "paused" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={isBusy("resume")}
                          onClick={() => run(r, "resume")}
                        >
                          <Play className="size-4" aria-hidden /> Resume
                        </Button>
                      ) : null}
                      {confirmStop === r.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={isBusy("stop")}
                            onClick={() => run(r, "stop")}
                          >
                            Stop for good
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmStop(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmStop(r.id)}>
                          <Square className="size-4" aria-hidden /> Stop
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
                {r.status === "paused" && r.pausedReason ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Paused automatically: {r.pausedReason}. Stop it and add it again with the people
                    in the group now.
                  </p>
                ) : null}
                {confirmStop === r.id ? (
                  <p className="text-xs text-zinc-500">
                    Expenses it already posted stay in the group.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
