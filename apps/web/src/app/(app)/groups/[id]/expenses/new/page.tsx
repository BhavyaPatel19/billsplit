import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupDetailSchema, ReceiptSchema } from "@billsplit/contracts";
import { serverApi } from "@/lib/server-api";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "Add expense · BillSplit" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receiptId?: string }>;
}) {
  const { id } = await params;
  const { receiptId } = await searchParams;
  const [group, initialReceipt] = await Promise.all([
    serverApi(`/groups/${id}`, GroupDetailSchema),
    receiptId && UUID_RE.test(receiptId)
      ? serverApi(`/groups/${id}/receipts/${receiptId}`, ReceiptSchema)
      : Promise.resolve(null),
  ]);
  if (!group) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/groups/${group.id}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden /> {group.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        {initialReceipt?.ocr ? "Split scanned receipt" : "Add an expense"}
      </h1>
      <ExpenseForm group={group} initialReceipt={initialReceipt} />
    </div>
  );
}
