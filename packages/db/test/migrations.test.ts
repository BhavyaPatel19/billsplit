import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations, schema, type DbHandle } from "../src/index.js";

let container: StartedPostgreSqlContainer;
let handle: DbHandle;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await runMigrations(container.getConnectionUri());
  handle = createDb({ connectionString: container.getConnectionUri(), max: 2 });
});

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

describe("migrations", () => {
  it("create every table", async () => {
    const rows = await handle.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = rows.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "sessions",
        "accounts",
        "verifications",
        "groups",
        "participants",
        "invites",
      ]),
    );
  });

  it("are idempotent", async () => {
    await expect(runMigrations(container.getConnectionUri())).resolves.toBeUndefined();
  });
});

describe("participants", () => {
  it("allow placeholders without a user and merge them later", async () => {
    const { db } = handle;
    const [user] = await db
      .insert(schema.users)
      .values({ id: "u_bhavya", name: "Bhavya", email: "bhavya@example.com" })
      .returning();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: "Flat 4B", createdBy: user!.id })
      .returning();

    const [owner] = await db
      .insert(schema.participants)
      .values({ groupId: group!.id, userId: user!.id, displayName: "Bhavya", role: "owner" })
      .returning();
    const [placeholder] = await db
      .insert(schema.participants)
      .values({ groupId: group!.id, displayName: "Rahul" })
      .returning();
    expect(placeholder!.userId).toBeNull();
    expect(placeholder!.role).toBe("member");

    // Rahul signs up and joins: the placeholder is merged into his new participant row.
    const [rahul] = await db
      .insert(schema.users)
      .values({ id: "u_rahul", name: "Rahul", email: "rahul@example.com" })
      .returning();
    const [joined] = await db
      .insert(schema.participants)
      .values({ groupId: group!.id, userId: rahul!.id, displayName: "Rahul" })
      .returning();
    await db
      .update(schema.participants)
      .set({ mergedIntoId: joined!.id })
      .where(eq(schema.participants.id, placeholder!.id));

    const active = await db
      .select({ name: schema.participants.displayName })
      .from(schema.participants)
      .where(isNull(schema.participants.mergedIntoId))
      .orderBy(schema.participants.displayName);
    expect(active.map((p) => p.name)).toEqual(["Bhavya", "Rahul"]);
    expect(owner!.role).toBe("owner");
  });

  it("reject a second active participant row for the same user in a group", async () => {
    const { db } = handle;
    const group = await db.query.groups.findFirst();
    await expect(
      db
        .insert(schema.participants)
        .values({ groupId: group!.id, userId: "u_bhavya", displayName: "Bhavya again" }),
    ).rejects.toMatchObject({ cause: { constraint: "participants_group_user_active_uidx" } });
  });

  it("cascade-delete with the group", async () => {
    const { db } = handle;
    const [g] = await db.insert(schema.groups).values({ name: "temp" }).returning();
    await db.insert(schema.participants).values({ groupId: g!.id, displayName: "x" });
    await db.insert(schema.invites).values({
      groupId: g!.id,
      code: "abc123",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.delete(schema.groups).where(eq(schema.groups.id, g!.id));
    const left = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.groupId, g!.id));
    expect(left).toHaveLength(0);
  });
});
