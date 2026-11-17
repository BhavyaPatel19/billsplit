import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import {
  ExpenseDetailSchema,
  GroupDetailSchema,
  InviteSchema,
  NotificationPrefsSchema,
  ParticipantSchema,
  UnsubscribeStatusSchema,
  type ExpenseInput,
} from "@billsplit/contracts";
import type { Email } from "../src/email.js";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let cy = "";
let groupId = "";
let A = "";
let B = "";
let C = "";
let R = ""; // placeholder, no email

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

/** Emails sent since the last call, after background sends have finished. */
let seen = 0;
async function newMail(): Promise<Email[]> {
  await ctx.notifier.idle();
  const fresh = ctx.mailer.sent.slice(seen);
  seen = ctx.mailer.sent.length;
  return fresh;
}

const expense = (people: string[], description = "Dinner", payerId = A): ExpenseInput => ({
  description,
  payerId,
  items: [
    {
      name: "Food",
      amountCents: 3000,
      quantity: 1,
      split: { kind: "equal", participantIds: people },
    },
  ],
  adjustments: [],
});

const tokenOf = async (email: string) => {
  const [row] = await ctx.db.db
    .select({ token: schema.notificationPrefs.unsubscribeToken })
    .from(schema.notificationPrefs)
    .innerJoin(schema.users, eq(schema.users.id, schema.notificationPrefs.userId))
    .where(eq(schema.users.email, email));
  return row!.token;
};

const setPrefs = (cookie: string, body: unknown) =>
  api("/api/me/notifications", { method: "PATCH", cookie, body });

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, cy] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
    signUpVerified(ctx, "Cy", "cy@example.com"),
  ]);
  const group = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Flat 4B" } })).json(),
  );
  groupId = group.id;
  A = group.myParticipantId;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: {} })).json(),
  );
  await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} });
  await api(`/api/invites/${invite.code}/accept`, { cookie: cy, body: {} });
  const detail = GroupDetailSchema.parse(
    await (await api(`/api/groups/${groupId}`, { cookie: ana })).json(),
  );
  B = detail.participants.find((p) => p.displayName === "Bo")!.id;
  C = detail.participants.find((p) => p.displayName === "Cy")!.id;
  R = ParticipantSchema.parse(
    await (
      await api(`/api/groups/${groupId}/participants`, {
        cookie: ana,
        body: { displayName: "Rahul" },
      })
    ).json(),
  ).id;
  await newMail();
});

afterAll(async () => {
  await ctx?.stop();
});

beforeEach(async () => {
  await ctx.db.db.update(schema.notificationPrefs).set({
    activityEmails: true,
    reminderEmails: true,
    lastReminderAt: null,
  });
  await newMail();
});

describe("activity emails", () => {
  it("tells the people on an expense their share, but not the person who added it", async () => {
    await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: expense([A, B, R]) });
    const mail = await newMail();
    // Bo is on it; Ana added it; Cy is not on it; Rahul has no account.
    expect(mail.map((m) => m.to)).toEqual(["bo@example.com"]);
    const [toBo] = mail as [Email];
    expect(toBo.subject).toBe("Ana added Dinner in Flat 4B");
    expect(toBo.text).toContain('Ana added "Dinner" ($30.00). Your share is $10.00.');
    expect(toBo.text).toContain(`http://localhost:3000/groups/${groupId}`);
    expect(toBo.headers?.["List-Unsubscribe"]).toBe(
      `<http://localhost:3000/api/unsubscribe/${await tokenOf("bo@example.com")}>`,
    );
    expect(toBo.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("tells someone taken off an expense on edit", async () => {
    const created = ExpenseDetailSchema.parse(
      await (
        await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: expense([A, B]) })
      ).json(),
    );
    await newMail();
    await api(`/api/groups/${groupId}/expenses/${created.id}`, {
      method: "PUT",
      cookie: ana,
      body: expense([A, C]),
    });
    const mail = await newMail();
    expect(mail.map((m) => m.to).sort()).toEqual(["bo@example.com", "cy@example.com"]);
    expect(mail.find((m) => m.to === "bo@example.com")!.text).toContain("You are no longer on it.");
    expect(mail.find((m) => m.to === "cy@example.com")!.text).toContain("Your share is $15.00.");
  });

  it("tells the other side of a recorded payment", async () => {
    await api(`/api/groups/${groupId}/settlements`, {
      cookie: bo,
      body: { fromId: B, toId: A, amountCents: 1250 },
    });
    const mail = await newMail();
    expect(mail.map((m) => [m.to, m.text.split("\n")[2]])).toEqual([
      ["ana@example.com", "Bo recorded paying you $12.50."],
    ]);
  });

  it("words a payment recorded by the receiver or a third person", async () => {
    await api(`/api/groups/${groupId}/settlements`, {
      cookie: ana,
      body: { fromId: B, toId: A, amountCents: 500 },
    });
    expect((await newMail()).map((m) => [m.to, m.text.split("\n")[2]])).toEqual([
      ["bo@example.com", "Ana recorded that you paid them $5.00."],
    ]);
    await api(`/api/groups/${groupId}/settlements`, {
      cookie: cy,
      body: { fromId: B, toId: A, amountCents: 700 },
    });
    expect((await newMail()).map((m) => [m.to, m.text.split("\n")[2]]).sort()).toEqual([
      ["ana@example.com", "Cy recorded that Bo paid you $7.00."],
      ["bo@example.com", "Cy recorded that you paid Ana $7.00."],
    ]);
  });

  it("skips people who turned activity emails off, and sends nothing for a failed request", async () => {
    expect((await setPrefs(bo, { activityEmails: false })).status).toBe(200);
    await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: expense([A, B, C]) });
    expect((await newMail()).map((m) => m.to)).toEqual(["cy@example.com"]);

    const bad = await api(`/api/groups/${groupId}/expenses`, {
      cookie: ana,
      body: expense(["00000000-0000-4000-8000-000000000000"]),
    });
    expect(bad.status).toBe(400);
    expect(await newMail()).toEqual([]);
  });
});

describe("preferences", () => {
  it("defaults to everything on and can be changed", async () => {
    const res = await api("/api/me/notifications", { cookie: cy });
    expect(NotificationPrefsSchema.parse(await res.json())).toEqual({
      activityEmails: true,
      reminderEmails: true,
    });
    const updated = await setPrefs(cy, { reminderEmails: false });
    expect(NotificationPrefsSchema.parse(await updated.json())).toEqual({
      activityEmails: true,
      reminderEmails: false,
    });
    expect((await setPrefs(cy, {})).status).toBe(400);
    expect((await api("/api/me/notifications")).status).toBe(401);
  });
});

describe("unsubscribe links", () => {
  it("show what they would turn off without changing anything, then turn everything off", async () => {
    await api("/api/me/notifications", { cookie: bo });
    const token = await tokenOf("bo@example.com");
    const preview = await api(`/api/unsubscribe/${token}`);
    expect(UnsubscribeStatusSchema.parse(await preview.json())).toEqual({
      email: "bo•••@example.com",
      prefs: { activityEmails: true, reminderEmails: true },
    });
    // A mail client's one-click POST carries a form body and no session or origin.
    const res = await ctx.app.request(`/api/unsubscribe/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    expect(UnsubscribeStatusSchema.parse(await res.json()).prefs).toEqual({
      activityEmails: false,
      reminderEmails: false,
    });

    await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: expense([A, B]) });
    expect(await newMail()).toEqual([]);
  });

  it("answer 404 for an unknown token", async () => {
    expect((await api("/api/unsubscribe/nope")).status).toBe(404);
    expect((await api("/api/unsubscribe/nope", { method: "POST" })).status).toBe(404);
  });
});

describe("reminders", () => {
  /** A fresh group so earlier tests' balances do not interfere. */
  async function owingGroup(name: string, amountCents: number) {
    const group = GroupDetailSchema.parse(
      await (await api("/api/groups", { cookie: ana, body: { name } })).json(),
    );
    const invite = InviteSchema.parse(
      await (await api(`/api/groups/${group.id}/invites`, { cookie: ana, body: {} })).json(),
    );
    await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} });
    const detail = GroupDetailSchema.parse(
      await (await api(`/api/groups/${group.id}`, { cookie: ana })).json(),
    );
    const bo_ = detail.participants.find((p) => p.displayName === "Bo")!.id;
    await api(`/api/groups/${group.id}/expenses`, {
      cookie: ana,
      body: {
        description: "Rent",
        payerId: detail.myParticipantId,
        items: [
          {
            name: "Rent",
            amountCents,
            quantity: 1,
            split: { kind: "equal", participantIds: [bo_] },
          },
        ],
        adjustments: [],
      },
    });
    return group;
  }

  it("sends one summary per person who owes, then waits a week", async () => {
    // Isolate from the shared group's balances.
    await ctx.db.db
      .update(schema.expenses)
      .set({ deletedAt: new Date() })
      .where(eq(schema.expenses.groupId, groupId));
    await ctx.db.db
      .update(schema.settlements)
      .set({ deletedAt: new Date() })
      .where(eq(schema.settlements.groupId, groupId));
    const rentGroup = await owingGroup("Rent club", 50_000);
    await owingGroup("Tiny debts", 50);
    await newMail();

    const now = new Date("2026-11-20T10:00:00Z");
    expect(await ctx.notifier.sendReminders(now)).toBe(1);
    const [reminder, ...rest] = await newMail();
    expect(rest).toEqual([]);
    expect(reminder!.to).toBe("bo@example.com");
    expect(reminder!.subject).toBe("Reminder: settle up in Rent club");
    expect(reminder!.text).toContain("Rent club: you owe $500.00 ($500.00 to Ana)");
    expect(reminder!.text).toContain(`/groups/${rentGroup.id}`);
    // Under the $1 minimum.
    expect(reminder!.text).not.toContain("Tiny debts");

    expect(await ctx.notifier.sendReminders(new Date("2026-11-26T10:00:00Z"))).toBe(0);
    expect(await ctx.notifier.sendReminders(new Date("2026-11-27T10:00:00Z"))).toBe(1);
    await newMail();
  });

  it("respects the reminder setting and never runs twice at once", async () => {
    expect((await setPrefs(bo, { reminderEmails: false })).status).toBe(200);
    expect(await ctx.notifier.sendReminders(new Date("2026-12-20T10:00:00Z"))).toBe(0);
    await setPrefs(bo, { reminderEmails: true });

    const runs = await Promise.all(
      [1, 2, 3].map(() => ctx.notifier.sendReminders(new Date("2026-12-21T10:00:00Z"))),
    );
    expect(runs.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await newMail()).filter((m) => m.subject.startsWith("Reminder"))).toHaveLength(1);
  });
});
