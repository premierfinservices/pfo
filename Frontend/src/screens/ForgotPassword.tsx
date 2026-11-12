/**
 * The two "forgot password" forms (ADR-052), shown inside the login card.
 *
 * `ForgotPasswordForm` asks for a username. The server mails a one-time link to
 * the office mailbox, not to the employee, and answers the same whether or not
 * the username exists, so this form only ever shows what the server said.
 *
 * `ResetPasswordForm` is where that link lands (`/#/reset-password?token=...`).
 * The token stays in the address fragment, which the browser never sends to a
 * server, so it is in no request log.
 */

import { useState, type FormEvent, type ReactNode } from "react";

import { api } from "../api/client.js";
import { Button, Field, Input } from "../ui/index.js";

import { MIN_PASSWORD_LENGTH } from "./change-password.js";

export function ForgotPasswordForm({ onBack }: { onBack: () => void }): ReactNode {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await api<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: { username: username.trim() },
        anonymous: true,
      });
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the reset request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (message) {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-ink-700" role="status">
          {message}
        </p>
        <Button variant="primary" className="w-full justify-center" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-sm text-ink-600">
        Enter your username. A reset link goes to the office mailbox, and a manager passes it on to you.
      </p>
      <Field label="Username / Employee ID">
        <Input
          autoFocus
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={submitting}
        />
      </Field>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full justify-center" disabled={submitting || !username.trim()}>
        {submitting ? "Sending…" : "Send reset link"}
      </Button>
      <Button type="button" variant="ghost" className="w-full justify-center" onClick={onBack} disabled={submitting}>
        Back to sign in
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token, onFinished }: { token: string; onFinished: () => void }): ReactNode {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`A password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password }, anonymous: true });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reset the password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-ink-700" role="status">
          Your password has been changed. Sign in with the new one.
        </p>
        <Button variant="primary" className="w-full justify-center" onClick={onFinished}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <Field label="New password">
        <Input
          autoFocus
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />
      </Field>
      <Field label="Type it again">
        <Input
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
        />
      </Field>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full justify-center" disabled={submitting || !password || !confirm}>
        {submitting ? "Saving…" : "Set new password"}
      </Button>
      <Button type="button" variant="ghost" className="w-full justify-center" onClick={onFinished} disabled={submitting}>
        Back to sign in
      </Button>
    </form>
  );
}
