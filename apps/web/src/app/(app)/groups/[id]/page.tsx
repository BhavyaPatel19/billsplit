import { Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BalancesResponseSchema,
  ExpenseListResponseSchema,
  GroupDetailSchema,
} from "@billsplit/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/money";
import { serverApi } from "@/lib/server-api";
import { BalancesPanel } from "./balances-panel";
import { GroupHeader } from "./group-header";
import { MembersPanel } from "./members-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await serverApi(`/groups/${id}`, GroupDetailSchema);
  return { title: group ? `${group.name} · BillSplit` : "Group · BillSplit" };
}

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [group, list, balances] = await Promise.all([
    serverApi(`/groups/${id}`, GroupDetailSchema),
    serverApi(`/groups/${id}/expenses`, ExpenseListResponseSchema),
    serverApi(`/groups/${id}/balances`, BalancesResponseSchema),
  ]);
  if (!group || !list || !balances) notFound();

  const name = (pid: string) => {
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "You" : p.displayName) : "Former member";
  };
  const me = group.myParticipantId;

  return (
    <div className="flex flex-col gap-8">
      <GroupHeader group={group} />
      <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <BalancesPanel group={group} balances={balances} />
          <MembersPanel group={group} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Expenses</h2>
            <Link href={`/groups/${group.id}/expenses/new`}>
              <Button>
                <Plus className="size-4" aria-hidden /> Add expense
              </Button>
            </Link>
          </div>

          {list.expenses.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">
              <Receipt className="size-8 text-zinc-400" aria-hidden />
              No expenses yet. Add the first one.
            </Card>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {list.expenses.map((e) => {
                const mine = e.shares.find((s) => s.participantId === me);
                const myNet = mine ? mine.paidCents - mine.owedCents : 0;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/groups/${group.id}/expenses/${e.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.description}</p>
                        <p className="text-xs text-zinc-500">
                          {e.spentOn} · {name(e.payerId)} paid {money(e.totalCents, e.currency)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        {myNet > 0 ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            you lent {money(myNet, e.currency)}
                          </span>
                        ) : myNet < 0 ? (
                          <span className="text-red-600 dark:text-red-400">
                            you owe {money(-myNet, e.currency)}
                          </span>
                        ) : (
                          <span className="text-zinc-500">not involved</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
