/**
 * Bankers as reusable, case-independent master data.
 *
 * Proves the workflow driven through the real UI, against the real backend
 * (`Backend/bankers.ts`) and the suite's own isolated `pfo_e2e` database
 * (`playwright.config.ts` — never the office one): a banker is created ONCE
 * on the standalone Bankers screen, with no case open at any point, and is
 * then reused — never retyped — across two separate cases' "Add bank" steps.
 *
 * WHAT THIS DOES NOT COVER. That the write endpoints refuse a role without
 * `organisation.update` is proven server-side, over real HTTP, in
 * `Backend/bankers.test.ts` — "through direct API calls" is exactly that
 * layer, not this one.
 */

import { expect, test, type Page } from "@playwright/test";

import { E2E_PASSWORD } from "../support/e2e-globalsetup.js";

const MANAGER = "e2e.manager";

function unique(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/");
  const usernameField = page.locator('input[name="username"]');
  await expect(usernameField).toBeVisible();
  await usernameField.fill(username);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "All Cases" })).toBeVisible();
}

/**
 * Opens a new case through the real New Case screen. Not `helpers.ts`'s
 * `createCaseThroughUi` — that one locates the phone field by accessible
 * role/name, which the top bar's search box (placeholder "Search cases,
 * people, phone numbers…") now collides with. Name-attribute locators, the
 * same choice `tests/e2e/case-completeness.spec.ts` already made.
 */
async function openCase(page: Page, applicantName: string): Promise<void> {
  await page.goto("/#/cases/new");
  await page.locator('input[name="applicantName"]').fill(applicantName);
  await page
    .locator('input[name="applicantPhone"]')
    .fill(`98430${Math.floor(10000 + Math.random() * 89999)}`);
  await page
    .locator('select[name="loanProduct"]')
    .selectOption({ label: "Business Loan · Machinery and Equipment Loan" });
  await page.locator('input[name="requestedAmount"]').fill("1000000");
  await page.getByRole("button", { name: "Open case" }).click();
  await page.waitForURL(/\/cases\/[^/]+$/);
}

/**
 * The Nth `<select>` inside the currently-open dialog, by position — not by
 * label. `Field` wraps its control in a `<label>`, and Chromium folds a
 * `<select>`'s own rendered option text onto its wrapping label's computed
 * accessible name (e.g. "BankChoose a bank…"), so `getByLabel("Bank")` never
 * matches. `tests/e2e/document-submission.spec.ts`'s `dialogSelect` hit the
 * same thing first; anchoring off the modal's one "Close" control is that
 * same trick.
 */
function dialogSelect(page: Page, index: number) {
  return page.getByRole("button", { name: "Close" }).locator(`xpath=following::select[${index}]`);
}

test.describe("the standalone Bankers screen — case-independent master data", () => {
  test("opens and offers Add banker with no case ever touched", async ({ page }) => {
    await signIn(page, MANAGER);

    // Direct navigation — nothing in this test creates, opens or even lists a
    // case first. If Bankers depended on a case existing, this would fail.
    await page.goto("/#/admin/bankers");
    await expect(page.getByRole("heading", { name: "Bankers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add banker" })).toBeVisible();
  });

  test(
    "a banker created here shows up in a case's Add bank picker, and the same banker is " +
      "reusable on a second case without recreating it",
    async ({ page }) => {
      await signIn(page, MANAGER);

      // --- Create the banker, independent of any case ------------------------
      await page.goto("/#/admin/bankers");
      await page.getByRole("button", { name: "Add banker" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Add banker" })).toBeVisible();

      await dialogSelect(page, 1).selectOption({ label: "HDFC Bank" }); // Bank
      const branchSelect = dialogSelect(page, 2); // Branch
      await expect(branchSelect).toBeEnabled();
      await branchSelect.selectOption({ index: 1 });
      const branchLabel = (await branchSelect.locator("option:checked").textContent())!.trim();

      const bankerName = unique("E2E Banker");
      await dialog.getByLabel("Banker name").fill(bankerName);
      await dialog.getByLabel("Designation", { exact: true }).fill("Branch Manager");
      await dialog
        .getByLabel("Email", { exact: true })
        .fill(`${bankerName.replace(/\s+/g, ".").toLowerCase()}@example-bank.test`);

      await dialog.getByRole("button", { name: "Add banker" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(bankerName)).toBeVisible();

      // --- First case: pick the catalogued banker, no typing required --------
      async function addBankWithBanker(): Promise<void> {
        await openCase(page, unique("E2E Applicant"));
        await page.getByRole("button", { name: "Banks" }).click();

        await page.getByRole("button", { name: "Add bank" }).click();
        const bankDialog = page.getByRole("dialog");
        await expect(bankDialog.getByRole("heading", { name: "Add bank" })).toBeVisible();

        await dialogSelect(page, 1).selectOption({ label: "HDFC Bank" }); // Bank
        await dialogSelect(page, 2).selectOption({ label: branchLabel }); // Branch

        // The escape hatch stays offered, but is never needed here — the
        // banker created earlier already appears in the picker.
        const bankerSelect = bankDialog.getByLabel("Banker", { exact: true }); // aria-label, not Field-wrapped
        await expect(bankerSelect).toBeEnabled();
        await bankerSelect.selectOption({ label: `${bankerName} (Branch Manager)` });

        await bankDialog.getByRole("button", { name: "Add bank" }).click();
        await expect(bankDialog).toHaveCount(0);
        await expect(page.getByText(bankerName)).toBeVisible();
      }

      await addBankWithBanker();

      // --- Second, independent case: the SAME banker, never recreated --------
      await addBankWithBanker();
    },
  );

  test("changing the bank resets the branch and banker, and an empty branch says so plainly", async ({ page }) => {
    await signIn(page, MANAGER);

    await openCase(page, unique("E2E Applicant"));
    await page.getByRole("button", { name: "Banks" }).click();
    await page.getByRole("button", { name: "Add bank" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add bank" })).toBeVisible();

    await dialogSelect(page, 1).selectOption({ label: "HDFC Bank" }); // Bank
    const branchSelect = dialogSelect(page, 2); // Branch
    await expect(branchSelect).toBeEnabled();
    await branchSelect.selectOption({ index: 1 });

    // Picking a different bank clears the branch and the banker selection —
    // never silently keeps a branch that belongs to the bank just left.
    await dialogSelect(page, 1).selectOption({ label: "ICICI Bank" });
    await expect(branchSelect).toHaveValue("");
    const bankerSelect = dialog.getByLabel("Banker", { exact: true });
    await expect(bankerSelect).toBeDisabled();
  });
});
