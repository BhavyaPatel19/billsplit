import { Users } from "lucide-react";
import Link from "next/link";
import { GroupListResponseSchema } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { serverApi } from "@/lib/server-api";
import { getServerSession } from "@/lib/session";
import { CreateGroupForm } from "./create-group-form";

export const metadata = { title: "Your groups · BillSplit" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>;
}) {
  const [{ verified }, session, list] = await Promise.all([
    searchParams,
    getServerSession(),
    serverApi("/groups", GroupListResponseSchema),
  ]);
  const user = session!.user;
  const groups = list?.groups ?? [];

  return (
    <div className="flex flex-col gap-6">
      {verified ? (
        <Alert tone="success">Email verified. Welcome aboard, {user.name.split(" ")[0]}.</Alert>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your groups</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            A group is a flat, a trip, or a dinner crew. Bills are split inside it.
          </p>
        </div>
        <CreateGroupForm />
      </div>

      {groups.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Users className="size-8 text-zinc-400" aria-hidden />
          <CardTitle className="text-lg">No groups yet</CardTitle>
          <CardDescription>
            Create one and invite your roommates, or open an invite link someone sent you.
          </CardDescription>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}`}
                className="block rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium">{g.name}</h2>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {g.currency}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {g.memberCount} {g.memberCount === 1 ? "person" : "people"}
                  {g.myRole === "owner" ? " · you own this" : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
