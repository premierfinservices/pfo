/**
 * Lenders: the office's real lender list, read-only (ADR-050).
 *
 * Until 6 Nov 2026 this screen showed a per-browser prototype dataset
 * (`Frontend/src/fake/`), so managers browsing Settings saw made-up lenders
 * while cases used the real ones. It now reads `GET /api/lenders`, the same list
 * Send to lenders offers. Bankers are kept on the Bankers screen.
 */

import { useMemo, useState, type ReactNode } from "react";

import { useLenders } from "../api/lenders.js";
import { Badge, Card, Empty, Input } from "../ui/index.js";

export function LenderCatalogue(): ReactNode {
  const lenders = useLenders();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return lenders.lenders.filter((lender) => {
      const text = [lender.name, lender.lenderType ?? "", ...lender.branches.map((b) => `${b.name} ${b.city ?? ""}`)]
        .join(" ")
        .toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [lenders.lenders, search]);

  if (lenders.loading) return <Empty>Loading lenders…</Empty>;
  if (lenders.error) return <Empty>{lenders.error.message}</Empty>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Lenders</h1>
        <p className="mt-1 text-sm text-ink-500">
          The lenders Send to lenders offers, with their branches and bankers. Bankers are added on the Bankers screen.
        </p>
      </div>
      <Input
        placeholder="Search by lender, branch or city"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-md"
      />
      <Card title={`${visible.length} of ${lenders.lenders.length} lenders`}>
        {visible.length === 0 ? (
          <Empty>No lender matches.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100">
            {visible.map((lender) => (
              <li key={lender.id} className="py-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left"
                  onClick={() => setOpen(open === lender.id ? null : lender.id)}
                >
                  <span className="text-sm font-medium text-ink-900">{lender.name}</span>
                  {lender.lenderType && <Badge>{lender.lenderType}</Badge>}
                  <span className="ml-auto text-xs text-ink-500">
                    {lender.branches.length} branch{lender.branches.length === 1 ? "" : "es"}
                  </span>
                </button>
                {open === lender.id && (
                  <ul className="mt-2 space-y-2 pl-4 text-sm">
                    {lender.branches.length === 0 && <li className="text-ink-500">No branch on file.</li>}
                    {lender.branches.map((branch) => (
                      <li key={branch.id}>
                        <p className="text-ink-800">
                          {branch.name}
                          {branch.city ? `, ${branch.city}` : ""}
                        </p>
                        {branch.contacts.length > 0 && (
                          <ul className="text-xs text-ink-500">
                            {branch.contacts.map((contact) => (
                              <li key={contact.id}>
                                {contact.name ?? "Unnamed"}
                                {contact.designation ? `, ${contact.designation}` : ""}
                                {contact.workEmail ? ` · ${contact.workEmail}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
