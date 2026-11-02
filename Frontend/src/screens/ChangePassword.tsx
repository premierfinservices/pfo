/**
 * Change my password — any signed-in employee, for their own account.
 *
 * `POST /api/auth/password` (`changeOwnPassword`, Backend/users.ts) checks the
 * current password, enforces the minimum, ends every OTHER session of this
 * user and keeps this one. So after a successful change the user stays signed
 * in here, and a stolen session elsewhere is cut off.
 *
 * No permission gate: changing your own password is not an administrative act.
 * The password is sent as typed over the app's own origin and hashed by the
 * server, the same as the manager-side reset in UserManagement.
 */

import { useState, type ReactNode } from "react";

import { api } from "../api/client.js";
import { useMutation } from "../api/hooks.js";
import { Button, Card, Field, Input, useToast } from "../ui/index.js";

import { passwordFormProblem } from "./change-password.js";

export function ChangePassword(): ReactNode {
  const toast = useToast();
  const mutation = useMutation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const found = passwordFormProblem({ current, next, confirm });
    setProblem(found);
    if (found) return;

    const result = await mutation.run(() =>
      api<{ ok: true }>("/auth/password", {
        method: "POST",
        body: { currentPassword: current, newPassword: next },
      }),
    );
    if (result) {
      toast.show("Password changed. Your other sign-ins have been ended.", "good");
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  }

  const message = problem ?? mutation.error;

  return (
    <div className="mx-auto max-w-md">
      <Card title="Change my password" subtitle="Use something only you know. At least 8 characters.">
        <form
          className="space-y-3 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Current password">
            <Input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
          <Field label="New password again">
            <Input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
          {message && (
            <p role="alert" className="text-sm text-red-700">
              {message}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={mutation.pending}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
