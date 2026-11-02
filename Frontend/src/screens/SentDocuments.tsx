/**
 * Which documents went to one lender, and which did not, by name.
 *
 * Reads the same two things the Send tab already reads (the lender's packages
 * and what the case can send) and shows them as two lists. "Not sent" always
 * says why: its email failed, it was never put in an email, or it cannot be
 * sent at all. The rule lives in `@domain/submissions/sent-documents`.
 */

import { useMemo, type ReactNode } from "react";

import { sentDocumentReport } from "@domain/submissions/sent-documents.js";

import { useApiQuery } from "../api/hooks.js";
import type { ApiPackage, ApiSendableDocument } from "../api/types.js";
import { Badge, Empty } from "../ui/index.js";

export function SentDocuments({
  caseId,
  submissionId,
  bank,
}: {
  caseId: string;
  submissionId: string;
  bank: string;
}): ReactNode {
  const base = `/cases/${caseId}/submissions/${submissionId}`;
  const packages = useApiQuery<readonly ApiPackage[]>(`${base}/packages`);
  const offered = useApiQuery<readonly ApiSendableDocument[]>(`${base}/sendable-documents`);

  const report = useMemo(() => {
    if (!packages.data || !offered.data) return null;
    return sentDocumentReport(
      packages.data,
      offered.data.map((d) => ({
        documentId: d.documentId,
        fileName: d.fileName,
        label: d.label,
        blockedBecause: d.blockedBecause,
      })),
    );
  }, [packages.data, offered.data]);

  if (packages.loading || offered.loading) return <Empty>Checking what went to {bank}…</Empty>;
  if (packages.error || offered.error || !report) {
    return <Empty>{packages.error?.message ?? offered.error?.message ?? "Could not check what was sent."}</Empty>;
  }

  const total = report.sent.length + report.notSent.length;

  return (
    <div className="aos-animate-in space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-ink-900">
        <span className="font-medium">
          {report.sent.length} of {total} documents sent to {bank}
        </span>
        {report.notSent.length === 0 ? (
          <Badge tone="good">All sent</Badge>
        ) : report.anySent ? (
          <Badge tone="warn">{report.notSent.length} not sent</Badge>
        ) : (
          <Badge tone="warn">Nothing sent yet</Badge>
        )}
      </p>

      {report.notSent.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wide text-red-700 uppercase">Not sent</p>
          <ul className="divide-y divide-ink-100 rounded-md ring-1 ring-red-200">
            {report.notSent.map((d) => (
              <li key={d.documentId} className="flex flex-wrap items-baseline justify-between gap-x-3 bg-red-50/40 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="text-ink-900">{d.label}</span>
                  <span className="block truncate text-xs text-ink-500" title={d.fileName}>
                    {d.fileName}
                  </span>
                </span>
                <span className="text-xs text-red-700">{d.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.sent.length > 0 && (
        <details className="rounded-md ring-1 ring-ink-150">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold tracking-wide text-ink-600 uppercase">
            Sent ({report.sent.length})
          </summary>
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {report.sent.map((d) => (
              <li key={d.documentId} className="truncate px-3 py-1 text-xs text-ink-700" title={d.fileName}>
                {d.fileName}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
