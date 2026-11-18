import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import { BalancesResponseSchema, GroupDetailSchema, InviteSchema } from "@billsplit/contracts";
import {
  cookiesOf,
  request,
  signUpVerified,
  startTestContext,
  type TestContext,
} from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let shared = "";
let solo = "";
let A = "";
let B = "";

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
  ]);
  const group = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Flat 4B" } })).json(),
  );
  shared = group.id;
  A = group.myParticipantId;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${shared}/invites`, { cookie: ana, body: {} })).json(),
  );
  await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} });
  const detail = GroupDetailSchema.parse(
    await (await api(`/api/groups/${shared}`, { cookie: ana })).json(),
  );
  B = detail.participants.find((p) => p.displayName === "Bo")!.id;
  await api(`/api/groups/${shared}/expenses`, {
    cookie: ana,
    body: {
      description: "Dinner",
      payerId: A,
      items: [
        {
          name: "Food",
          amountCents: 4000,
          quantity: 1,
          split: { kind: "equal", participantIds: [A, B] },
        },
      ],
      adjustments: [],
    },
  });
  solo = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Just me" } })).json(),
  ).id;
});

afterAll(async () => {
  await ctx?.stop();
});

describe("sessions", () => {
  it("lists every signed-in device and signs one out", async () => {
    const login = await api("/api/auth/sign-in/email", {
      body: { email: "bo@example.com", password: "Bo-passphrase-123" },
    });
    expect(login.status).toBe(200);
    const laptop = cookiesOf(login);

    const sessions = (await (await api("/api/auth/list-sessions", { cookie: bo })).json()) as {
      token: string;
    }[];
    expect(sessions).toHaveLength(2);
    const laptopToken = decodeURIComponent(laptop.split("session_token=")[1]!.split(";")[0]!).split(
      ".",
    )[0]!;
    expect(sessions.map((s) => s.token)).toContain(laptopToken);

    const revoked = await api("/api/auth/revoke-session", {
      cookie: bo,
      body: { token: laptopToken },
    });
    expect(revoked.status).toBe(200);
    expect((await api("/api/me", { cookie: laptop })).status).toBe(401);
    expect((await api("/api/me", { cookie: bo })).status).toBe(200);
  });
});

describe("export", () => {
  it("downloads the person's groups, expenses, payments and balances", async () => {
    const res = await api("/api/me/export", { cookie: bo });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("billsplit-export.json");
    const data = (await res.json()) as {
      user: { email: string };
      groups: { name: string; balanceCents: number; expenses: { description: string }[] }[];
    };
    expect(data.user.email).toBe("bo@example.com");
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]).toMatchObject({ name: "Flat 4B", balanceCents: -2000 });
    expect(data.groups[0]!.expenses.map((e) => e.description)).toEqual(["Dinner"]);
  });
});

describe("deleting an account", () => {
  it("needs the password", async () => {
    const res = await api("/api/auth/delete-user", {
      cookie: ana,
      body: { password: "wrong-password-1" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await api("/api/me", { cookie: ana })).status).toBe(200);
  });

  it("hands groups over, keeps history and leaves a placeholder behind", async () => {
    const res = await api("/api/auth/delete-user", {
      cookie: ana,
      body: { password: "Ana-passphrase-123" },
    });
    expect(res.status).toBe(200);
    expect((await api("/api/me", { cookie: ana })).status).toBe(401);

    const detail = GroupDetailSchema.parse(
      await (await api(`/api/groups/${shared}`, { cookie: bo })).json(),
    );
    expect(detail.myRole).toBe("owner");
    expect(detail.participants.find((p) => p.id === A)).toMatchObject({
      displayName: "Ana",
      isPlaceholder: true,
      role: "member",
    });
    const balances = BalancesResponseSchema.parse(
      await (await api(`/api/groups/${shared}/balances`, { cookie: bo })).json(),
    );
    expect(balances.transfers).toEqual([{ fromId: B, toId: A, amountCents: 2000 }]);

    const [gone] = await ctx.db.db.select().from(schema.groups).where(eq(schema.groups.id, solo));
    expect(gone!.deletedAt).not.toBeNull();
    const users = await ctx.db.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "ana@example.com"));
    expect(users).toEqual([]);
  });
});
