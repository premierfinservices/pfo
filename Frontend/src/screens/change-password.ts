/**
 * The checks the "Change my password" form makes before it bothers the server.
 *
 * Only the server is the authority (`changeOwnPassword` in Backend/users.ts
 * enforces the minimum and verifies the current password). These exist so a
 * typo in the confirmation box is caught without a round trip, and so a user
 * is not told "changed" for a new password identical to the old one. The
 * minimum mirrors the server's MIN_PASSWORD_LENGTH; if they ever drift the
 * server's message still wins, because the form shows whatever it sends back.
 */

export const MIN_PASSWORD_LENGTH = 8;

export function passwordFormProblem(input: {
  readonly current: string;
  readonly next: string;
  readonly confirm: string;
}): string | null {
  if (!input.current) return "Enter your current password.";
  if (input.next.length < MIN_PASSWORD_LENGTH) {
    return `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (input.next === input.current) return "Choose a password different from your current one.";
  if (input.next !== input.confirm) return "The two new passwords do not match.";
  return null;
}
