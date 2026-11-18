import type { BalancesResponse, ExpenseSummary, Report } from "@billsplit/contracts";
import { cents, formatCents } from "@billsplit/split-engine";

export interface ReportPayment {
  id: string;
  on: string;
  fromId: string;
  toId: string;
  amountCents: number;
  note: string | null;
}

/**
 * The move-out report: everything in the period, per-person totals for it, and today's
 * balances with the settle-up plan. Inputs are already resolved (merged placeholders mapped to
 * their accounts) and filtered to the period.
 */
export function buildReport(args: {
  groupName: string;
  currency: string;
  from: string | null;
  to: string | null;
  people: readonly { id: string; name: string }[];
  expenses: readonly ExpenseSummary[];
  payments: readonly ReportPayment[];
  balances: BalancesResponse;
  now?: Date;
}): Report {
  const tally = new Map(args.people.map((p) => [p.id, { paid: 0, owed: 0, sent: 0, received: 0 }]));
  const row = (id: string) => {
    let t = tally.get(id);
    if (!t) {
      t = { paid: 0, owed: 0, sent: 0, received: 0 };
      tally.set(id, t);
    }
    return t;
  };
  for (const e of args.expenses) {
    for (const s of e.shares) {
      row(s.participantId).paid += s.paidCents;
      row(s.participantId).owed += s.owedCents;
    }
  }
  for (const p of args.payments) {
    row(p.fromId).sent += p.amountCents;
    row(p.toId).received += p.amountCents;
  }
  const nameOf = new Map(args.people.map((p) => [p.id, p.name]));
  const balanceOf = new Map(args.balances.balances.map((b) => [b.participantId, b.netCents]));

  const expenses = [...args.expenses].sort((a, b) =>
    a.spentOn === b.spentOn
      ? a.createdAt.localeCompare(b.createdAt)
      : a.spentOn < b.spentOn
        ? -1
        : 1,
  );
  return {
    groupName: args.groupName,
    currency: args.currency,
    from: args.from,
    to: args.to,
    generatedAt: (args.now ?? new Date()).toISOString(),
    people: [...tally].map(([participantId, t]) => ({
      participantId,
      name: nameOf.get(participantId) ?? "Former member",
      paidCents: t.paid,
      owedCents: t.owed,
      sentCents: t.sent,
      receivedCents: t.received,
      periodNetCents: t.paid - t.owed + t.sent - t.received,
      balanceCents: balanceOf.get(participantId) ?? 0,
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      spentOn: e.spentOn,
      description: e.description,
      payerId: e.payerId,
      totalCents: e.totalCents,
      shares: Object.fromEntries(e.shares.map((s) => [s.participantId, s.owedCents])),
    })),
    payments: [...args.payments].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0)),
    settleUp: args.balances.transfers,
    totals: {
      expensesCents: args.expenses.reduce((n, e) => n + e.totalCents, 0),
      paymentsCents: args.payments.reduce((n, p) => n + p.amountCents, 0),
    },
  };
}

/**
 * One CSV cell. Quotes when needed, and defuses values a spreadsheet would run as a formula
 * (a description like "=HYPERLINK(...)") by prefixing an apostrophe.
 */
export function csvCell(value: string | number): string {
  let s = String(value);
  // Plain numbers ("-515.00") are safe and must stay numbers.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))
    s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain decimal money for spreadsheets ("1234.50"), no currency symbol or separators. */
const amount = (c: number, currency: string) =>
  formatCents(cents(c), currency, "en-US").replace(/[^\d.-]/g, "");

/** The report as CSV: expenses with a column per person, payments, totals, settle-up. */
export function reportCsv(r: Report): string {
  const name = (id: string) =>
    r.people.find((p) => p.participantId === id)?.name ?? "Former member";
  const m = (c: number) => amount(c, r.currency);
  const rows: (string | number)[][] = [
    [`${r.groupName} move-out report`],
    [`Period`, r.from ?? "start", r.to ?? "today", `Currency`, r.currency],
    [],
    ["Expenses"],
    ["Date", "Description", "Paid by", "Total", ...r.people.map((p) => `${p.name} share`)],
    ...r.expenses.map((e) => [
      e.spentOn,
      e.description,
      name(e.payerId),
      m(e.totalCents),
      ...r.people.map((p) => m(e.shares[p.participantId] ?? 0)),
    ]),
    [],
    ["Payments"],
    ["Date", "From", "To", "Amount", "Note"],
    ...r.payments.map((p) => [p.on, name(p.fromId), name(p.toId), m(p.amountCents), p.note ?? ""]),
    [],
    ["Per person"],
    [
      "Name",
      "Paid",
      "Share",
      "Payments sent",
      "Payments received",
      "Net in period",
      "Balance today",
    ],
    ...r.people.map((p) => [
      p.name,
      m(p.paidCents),
      m(p.owedCents),
      m(p.sentCents),
      m(p.receivedCents),
      m(p.periodNetCents),
      m(p.balanceCents),
    ]),
    [],
    ["Settle up"],
    ["From", "To", "Amount"],
    ...r.settleUp.map((t) => [name(t.fromId), name(t.toId), m(t.amountCents)]),
  ];
  return rows.map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
