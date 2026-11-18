import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import type { ExpenseInput, RecurringTemplate } from "@billsplit/contracts";
import { recordActivity } from "./lib/activity.js";
import { ApiError } from "./lib/errors.js";
import { writeVersion } from "./lib/expense-writes.js";
import { compute, ParticipantResolver } from "./lib/ledger.js";
import { occurrenceDate, todayUtc, type IsoDate } from "./lib/schedule.js";
import type { Logger } from "./logger.js";
import type { Notifier } from "./notifications.js";

type ScheduleRow = typeof schema.recurringExpenses.$inferSelect;

/** Upper bound on postings per run, so a long outage is caught up over a few runs, not one. */
const MAX_POSTS_PER_RUN = 500;

/** The template as it applies today: placeholders merged since it was saved map to the account. */
export function resolveTemplate(
  template: RecurringTemplate,
  resolver: ParticipantResolver,
): RecurringTemplate {
  return {
    ...template,
    payerId: resolver.resolve(template.payerId),
    items: template.items.map((item) => ({ ...item, split: resolver.split(item.split) })),
  };
}

export const cadenceOf = (s: ScheduleRow) => ({
  frequency: s.frequency,
  interval: s.interval,
  startOn: s.startOn,
});

/**
 * Posts the occurrences of recurring expenses that have come due. Each occurrence is its own
 * transaction: the schedule row is taken with SKIP LOCKED, so several API instances can run this
 * at once without waiting on or double-posting each other, and the unique (schedule, occurrence)
 * index on expenses is the backstop. Missed occurrences (the server was down) are posted with
 * their own dates. A schedule whose bill no longer computes, for example because someone on it
 * was removed from the group, is paused with the reason instead of failing on every run.
 */
export class RecurringPoster {
  constructor(
    private readonly db: Db,
    private readonly notifier: Notifier,
    private readonly logger: Logger,
  ) {}

  /** Post everything due on or before `today`; optionally only one schedule. Returns the count. */
  async postDue(today: IsoDate = todayUtc(), scheduleId?: string): Promise<number> {
    let posted = 0;
    while (posted < MAX_POSTS_PER_RUN) {
      const outcome = await this.postNext(today, scheduleId);
      if (outcome === "none") break;
      if (outcome === "posted") posted += 1;
    }
    return posted;
  }

  private async postNext(
    today: IsoDate,
    scheduleId?: string,
  ): Promise<"posted" | "paused" | "none"> {
    const r = schema.recurringExpenses;
    let activityId: string | null = null;
    const outcome = await this.db.transaction(async (tx) => {
      const [due] = await tx
        .select({ schedule: r, currency: schema.groups.currency })
        .from(r)
        .innerJoin(schema.groups, eq(schema.groups.id, r.groupId))
        .where(
          and(
            scheduleId ? eq(r.id, scheduleId) : undefined,
            isNull(r.deletedAt),
            isNull(r.pausedAt),
            isNull(schema.groups.deletedAt),
            lte(r.nextOn, today),
            or(isNull(r.endOn), sql`${r.nextOn} <= ${r.endOn}`),
          ),
        )
        .orderBy(asc(r.nextOn))
        .limit(1)
        .for("update", { of: r, skipLocked: true });
      if (!due) return "none" as const;
      const s = due.schedule;

      const resolver = await ParticipantResolver.forGroup(this.db, s.groupId);
      const body: ExpenseInput = {
        ...resolveTemplate(s.template as RecurringTemplate, resolver),
        spentOn: s.nextOn,
      };
      try {
        compute(body, due.currency, resolver.active);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        await tx
          .update(r)
          .set({ pausedAt: new Date(), pausedReason: err.message })
          .where(eq(r.id, s.id));
        this.logger.warn({ scheduleId: s.id, reason: err.message }, "recurring expense paused");
        return "paused" as const;
      }

      const advance = {
        nextOccurrence: s.nextOccurrence + 1,
        nextOn: occurrenceDate(cadenceOf(s), s.nextOccurrence + 1),
      };
      const actorId = s.createdBy ? resolver.resolve(s.createdBy) : null;
      const [expense] = await tx
        .insert(schema.expenses)
        .values({
          groupId: s.groupId,
          createdBy: actorId,
          recurringExpenseId: s.id,
          recurringOccurrence: s.nextOccurrence,
        })
        .onConflictDoNothing()
        .returning({ id: schema.expenses.id });
      if (!expense) {
        // Already posted (only possible if the row was edited by hand); just move on.
        await tx.update(r).set(advance).where(eq(r.id, s.id));
        return "posted" as const;
      }
      const written = await writeVersion(tx, {
        expenseId: expense.id,
        version: 1,
        body,
        currency: due.currency,
        actorId,
        active: resolver.active,
      });
      activityId = await recordActivity(tx, {
        groupId: s.groupId,
        actorParticipantId: actorId,
        subjectId: expense.id,
        involved: written.involved,
        kind: "expense.added",
        data: { ...written.facts, recurringId: s.id },
      });
      await tx
        .update(r)
        .set({ ...advance, lastPostedAt: new Date() })
        .where(eq(r.id, s.id));
      return "posted" as const;
    });
    if (activityId) this.notifier.activityRecorded(activityId);
    return outcome;
  }
}
