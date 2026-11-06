/**
 * Under the top bar, for whoever may see office-wide reports: the MIS sync has
 * failed or stopped (ADR-047). The server decides what to say; this only shows it.
 */

import type { ReactNode } from "react";

import { useApiQuery } from "../api/hooks.js";

export function SyncWarning(): ReactNode {
  const status = useApiQuery<{ warning: string | null }>("/work/sync-status");
  const warning = status.data?.warning;
  if (!warning) return null;
  return (
    <div className="border-b border-red-200 bg-red-50" role="alert">
      <p className="mx-auto w-full max-w-7xl px-4 py-2 text-sm font-medium text-red-900">{warning}</p>
    </div>
  );
}
