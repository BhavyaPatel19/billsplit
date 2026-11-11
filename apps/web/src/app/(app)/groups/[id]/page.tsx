import { notFound } from "next/navigation";
import { GroupDetailSchema } from "@billsplit/contracts";
import { serverApi } from "@/lib/server-api";
import { GroupHeader } from "./group-header";
import { MembersPanel } from "./members-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await serverApi(`/groups/${id}`, GroupDetailSchema);
  return { title: group ? `${group.name} · BillSplit` : "Group · BillSplit" };
}

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await serverApi(`/groups/${id}`, GroupDetailSchema);
  if (!group) notFound();

  return (
    <div className="flex flex-col gap-8">
      <GroupHeader group={group} />
      <section className="grid gap-6 md:grid-cols-[1fr_minmax(0,2fr)]">
        <MembersPanel group={group} />
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          Expenses, receipts and balances for this group land in the next steps.
        </div>
      </section>
    </div>
  );
}
