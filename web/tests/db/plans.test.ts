import { randomUUID } from "node:crypto";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createUser, migratedDb } from "./pglite";

let db: PGlite;
let alice: string;
let bob: string;
let trackId: string;

const item = (position: number, track: string) => ({
  position,
  occurrence_id: `o${position}`,
  track_id: track,
  entry_cue_id: null,
  exit_cue_id: null,
  play_start_seconds: 0,
  play_end_seconds: 200,
  elapsed_start_seconds: position * 200,
});

function createPlan(tx: Transaction, items: unknown[], crateId: string | null = null) {
  return tx.query<{ id: string }>(
    "select public.create_plan($1, 'dj', 'use_all', $2, $3, $4, $5) as id",
    ["Friday", crateId, { candidateTrackIds: [] }, { version: 1 }, JSON.stringify(items)],
  );
}

const count = async (table: string, owner: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where owner_id = $1`, [owner])).rows[0]!.n;

beforeAll(async () => {
  db = await migratedDb();
  alice = await createUser(db);
  bob = await createUser(db);
  const { rows } = await asUser(db, alice, (tx) =>
    tx.query<{ id: string }>("insert into public.tracks (title, duration_seconds) values ('Moth', 400) returning id"),
  );
  trackId = rows[0]!.id;
}, 60_000);

describe("create_plan", () => {
  it("saves the plan and its items together", async () => {
    const { rows } = await asUser(db, alice, (tx) => createPlan(tx, [item(0, trackId), item(1, trackId)]));
    const planId = rows[0]!.id;
    const plan = await db.query<{ name: string; edited: boolean; owner_id: string }>("select name, edited, owner_id from public.plans where id = $1", [planId]);
    expect(plan.rows).toEqual([{ name: "Friday", edited: false, owner_id: alice }]);
    const items = await db.query<{ position: number }>("select position from public.plan_items where plan_id = $1 order by position", [planId]);
    expect(items.rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("saves nothing when an item cannot be inserted", async () => {
    const before = await count("plans", alice);
    await expect(asUser(db, alice, (tx) => createPlan(tx, [item(0, trackId), item(1, randomUUID())]))).rejects.toThrow();
    expect(await count("plans", alice)).toBe(before);
  });

  it("does not let a user place another user's track or crate in a plan", async () => {
    await expect(asUser(db, bob, (tx) => createPlan(tx, [item(0, trackId)]))).rejects.toThrow();
    const { rows } = await asUser(db, alice, (tx) => tx.query<{ id: string }>("insert into public.crates (name) values ('Warmup') returning id"));
    await expect(asUser(db, bob, (tx) => createPlan(tx, [], rows[0]!.id))).rejects.toThrow();
    expect(await count("plans", bob)).toBe(0);
  });
});
