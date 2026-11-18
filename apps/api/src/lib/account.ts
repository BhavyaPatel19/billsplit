import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import { groupBalances, loadExpenses, ParticipantResolver, toSummary } from "./ledger.js";

/**
 * Before an account is deleted: in each group the person owns, ownership passes to the
 * longest-standing other member with an account. A group with nobody else who could open it is
 * soft-deleted. Their participant rows stay (the foreign key sets user_id to null), so every
 * group keeps its history and they appear as a placeholder under the same name.
 */
export async function handOverGroups(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ participant: schema.participants, group: schema.groups })
      .from(schema.participants)
      .innerJoin(schema.groups, eq(schema.groups.id, schema.participants.groupId))
      .where(
        and(
          eq(schema.participants.userId, userId),
          eq(schema.participants.role, "owner"),
          isNull(schema.participants.mergedIntoId),
          isNull(schema.groups.deletedAt),
        ),
      );
    for (const { participant, group } of owned) {
      const [heir] = await tx
        .select({ id: schema.participants.id })
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.groupId, group.id),
            isNotNull(schema.participants.userId),
            ne(schema.participants.userId, userId),
            isNull(schema.participants.mergedIntoId),
          ),
        )
        .orderBy(asc(schema.participants.createdAt))
        .limit(1);
      if (heir) {
        await tx
          .update(schema.participants)
          .set({ role: "owner" })
          .where(eq(schema.participants.id, heir.id));
        await tx
          .update(schema.participants)
          .set({ role: "member" })
          .where(eq(schema.participants.id, participant.id));
      } else {
        await tx
          .update(schema.groups)
          .set({ deletedAt: new Date() })
          .where(eq(schema.groups.id, group.id));
      }
    }
  });
}

/** Everything BillSplit holds about a person, as JSON they can keep (GDPR-style export). */
export async function exportAccount(db: Db, userId: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const [prefs] = await db
    .select({
      activityEmails: schema.notificationPrefs.activityEmails,
      reminderEmails: schema.notificationPrefs.reminderEmails,
    })
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId));
  const memberships = await db
    .select({ participant: schema.participants, group: schema.groups })
    .from(schema.participants)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.participants.groupId))
    .where(
      and(
        eq(schema.participants.userId, userId),
        isNull(schema.participants.mergedIntoId),
        isNull(schema.groups.deletedAt),
      ),
    );

  const groups = [];
  for (const { participant: me, group } of memberships) {
    const resolver = await ParticipantResolver.forGroup(db, group.id);
    const [rows, balances, people, payments] = await Promise.all([
      loadExpenses(db, group.id, undefined, 10_000),
      groupBalances(db, group.id, group.currency, resolver),
      db
        .select({ id: schema.participants.id, name: schema.participants.displayName })
        .from(schema.participants)
        .where(eq(schema.participants.groupId, group.id)),
      db
        .select()
        .from(schema.settlements)
        .where(and(eq(schema.settlements.groupId, group.id), isNull(schema.settlements.deletedAt))),
    ]);
    const expenses = rows
      .map((r) => toSummary(r.expense, r.version, r.shares, resolver))
      .filter((e) => e.shares.some((s) => s.participantId === me.id));
    groups.push({
      id: group.id,
      name: group.name,
      currency: group.currency,
      role: me.role,
      yourName: me.displayName,
      people: people.map((p) => ({ id: resolver.resolve(p.id), name: p.name })),
      balanceCents: balances.balances.find((b) => b.participantId === me.id)?.netCents ?? 0,
      expenses,
      payments: payments
        .map((s) => ({
          on: s.createdAt.toISOString(),
          fromId: resolver.resolve(s.fromId),
          toId: resolver.resolve(s.toId),
          amountCents: s.amountCents,
          currency: s.currency,
          note: s.note,
        }))
        .filter((p) => p.fromId === me.id || p.toId === me.id),
    });
  }
  return {
    exportedAt: new Date().toISOString(),
    user: user ? { ...user, createdAt: user.createdAt.toISOString() } : null,
    notificationPrefs: prefs ?? { activityEmails: true, reminderEmails: true },
    groups,
  };
}
