import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import { forbidden, notFound } from "./errors.js";

export type Membership = {
  group: typeof schema.groups.$inferSelect;
  /** The caller's active participant row in the group. */
  me: typeof schema.participants.$inferSelect;
};

/**
 * Every group-scoped handler goes through here. Resolves the caller's active participant in a
 * live (not soft-deleted) group, or throws 404, so a non-member cannot distinguish "no such
 * group" from "not yours".
 */
export async function requireMembership(
  db: Db,
  userId: string,
  groupId: string,
): Promise<Membership> {
  const rows = await db
    .select({ group: schema.groups, me: schema.participants })
    .from(schema.participants)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.participants.groupId))
    .where(
      and(
        eq(schema.participants.groupId, groupId),
        eq(schema.participants.userId, userId),
        isNull(schema.participants.mergedIntoId),
        isNull(schema.groups.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Group not found");
  return row;
}

/** Like {@link requireMembership} but the caller must own the group (403 otherwise). */
export async function requireOwner(db: Db, userId: string, groupId: string): Promise<Membership> {
  const membership = await requireMembership(db, userId, groupId);
  if (membership.me.role !== "owner") throw forbidden("Only the group owner can do that");
  return membership;
}
