import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseDetailSchema, GroupDetailSchema } from "@billsplit/contracts";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/money";
import { serverApi } from "@/lib/server-api";
import { DeleteExpenseButton } from "./delete-button";

export const metadata = { title: "Expense · BillSplit" };

export default async function ExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  const [group, expense] = await Promise.all([
    serverApi(`/groups/${id}`, GroupDetailSchema),
    serverApi(`/groups/${id}/expenses/${expenseId}`, ExpenseDetailSchema),
  ]);
  if (!group || !expense) notFound();

  const name = (pid: string) => {
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "You" : p.displayName) : "Former member";
  };
  const fmt = (n: number) => money(n, expense.currency);
  const itemized = expense.items.length > 1 || expense.adjustments.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/groups/${group.id}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden /> {group.name}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{expense.description}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {fmt(expense.totalCents)} paid by {name(expense.payerId)} on {expense.spentOn}
            {expense.version > 1 ? ` · edited (version ${expense.version})` : ""}
          </p>
        </div>
        <DeleteExpenseButton groupId={group.id} expenseId={expense.id} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">Each person&apos;s share</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {expense.shares.map((s) => (
              <li key={s.participantId} className="flex justify-between gap-3">
                <span>{name(s.participantId)}</span>
                <span className="font-mono tabular-nums">{fmt(s.owedCents)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {itemized ? (
          <Card className="flex flex-col gap-3">
            <h2 className="font-medium">Items</h2>
            <ul className="flex flex-col gap-3 text-sm">
              {expense.items.map((item, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <div className="flex justify-between gap-3 font-medium">
                    <span>
                      {item.name}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                    </span>
                    <span className="font-mono tabular-nums">{fmt(item.totalCents)}</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {Object.entries(item.perParticipant)
                      .map(([pid, amount]) => `${name(pid)} ${fmt(amount)}`)
                      .join(" · ")}
                  </p>
                </li>
              ))}
              {expense.adjustments.map((a, i) => (
                <li key={`adj-${i}`} className="flex flex-col gap-0.5">
                  <div className="flex justify-between gap-3 capitalize">
                    <span>{a.kind}</span>
                    <span className="font-mono tabular-nums">
                      {a.kind === "discount" ? "−" : ""}
                      {fmt(a.amountCents)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {Object.entries(a.perParticipant)
                      .filter(([, amount]) => amount !== 0)
                      .map(([pid, amount]) => `${name(pid)} ${fmt(amount)}`)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
