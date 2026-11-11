import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AcceptInviteResponseSchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  InvitePreviewSchema,
  InviteSchema,
  ParticipantSchema,
  type GroupDetail,
  type Invite,
} from "@billsplit/contracts";
import { cookiesOf, firstUrl, jsonRequest, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = ""; // cookies
let bo = "";
let cy = "";

/** Sign up, follow the verification link, return the session cookie. */
async function signUpVerified(name: string, email: string): Promise<string> {
  const res = await jsonRequest(ctx.app, "/api/auth/sign-up/email", {
    body: { name, email, password: `${name}-passphrase-123` },
  });
  expect(res.status).toBe(200);
  const url = firstUrl(ctx.mailer.lastTo(email)!.text);
  const verified = await ctx.app.request(url.replace("http://localhost:3000", ""), {
    headers: { origin: "http://localhost:3000" },
  });
  const cookie = cookiesOf(verified);
  expect(cookie).toContain("session_token");
  return cookie;
}

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  jsonRequest(ctx.app, path, init);

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, cy] = await Promise.all([
    signUpVerified("Ana", "ana@example.com"),
    signUpVerified("Bo", "bo@example.com"),
    signUpVerified("Cy", "cy@example.com"),
  ]);
});

afterAll(async () => {
  await ctx?.stop();
});

let flat: GroupDetail;

describe("groups", () => {
  it("requires a session", async () => {
    expect((await api("/api/groups")).status).toBe(401);
    expect((await api("/api/groups", { body: { name: "x" } })).status).toBe(401);
  });

  it("creates a group with the creator as owner", async () => {
    const res = await api("/api/groups", { cookie: ana, body: { name: "Flat 4B" } });
    expect(res.status).toBe(201);
    flat = GroupDetailSchema.parse(await res.json());
    expect(flat).toMatchObject({
      name: "Flat 4B",
      currency: "USD",
      memberCount: 1,
      myRole: "owner",
    });
    expect(flat.participants[0]).toMatchObject({
      displayName: "Ana",
      isMe: true,
      isPlaceholder: false,
      role: "owner",
    });
  });

  it("validates input", async () => {
    const res = await api("/api/groups", { cookie: ana, body: { name: "", currency: "usd" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Array<{ path: string[] }> };
    expect(body.error).toBe("Invalid request");
    expect(body.details.map((d) => d.path[0])).toEqual(
      expect.arrayContaining(["name", "currency"]),
    );
  });

  it("lists only my groups", async () => {
    await api("/api/groups", { cookie: bo, body: { name: "Bo's trip", currency: "EUR" } });
    const mine = GroupListResponseSchema.parse(
      await (await api("/api/groups", { cookie: ana })).json(),
    );
    expect(mine.groups.map((g) => g.name)).toEqual(["Flat 4B"]);
    const bos = GroupListResponseSchema.parse(
      await (await api("/api/groups", { cookie: bo })).json(),
    );
    expect(bos.groups.map((g) => g.name)).toEqual(["Bo's trip"]);
  });

  it("hides groups from non-members with a 404 (IDOR)", async () => {
    expect((await api(`/api/groups/${flat.id}`, { cookie: bo })).status).toBe(404);
    expect(
      (
        await api(`/api/groups/${flat.id}`, {
          cookie: bo,
          method: "PATCH",
          body: { name: "pwned" },
        })
      ).status,
    ).toBe(404);
    expect((await api(`/api/groups/${flat.id}`, { cookie: bo, method: "DELETE" })).status).toBe(
      404,
    );
    expect(
      (await api(`/api/groups/${flat.id}/participants`, { cookie: bo, body: { displayName: "x" } }))
        .status,
    ).toBe(404);
    expect((await api(`/api/groups/${flat.id}/invites`, { cookie: bo, body: {} })).status).toBe(
      404,
    );
    expect(
      (await api(`/api/groups/00000000-0000-0000-0000-000000000000`, { cookie: ana })).status,
    ).toBe(404);
  });

  it("lets the owner rename and change currency", async () => {
    const res = await api(`/api/groups/${flat.id}`, {
      cookie: ana,
      method: "PATCH",
      body: { currency: "INR" },
    });
    expect(res.status).toBe(200);
    expect(GroupDetailSchema.parse(await res.json()).currency).toBe("INR");
    expect(
      (await api(`/api/groups/${flat.id}`, { cookie: ana, method: "PATCH", body: {} })).status,
    ).toBe(400);
  });
});

describe("placeholders and invites", () => {
  let rahul: string; // placeholder participant id
  let openInvite: Invite;
  let boundInvite: Invite;

  it("adds a placeholder person without an account", async () => {
    const res = await api(`/api/groups/${flat.id}/participants`, {
      cookie: ana,
      body: { displayName: "Rahul" },
    });
    expect(res.status).toBe(201);
    const p = ParticipantSchema.parse(await res.json());
    expect(p).toMatchObject({
      displayName: "Rahul",
      isPlaceholder: true,
      userId: null,
      role: "member",
    });
    rahul = p.id;
  });

  it("creates an open invite and one bound to the placeholder", async () => {
    const open = await api(`/api/groups/${flat.id}/invites`, {
      cookie: ana,
      body: { expiresInDays: 3 },
    });
    expect(open.status).toBe(201);
    openInvite = InviteSchema.parse(await open.json());
    expect(openInvite.url).toBe(`http://localhost:3000/join/${openInvite.code}`);
    expect(openInvite.participantId).toBeNull();

    const bound = await api(`/api/groups/${flat.id}/invites`, {
      cookie: ana,
      body: { participantId: rahul, maxUses: 1 },
    });
    expect(bound.status).toBe(201);
    boundInvite = InviteSchema.parse(await bound.json());
    expect(boundInvite.participantId).toBe(rahul);
  });

  it("previews an invite without signing in", async () => {
    const res = await api(`/api/invites/${boundInvite.code}`);
    expect(res.status).toBe(200);
    expect(InvitePreviewSchema.parse(await res.json())).toEqual({
      groupName: "Flat 4B",
      memberCount: 2,
      placeholderName: "Rahul",
      status: "valid",
    });
    expect((await api("/api/invites/nope")).status).toBe(404);
  });

  it("requires a session to accept", async () => {
    expect((await api(`/api/invites/${openInvite.code}/accept`, { body: {} })).status).toBe(401);
  });

  it("joins via the open invite as a new member", async () => {
    const res = await api(`/api/invites/${openInvite.code}/accept`, { cookie: bo, body: {} });
    expect(res.status).toBe(200);
    const body = AcceptInviteResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ groupId: flat.id, alreadyMember: false });
    const group = GroupDetailSchema.parse(
      await (await api(`/api/groups/${flat.id}`, { cookie: bo })).json(),
    );
    expect(group.myRole).toBe("member");
    expect(group.participants.map((p) => p.displayName)).toEqual(["Ana", "Rahul", "Bo"]);
  });

  it("is idempotent for existing members", async () => {
    const res = await api(`/api/invites/${openInvite.code}/accept`, { cookie: bo, body: {} });
    expect(AcceptInviteResponseSchema.parse(await res.json()).alreadyMember).toBe(true);
    const before = openInvite.uses;
    const list = await api(`/api/groups/${flat.id}/invites`, { cookie: ana });
    const { invites } = (await list.json()) as { invites: Invite[] };
    expect(invites.find((i) => i.id === openInvite.id)!.uses).toBe(before + 1);
  });

  it("claims the placeholder when accepting the bound invite", async () => {
    const res = await api(`/api/invites/${boundInvite.code}/accept`, { cookie: cy, body: {} });
    expect(res.status).toBe(200);
    const body = AcceptInviteResponseSchema.parse(await res.json());
    expect(body.participantId).toBe(rahul); // same row: history stays attached
    const group = GroupDetailSchema.parse(
      await (await api(`/api/groups/${flat.id}`, { cookie: cy })).json(),
    );
    const me = group.participants.find((p) => p.isMe)!;
    expect(me).toMatchObject({ id: rahul, displayName: "Rahul", isPlaceholder: false });
    expect(group.memberCount).toBe(3);
  });

  it("marks the bound invite as claimed afterwards", async () => {
    const preview = InvitePreviewSchema.parse(
      await (await api(`/api/invites/${boundInvite.code}`)).json(),
    );
    expect(preview.status).toBe("claimed");
  });

  it("only the owner may list and revoke invites", async () => {
    expect((await api(`/api/groups/${flat.id}/invites`, { cookie: bo })).status).toBe(403);
    expect(
      (
        await api(`/api/groups/${flat.id}/invites/${openInvite.id}`, {
          cookie: bo,
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/api/groups/${flat.id}/invites/${openInvite.id}`, {
          cookie: ana,
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    const preview = InvitePreviewSchema.parse(
      await (await api(`/api/invites/${openInvite.code}`)).json(),
    );
    expect(preview.status).toBe("revoked");
    expect(
      (await api(`/api/invites/${openInvite.code}/accept`, { cookie: cy, body: {} })).status,
    ).toBe(200); // already member
  });

  it("rejects expired invites", async () => {
    const created = InviteSchema.parse(
      await (
        await api(`/api/groups/${flat.id}/invites`, { cookie: ana, body: { expiresInDays: 1 } })
      ).json(),
    );
    // Expire it directly in the database.
    const { schema } = await import("@billsplit/db");
    const { eq } = await import("drizzle-orm");
    await ctx.db.db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invites.id, created.id));
    const dee = await signUpVerified("Dee", "dee@example.com");
    const res = await api(`/api/invites/${created.code}/accept`, { cookie: dee, body: {} });
    expect(res.status).toBe(410);
  });
});

describe("participant management", () => {
  it("members can rename themselves, only owners rename others", async () => {
    const group = GroupDetailSchema.parse(
      await (await api(`/api/groups/${flat.id}`, { cookie: bo })).json(),
    );
    const me = group.participants.find((p) => p.isMe)!;
    const other = group.participants.find((p) => !p.isMe)!;
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${me.id}`, {
          cookie: bo,
          method: "PATCH",
          body: { displayName: "Bo B." },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${other.id}`, {
          cookie: bo,
          method: "PATCH",
          body: { displayName: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${other.id}`, {
          cookie: ana,
          method: "PATCH",
          body: { displayName: "Ana P." },
        })
      ).status,
    ).toBe(200);
  });

  it("merges a placeholder into a member and hides it", async () => {
    const ghost = ParticipantSchema.parse(
      await (
        await api(`/api/groups/${flat.id}/participants`, {
          cookie: ana,
          body: { displayName: "Ghost" },
        })
      ).json(),
    );
    const group = GroupDetailSchema.parse(
      await (await api(`/api/groups/${flat.id}`, { cookie: ana })).json(),
    );
    const boRow = group.participants.find((p) => p.displayName === "Bo B.")!;
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${ghost.id}/merge`, {
          cookie: bo,
          body: { intoParticipantId: boRow.id },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${boRow.id}/merge`, {
          cookie: ana,
          body: { intoParticipantId: ghost.id },
        })
      ).status,
    ).toBe(409);
    const merged = await api(`/api/groups/${flat.id}/participants/${ghost.id}/merge`, {
      cookie: ana,
      body: { intoParticipantId: boRow.id },
    });
    expect(merged.status).toBe(200);
    const after = GroupDetailSchema.parse(
      await (await api(`/api/groups/${flat.id}`, { cookie: ana })).json(),
    );
    expect(after.participants.map((p) => p.displayName)).not.toContain("Ghost");
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${ghost.id}`, {
          cookie: ana,
          method: "PATCH",
          body: { displayName: "x" },
        })
      ).status,
    ).toBe(404);
  });

  it("owner removes placeholders, members leave, owners cannot leave", async () => {
    const tmp = ParticipantSchema.parse(
      await (
        await api(`/api/groups/${flat.id}/participants`, {
          cookie: ana,
          body: { displayName: "Temp" },
        })
      ).json(),
    );
    expect(
      (await api(`/api/groups/${flat.id}/participants/${tmp.id}`, { cookie: bo, method: "DELETE" }))
        .status,
    ).toBe(403);
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${tmp.id}`, {
          cookie: ana,
          method: "DELETE",
        })
      ).status,
    ).toBe(204);

    const group = GroupDetailSchema.parse(
      await (await api(`/api/groups/${flat.id}`, { cookie: cy })).json(),
    );
    const me = group.participants.find((p) => p.isMe)!;
    const owner = group.participants.find((p) => p.role === "owner")!;
    expect(
      (await api(`/api/groups/${flat.id}/participants/${me.id}`, { cookie: ana, method: "DELETE" }))
        .status,
    ).toBe(409); // member, not placeholder
    expect(
      (await api(`/api/groups/${flat.id}/participants/${me.id}`, { cookie: cy, method: "DELETE" }))
        .status,
    ).toBe(204); // leave
    expect((await api(`/api/groups/${flat.id}`, { cookie: cy })).status).toBe(404);
    expect(
      (
        await api(`/api/groups/${flat.id}/participants/${owner.id}`, {
          cookie: ana,
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
  });

  it("soft-deletes a group so it disappears for everyone", async () => {
    expect((await api(`/api/groups/${flat.id}`, { cookie: bo, method: "DELETE" })).status).toBe(
      403,
    );
    expect((await api(`/api/groups/${flat.id}`, { cookie: ana, method: "DELETE" })).status).toBe(
      204,
    );
    expect((await api(`/api/groups/${flat.id}`, { cookie: ana })).status).toBe(404);
    const mine = GroupListResponseSchema.parse(
      await (await api("/api/groups", { cookie: ana })).json(),
    );
    expect(mine.groups).toEqual([]);
  });
});
