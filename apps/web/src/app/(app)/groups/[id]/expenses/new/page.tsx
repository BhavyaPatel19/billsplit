import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupDetailSchema } from "@billsplit/contracts";
import { serverApi } from "@/lib/server-api";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "Add expense · BillSplit" };

export default async function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await serverApi(`/groups/${id}`, GroupDetailSchema);
  if (!group) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/groups/${group.id}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden /> {group.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add an expense</h1>
      <ExpenseForm group={group} />
    </div>
  );
}
