"use client";

import { Activity as ActivityIcon } from "lucide-react";
import { useState } from "react";
import {
  ActivityListResponseSchema,
  type Activity,
  type ActivityListResponse,
  type GroupDetail,
} from "@billsplit/contracts";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api-client";
import { describeActivity, timeAgo } from "@/lib/activity-text";
import { cn } from "@/lib/utils";

export function ActivityPanel({
  group,
  initial,
}: {
  group: GroupDetail;
  initial: ActivityListResponse;
}) {
  const [items, setItems] = useState<Activity[]>(initial.activities);
  const [next, setNext] = useState(initial.next);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = new Map(group.participants.map((p) => [p.id, p.isMe ? "You" : p.displayName]));
  const name = (id: string) => names.get(id) ?? "Former member";

  const loadOlder = async () => {
    if (!next) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api(
        `/groups/${group.id}/activity?cursor=${encodeURIComponent(next)}`,
        ActivityListResponseSchema,
      );
      setItems((prev) => [...prev, ...page.activities]);
      setNext(page.next);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load more");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Activity</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nothing has happened here yet.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <ActivityIcon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  a.involvesMe ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", a.involvesMe && "font-medium")}>
                  {describeActivity(a, name)}
                </p>
                <p className="text-xs text-zinc-500">
                  <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
                    {timeAgo(a.createdAt)}
                  </time>
                  {a.involvesMe ? " · involves you" : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {next ? (
        <Button variant="secondary" loading={loading} onClick={() => void loadOlder()}>
          Show older
        </Button>
      ) : null}
    </div>
  );
}
