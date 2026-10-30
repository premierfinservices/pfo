/**
 * The database's `role_permission` must be exactly what `roles.ts` says.
 *
 * `seed.test.ts` proves migration 0008 matches `roles.ts`, but 0008 is applied
 * and frozen: a grant added later arrives in a newer migration, which that
 * snapshot cannot see. This reads the migrated database itself, so a grant that
 * was added to `roles.ts` and never migrated (or the reverse) fails here instead
 * of showing up as a 403 for one role in production.
 */

import { afterAll, describe, expect, it } from "vitest";

import { ROLES, ROLE_GRANTS } from "@domain/permissions/index.js";

import { pool } from "./db.js";

afterAll(async () => {
  await pool.end();
});

describe("role grants in the database", () => {
  it("are exactly the grants in roles.ts, for every role", async () => {
    const { rows } = await pool.query<{ role: string; permission: string; scope: string }>(
      `select role::text, permission, scope::text from role_permission`,
    );
    const inDatabase = new Set(rows.map((row) => `${row.role} ${row.permission} ${row.scope}`));
    const inCode = new Set(
      ROLES.flatMap((role) => ROLE_GRANTS[role].map((grant) => `${role} ${grant.permission} ${grant.scope}`)),
    );

    expect([...inCode].filter((grant) => !inDatabase.has(grant)).sort(), "in roles.ts, not migrated").toEqual([]);
    expect([...inDatabase].filter((grant) => !inCode.has(grant)).sort(), "migrated, not in roles.ts").toEqual([]);
  });
});
