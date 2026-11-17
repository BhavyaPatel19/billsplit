import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import { ActivityPayloadSchema, type ActivityPayload } from "@billsplit/contracts";
import { cents, formatCents } from "@billsplit/split-engine";
import type { Email, Mailer } from "./email.js";
import type { Env } from "./env.js";
import { groupBalances, ParticipantResolver } from "./lib/ledger.js";
import type { Logger } from "./logger.js";

type NotifierEnv = Pick<Env, "APP_URL" | "REMINDER_INTERVAL_DAYS" | "REMINDER_MIN_CENTS">;
type Prefs = typeof schema.notificationPrefs.$inferSelect;

/** Activity kinds worth an email; the rest only appear in the feed. */
const EMAILED = new Set<ActivityPayload["kind"]>([
  "expense.added",
  "expense.edited",
  "payment.recorded",
]);

/** Arbitrary constant: one reminder run at a time across every API instance. */
const REMINDER_LOCK = 4_242_017;

const money = (amount: number, currency: string) => formatCents(cents(amount), currency);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * Sends notification emails. Activity emails go out after the change has committed, in the
 * background so a slow mail server never slows a request; failures are logged, not retried.
 * Reminders run on a schedule (see `server.ts`).
 */
export class Notifier {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly env: NotifierEnv,
    private readonly logger: Logger,
  ) {}

  /** Call after the transaction that recorded the activity has committed. */
  activityRecorded(activityId: string): void {
    const task = this.sendForActivity(activityId)
      .catch((err: unknown) => this.logger.error({ err, activityId }, "notification failed"))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Resolves when every queued activity email has been handled. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** Preferences for these users, creating rows with the defaults where missing. */
  async prefsFor(userIds: string[]): Promise<Map<string, Prefs>> {
    if (userIds.length === 0) return new Map();
    await this.db
      .insert(schema.notificationPrefs)
      .values(
        userIds.map((userId) => ({
          userId,
          unsubscribeToken: randomBytes(18).toString("base64url"),
        })),
      )
      .onConflictDoNothing();
    const rows = await this.db
      .select()
      .from(schema.notificationPrefs)
      .where(inArray(schema.notificationPrefs.userId, userIds));
    return new Map(rows.map((r) => [r.userId, r]));
  }

  private withFooter(email: Omit<Email, "headers">, prefs: Prefs, why: string): Email {
    const unsubscribe = `${this.env.APP_URL}/unsubscribe/${prefs.unsubscribeToken}`;
    const oneClick = `${this.env.APP_URL}/api/unsubscribe/${prefs.unsubscribeToken}`;
    const settings = `${this.env.APP_URL}/settings`;
    return {
      ...email,
      text: `${email.text}\n\n--\n${why}\nChange what you get: ${settings}\nStop all BillSplit emails: ${unsubscribe}`,
      html: `${email.html ?? ""}<hr><p style="color:#71717a;font-size:12px">${escapeHtml(why)} <a href="${settings}">Change what you get</a> · <a href="${unsubscribe}">Unsubscribe</a></p>`,
      // RFC 8058: mail clients show an unsubscribe button that POSTs here.
      headers: {
        "List-Unsubscribe": `<${oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  }

  private async sendForActivity(activityId: string): Promise<void> {
    const [row] = await this.db
      .select({ activity: schema.activities, group: schema.groups })
      .from(schema.activities)
      .innerJoin(schema.groups, eq(schema.groups.id, schema.activities.groupId))
      .where(and(eq(schema.activities.id, activityId), isNull(schema.groups.deletedAt)))
      .limit(1);
    if (!row) return;
    const payload = ActivityPayloadSchema.safeParse({
      kind: row.activity.kind,
      data: row.activity.data,
    });
    if (!payload.success || !EMAILED.has(payload.data.kind)) return;

    const resolver = await ParticipantResolver.forGroup(this.db, row.group.id);
    const actorId = row.activity.actorParticipantId
      ? resolver.resolve(row.activity.actorParticipantId)
      : null;
    const involved = [...new Set(row.activity.involved.map((id) => resolver.resolve(id)))].filter(
      (id) => id !== actorId,
    );
    if (involved.length === 0) return;

    const people = await this.db
      .select({ participant: schema.participants, user: schema.users })
      .from(schema.participants)
      .leftJoin(schema.users, eq(schema.users.id, schema.participants.userId))
      .where(eq(schema.participants.groupId, row.group.id));
    const nameOf = (id: string | null) =>
      people.find((p) => p.participant.id === id)?.participant.displayName ?? "Someone";
    const recipients = people.filter(
      (p) => involved.includes(p.participant.id) && p.user?.emailVerified,
    );
    if (recipients.length === 0) return;
    const prefs = await this.prefsFor(recipients.map((r) => r.user!.id));

    // For expenses, each person's own share of the current version.
    const owedBy = new Map<string, number>();
    if (payload.data.kind !== "payment.recorded" && row.activity.subjectId) {
      const shares = await this.db
        .select({
          participantId: schema.expenseShares.participantId,
          owedCents: schema.expenseShares.owedCents,
        })
        .from(schema.expenseShares)
        .innerJoin(
          schema.expenses,
          eq(schema.expenses.currentVersionId, schema.expenseShares.versionId),
        )
        .where(eq(schema.expenses.id, row.activity.subjectId));
      for (const s of shares) {
        const id = resolver.resolve(s.participantId);
        owedBy.set(id, (owedBy.get(id) ?? 0) + s.owedCents);
      }
    }

    const actor = nameOf(actorId);
    const groupUrl = `${this.env.APP_URL}/groups/${row.group.id}`;
    const p = payload.data;
    for (const r of recipients) {
      const userPrefs = prefs.get(r.user!.id);
      if (!userPrefs?.activityEmails) continue;
      const me = r.participant.id;
      let subject: string;
      let line: string;
      if (p.kind === "payment.recorded") {
        const amount = money(p.data.amountCents, p.data.currency);
        const from = nameOf(p.data.fromId);
        const to = nameOf(p.data.toId);
        if (p.data.toId === me) {
          line =
            actorId === p.data.fromId
              ? `${from} recorded paying you ${amount}.`
              : `${actor} recorded that ${from} paid you ${amount}.`;
        } else {
          line =
            actorId === p.data.toId
              ? `${to} recorded that you paid them ${amount}.`
              : `${actor} recorded that you paid ${to} ${amount}.`;
        }
        subject = `Payment recorded in ${row.group.name}`;
      } else if (p.kind === "expense.added" || p.kind === "expense.edited") {
        const verb = p.kind === "expense.added" ? "added" : "edited";
        const share = owedBy.get(me) ?? 0;
        line =
          `${actor} ${verb} "${p.data.description}" (${money(p.data.totalCents, p.data.currency)}). ` +
          (share > 0
            ? `Your share is ${money(share, p.data.currency)}.`
            : "You are no longer on it.");
        subject = `${actor} ${verb} ${p.data.description} in ${row.group.name}`;
      } else {
        continue;
      }
      await this.mailer.send(
        this.withFooter(
          {
            to: r.user!.email,
            subject,
            text: `Hi ${r.participant.displayName},\n\n${line}\n\nSee the group: ${groupUrl}`,
            html: `<p>Hi ${escapeHtml(r.participant.displayName)},</p><p>${escapeHtml(line)}</p><p><a href="${groupUrl}">See ${escapeHtml(row.group.name)}</a></p>`,
          },
          userPrefs,
          `You get this because you are in ${row.group.name} on BillSplit.`,
        ),
      );
    }
  }

  /**
   * One email per person who owes more than the minimum in any group and has not had a
   * reminder within the interval. Safe to run often: the interval is tracked per person, and
   * an advisory lock keeps two instances from sending the same reminders.
   */
  async sendReminders(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.REMINDER_INTERVAL_DAYS * 86_400_000);
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${REMINDER_LOCK}) as locked`,
      );
      if (!lock.rows[0]?.locked) return 0;

      // Verified users in a live group, whose last reminder (if any) is old enough.
      const candidates = await tx
        .select({
          userId: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          participantId: schema.participants.id,
          groupId: schema.groups.id,
          groupName: schema.groups.name,
          currency: schema.groups.currency,
        })
        .from(schema.participants)
        .innerJoin(schema.users, eq(schema.users.id, schema.participants.userId))
        .innerJoin(schema.groups, eq(schema.groups.id, schema.participants.groupId))
        .leftJoin(schema.notificationPrefs, eq(schema.notificationPrefs.userId, schema.users.id))
        .where(
          and(
            isNull(schema.participants.mergedIntoId),
            isNull(schema.groups.deletedAt),
            eq(schema.users.emailVerified, true),
            sql`coalesce(${schema.notificationPrefs.reminderEmails}, true)`,
            sql`(${schema.notificationPrefs.lastReminderAt} is null or ${schema.notificationPrefs.lastReminderAt} <= ${cutoff})`,
          ),
        );
      if (candidates.length === 0) return 0;

      const owing = new Map<
        string,
        { email: string; name: string; lines: { group: string; url: string; text: string }[] }
      >();
      for (const groupId of new Set(candidates.map((c) => c.groupId))) {
        const inGroup = candidates.filter((c) => c.groupId === groupId);
        const first = inGroup[0]!;
        const resolver = await ParticipantResolver.forGroup(this.db, groupId);
        const [{ balances, transfers }, members] = await Promise.all([
          groupBalances(this.db, groupId, first.currency, resolver),
          this.db
            .select({ id: schema.participants.id, name: schema.participants.displayName })
            .from(schema.participants)
            .where(eq(schema.participants.groupId, groupId)),
        ]);
        for (const c of inGroup) {
          const net = balances.find((b) => b.participantId === c.participantId)?.netCents ?? 0;
          if (-net < this.env.REMINDER_MIN_CENTS) continue;
          const to = transfers
            .filter((t) => t.fromId === c.participantId)
            .map((t) => {
              const name = members.find((m) => m.id === t.toId)?.name;
              return `${money(t.amountCents, c.currency)} to ${name ?? "someone in the group"}`;
            });
          const entry = owing.get(c.userId) ?? { email: c.email, name: c.name, lines: [] };
          entry.lines.push({
            group: c.groupName,
            url: `${this.env.APP_URL}/groups/${groupId}`,
            text: `${c.groupName}: you owe ${money(-net, c.currency)}${to.length ? ` (${to.join(", ")})` : ""}`,
          });
          owing.set(c.userId, entry);
        }
      }
      if (owing.size === 0) return 0;

      const prefs = await this.prefsFor([...owing.keys()]);
      let sent = 0;
      for (const [userId, o] of owing) {
        const userPrefs = prefs.get(userId)!;
        await this.mailer.send(
          this.withFooter(
            {
              to: o.email,
              subject:
                o.lines.length === 1
                  ? `Reminder: settle up in ${o.lines[0]!.group}`
                  : `Reminder: you owe in ${o.lines.length} groups`,
              text: `Hi ${o.name},\n\n${o.lines.map((l) => `- ${l.text}\n  ${l.url}`).join("\n")}\n\nPay them however you like, then tap "Mark as paid" in the group.`,
              html: `<p>Hi ${escapeHtml(o.name)},</p><ul>${o.lines.map((l) => `<li><a href="${l.url}">${escapeHtml(l.text)}</a></li>`).join("")}</ul><p>Pay them however you like, then tap "Mark as paid" in the group.</p>`,
            },
            userPrefs,
            `You get a reminder at most every ${this.env.REMINDER_INTERVAL_DAYS} days while you owe money.`,
          ),
        );
        await tx
          .update(schema.notificationPrefs)
          .set({ lastReminderAt: now })
          .where(eq(schema.notificationPrefs.userId, userId));
        sent += 1;
      }
      return sent;
    });
  }
}
