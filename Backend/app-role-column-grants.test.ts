/**
 * `aos_app` can read every column of a column-masked table except the masked one.
 *
 * Migration 0034 (ADR-026) revoked table-wide SELECT on `person_identifier`,
 * `referrer_profile` and `submission` and re-granted it column by column for the
 * columns that existed then. A column added later therefore has no grant, and the
 * first query that reads it fails with "permission denied for table ..." under
 * `aos_app` while passing for the superuser the rest of the suite connects as.
 * That is how migration 0045's new `submission` columns broke Log a Case.
 *
 * This reads the privileges themselves, so it fails in the migration that adds
 * the column, not in production.
 */

import { afterAll, describe, expect, it } from "vitest";

import { pool } from "./db.js";

/** Each masked table and the one column `aos_app` must not read (0034). */
const MASKED_COLUMN: Readonly<Record<string, string>> = {
  person_identifier: "value_raw",
  referrer_profile: "commission_terms",
  submission: "login_fee_amount",
};

afterAll(async () => {
  await pool.end();
});

describe("aos_app column grants on the masked tables", () => {
  it.each(Object.entries(MASKED_COLUMN))("%s: every column but %s is readable", async (table, masked) => {
    const { rows } = await pool.query<{ column_name: string; readable: boolean }>(
      `select column_name, has_column_privilege('aos_app', format('public.%I', table_name), column_name, 'select') as readable
         from information_schema.columns
        where table_schema = 'public' and table_name = $1`,
      [table],
    );
    expect(rows.length, `${table} has no columns: wrong name?`).toBeGreaterThan(0);

    expect(rows.filter((c) => !c.readable && c.column_name !== masked).map((c) => c.column_name), "unreadable").toEqual([]);
    expect(rows.find((c) => c.column_name === masked)?.readable, `${masked} must stay masked`).toBe(false);
  });
});
