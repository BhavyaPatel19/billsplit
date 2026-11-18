import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportSchema } from "@billsplit/contracts";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/money";
import { serverApi } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const metadata = { title: "Move-out report · BillSplit" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { from, to } = await searchParams;
  const query = new URLSearchParams();
  if (from && DATE_RE.test(from)) query.set("from", from);
  if (to && DATE_RE.test(to)) query.set("to", to);
  const qs = query.size ? `?${query}` : "";
  const report = await serverApi(`/groups/${id}/report${qs}`, ReportSchema);
  if (!report) notFound();

  const fmt = (c: number) => money(c, report.currency);
  const name = (pid: string) =>
    report.people.find((p) => p.participantId === pid)?.name ?? "Former member";
  const signed = (c: number) =>
    cn(
      "font-mono tabular-nums",
      c > 0 && "text-emerald-700 dark:text-emerald-400",
      c < 0 && "text-red-600 dark:text-red-400",
    );
  const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
  const td = "px-3 py-2";

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <Link
        href={`/groups/${id}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline print:hidden dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden /> {report.groupName}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {report.groupName}: move-out report
        </h1>
        <p className="text-sm text-zinc-500">
          {report.from || report.to
            ? `${report.from ?? "The start"} to ${report.to ?? "today"}`
            : "Whole history"}{" "}
          · made {report.generatedAt.slice(0, 10)}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 print:hidden" method="get">
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          From (lease start)
          <input
            type="date"
            name="from"
            defaultValue={report.from ?? ""}
            className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          To (move-out)
          <input
            type="date"
            name="to"
            defaultValue={report.to ?? ""}
            className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Update
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <a
            href={`/api/groups/${id}/report.csv${qs}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <Download className="size-4" aria-hidden /> CSV
          </a>
          <PrintButton />
        </div>
      </form>

      <Card className="flex flex-col gap-3 print:border-0 print:p-0 print:shadow-none">
        <h2 className="font-medium">Final balances</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className={th}>Person</th>
                <th className={cn(th, "text-right")}>Paid</th>
                <th className={cn(th, "text-right")}>Share</th>
                <th className={cn(th, "text-right")}>Sent</th>
                <th className={cn(th, "text-right")}>Received</th>
                <th className={cn(th, "text-right")}>Balance today</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((p) => (
                <tr
                  key={p.participantId}
                  className="border-b border-zinc-100 dark:border-zinc-800/60"
                >
                  <td className={td}>{p.name}</td>
                  <td className={cn(td, "text-right font-mono tabular-nums")}>
                    {fmt(p.paidCents)}
                  </td>
                  <td className={cn(td, "text-right font-mono tabular-nums")}>
                    {fmt(p.owedCents)}
                  </td>
                  <td className={cn(td, "text-right font-mono tabular-nums")}>
                    {fmt(p.sentCents)}
                  </td>
                  <td className={cn(td, "text-right font-mono tabular-nums")}>
                    {fmt(p.receivedCents)}
                  </td>
                  <td className={cn(td, "text-right", signed(p.balanceCents))}>
                    {p.balanceCents > 0 ? "gets back " : p.balanceCents < 0 ? "owes " : ""}
                    {fmt(Math.abs(p.balanceCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">
          Paid, share, sent and received cover the period above. The balance is today&apos;s, across
          all time, which is what settling up is based on.
        </p>
        {report.settleUp.length > 0 ? (
          <div className="text-sm">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              To settle up
            </h3>
            <ul className="flex flex-col gap-0.5">
              {report.settleUp.map((t) => (
                <li key={`${t.fromId}-${t.toId}`}>
                  {name(t.fromId)} pays {name(t.toId)}{" "}
                  <span className="font-mono font-medium tabular-nums">{fmt(t.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Everyone is settled up.</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 print:border-0 print:p-0 print:shadow-none">
        <h2 className="font-medium">
          Expenses ({report.expenses.length}, {fmt(report.totals.expensesCents)})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className={th}>Date</th>
                <th className={th}>What</th>
                <th className={th}>Paid by</th>
                <th className={cn(th, "text-right")}>Total</th>
                {report.people.map((p) => (
                  <th key={p.participantId} className={cn(th, "text-right")}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.expenses.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                  <td className={cn(td, "whitespace-nowrap")}>{e.spentOn}</td>
                  <td className={td}>{e.description}</td>
                  <td className={td}>{name(e.payerId)}</td>
                  <td className={cn(td, "text-right font-mono tabular-nums")}>
                    {fmt(e.totalCents)}
                  </td>
                  {report.people.map((p) => (
                    <td
                      key={p.participantId}
                      className={cn(
                        td,
                        "text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400",
                      )}
                    >
                      {e.shares[p.participantId] ? fmt(e.shares[p.participantId]!) : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 print:border-0 print:p-0 print:shadow-none">
        <h2 className="font-medium">
          Payments ({report.payments.length}, {fmt(report.totals.paymentsCents)})
        </h2>
        {report.payments.length === 0 ? (
          <p className="text-sm text-zinc-500">No payments in this period.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {report.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {p.on} · {name(p.fromId)} paid {name(p.toId)}
                  {p.note ? <span className="text-zinc-500"> · {p.note}</span> : null}
                </span>
                <span className="font-mono tabular-nums">{fmt(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
