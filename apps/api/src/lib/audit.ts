import { schema, type Db } from "@billsplit/db";
import type { AuditAction } from "@billsplit/contracts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Write an audit entry in the same transaction as the change it describes, so there is never
 * a change without its entry or an entry for a change that rolled back.
 */
export async function recordAudit(
  tx: Tx,
  entry: {
    groupId: string;
    actorUserId: string;
    actorParticipantId: string | null;
    action: AuditAction;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.auditLog).values(entry);
}
