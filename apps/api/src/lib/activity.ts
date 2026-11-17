import { schema, type Db } from "@billsplit/db";
import type { ActivityPayload } from "@billsplit/contracts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Record a feed entry inside the transaction that made the change, so the feed never shows
 * something that rolled back and never misses something that committed. Returns the entry id
 * so the caller can hand it to the notifier once the transaction has committed.
 */
export async function recordActivity(
  tx: Tx,
  entry: {
    groupId: string;
    actorParticipantId: string | null;
    subjectId: string | null;
    involved: Iterable<string>;
  } & ActivityPayload,
): Promise<string> {
  const involved = new Set(entry.involved);
  if (entry.actorParticipantId) involved.add(entry.actorParticipantId);
  const [row] = await tx
    .insert(schema.activities)
    .values({
      groupId: entry.groupId,
      actorParticipantId: entry.actorParticipantId,
      kind: entry.kind,
      subjectId: entry.subjectId,
      involved: [...involved],
      data: entry.data,
    })
    .returning({ id: schema.activities.id });
  return row!.id;
}
