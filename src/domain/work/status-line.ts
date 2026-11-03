/**
 * The line beside a case's stage badge: where the case really is with the lenders.
 *
 * The stage moves only on a person's answer or a lender's update (ADR-040), so a
 * case emailed to a lender still reads "Documents Pending". This line is
 * computed from the applications and never changes the stage, never closes or
 * loses a case, and says nothing when no lender holds the file. Pure.
 */

export interface StatusLineApplication {
  readonly bank: string | null;
  readonly status: string;
  /** When the file went to the lender (ISO date or timestamp). */
  readonly sentAt: string | null;
  readonly loginDate: string | null;
}

export interface StatusLineInput {
  readonly stage: string;
  readonly isOnHold: boolean;
  readonly applications: readonly StatusLineApplication[];
}

/** Furthest along first. Statuses not listed (not sent, rejected, withdrawn, not eligible) hold no file. */
const PROGRESS = [
  "disbursed",
  "sanction_accepted",
  "sanctioned",
  "eligibility_received",
  "query_raised",
  "under_process",
  "login_completed",
  "submitted",
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(value: string | null): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  const month = match ? Number(match[2]) - 1 : -1;
  return match && month >= 0 && month < 12 ? `${Number(match[3])} ${MONTHS[month]}` : "";
}

function phrase(app: StatusLineApplication): string {
  const bank = app.bank ?? "a lender";
  const sent = shortDate(app.sentAt);
  switch (app.status) {
    case "submitted":
      return `Sent to ${bank}${sent ? ` ${sent}` : ""}, waiting for login`;
    case "login_completed": {
      const login = shortDate(app.loginDate);
      return `Logged in at ${bank}${login ? ` ${login}` : ""}`;
    }
    case "under_process":
      return `Under process at ${bank}`;
    case "query_raised":
      return `${bank} has raised a query`;
    case "eligibility_received":
      return `${bank} has given eligibility`;
    case "sanctioned":
      return `Sanctioned by ${bank}`;
    case "sanction_accepted":
      return `Sanction from ${bank} accepted`;
    default:
      return `Disbursed by ${bank}`;
  }
}

export function deriveStatusLine(input: StatusLineInput): string | null {
  if (input.stage === "lost" || input.stage === "closed") return null;
  const active = input.applications
    .filter((app) => (PROGRESS as readonly string[]).includes(app.status))
    .sort((a, b) => PROGRESS.indexOf(a.status as (typeof PROGRESS)[number]) - PROGRESS.indexOf(b.status as (typeof PROGRESS)[number]));
  const lead = active[0];
  if (!lead) return input.isOnHold ? "On hold" : null;
  const others = active.length - 1;
  const line = `${phrase(lead)}${others > 0 ? ` (and ${others} other lender${others === 1 ? "" : "s"})` : ""}`;
  return input.isOnHold ? `On hold. ${line}` : line;
}
