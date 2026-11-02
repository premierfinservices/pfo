import { describe, expect, it } from "vitest";

import { passwordFormProblem } from "./change-password.js";

describe("passwordFormProblem", () => {
  const ok = { current: "old-secret", next: "new-secret-1", confirm: "new-secret-1" };

  it("accepts a valid change", () => {
    expect(passwordFormProblem(ok)).toBeNull();
  });

  it("requires the current password", () => {
    expect(passwordFormProblem({ ...ok, current: "" })).toMatch(/current password/);
  });

  it("rejects a new password shorter than eight characters", () => {
    expect(passwordFormProblem({ ...ok, next: "short", confirm: "short" })).toMatch(/at least 8/);
  });

  it("rejects a new password equal to the current one", () => {
    expect(
      passwordFormProblem({ current: "same-secret", next: "same-secret", confirm: "same-secret" }),
    ).toMatch(/different/);
  });

  it("rejects a confirmation that does not match", () => {
    expect(passwordFormProblem({ ...ok, confirm: "new-secret-2" })).toMatch(/do not match/);
  });
});
