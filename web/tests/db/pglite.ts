/**
 * An in-process Postgres (PGlite) with every migration in `supabase/migrations` applied,
 * for testing database functions, triggers, and row-level security without a Supabase
 * project. Supabase's own objects are stubbed: the `anon` and `authenticated` roles, an
 * `auth.users` table, and `auth.uid()` reading the `request.jwt.claim.sub` setting, which
 * `asUser` sets the way PostgREST does for a signed-in request.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

export async function migratedDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(MIGRATIONS + file, "utf8"));
  }
  return db;
}

/** Inserts a user into the stubbed `auth.users`; the signup trigger creates the profile. */
export async function createUser(db: PGlite): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [id]);
  return id;
}

/**
 * Runs `fn` in a transaction as the `authenticated` role with `auth.uid()` = `userId`, so
 * row-level security applies as it does for the web app. The transaction rolls back when
 * `fn` throws.
 */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}
