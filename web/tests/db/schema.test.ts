import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createUser, migratedDb } from "./pglite";

let db: PGlite;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await migratedDb();
  alice = await createUser(db);
  bob = await createUser(db);
}, 60_000);

describe("migrated schema", () => {
  it("creates a profile for each new user", async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.profiles where id = $1", [alice]);
    expect(rows).toHaveLength(1);
  });

  it("keeps each user's tracks private", async () => {
    await asUser(db, alice, (tx) => tx.query("insert into public.tracks (title, duration_seconds) values ('Moth', 400)"));
    const own = await asUser(db, alice, (tx) => tx.query("select title from public.tracks"));
    const other = await asUser(db, bob, (tx) => tx.query("select title from public.tracks"));
    expect(own.rows).toEqual([{ title: "Moth" }]);
    expect(other.rows).toEqual([]);
  });
});
