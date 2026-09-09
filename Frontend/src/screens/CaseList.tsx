/**
 * Every case the signed-in employee may see.
 *
 * Stage 3B: the rows come from `GET /api/cases`, which applies the scope rule
 * in SQL. THE FILTERING IS NOT DONE HERE ANY MORE, and that is the change that
 * matters. The old version fetched every case in the browser's store and hid
 * the ones the user should not see — a filter anyone could step around by
 * opening devtools. Now a Telecaller's request returns their own cases and
 * nothing else; there is nothing on the wire to hide.
 *
 * The stage and owner selects still filter client-side, over the rows the
 * server already decided this person may have. Those are conveniences, not
 * boundaries.
 *
 * Document progress is back (Stage 3C), from `GET /api/cases`'s `progress`
 * field — `Backend/requirements.ts`'s `caseListProgress`, computed from real
 * `document_requirement` rows, not the prototype's local store. A case whose
 * requirements have not been generated yet (never opened past Documents
 * Pending) correctly shows "Not started" rather than a wrong number.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CASE_STAGES, CASE_STAGE_LABELS, type CaseStage } from "@domain/case/stages.js";

import { useReference, useUsers } from "../api/catalogue.js";
import { useApiQuery } from "../api/hooks.js";
import type { ApiCase } from "../api/types.js";
import { lakhs, when } from "../lib.js";
import { useSession } from "../session.js";
import {
  Badge,
  Button,
  Card,
  Empty,
  ProgressBar,
  Select,
  StageBadge,
  TABLE_ROW,
  Table,
  Td,
  Th,
  cx,
} from "../ui/index.js";

/** Recognises a `?stage=` value from a dashboard link as a real `CaseStage`,
 * so an unrecognised or missing value falls back to the screen's own default
 * rather than silently matching nothing. */
function isCaseStage(value: string): value is CaseStage {
  return (CASE_STAGES as readonly string[]).includes(value);
}

export function CaseList(): ReactNode {
  const session = useSession();
  const cases = useApiQuery<readonly ApiCase[]>("/cases");
  const reference = useReference();
  const users = useUsers();
  const [searchParams] = useSearchParams();

  // Initial values only — read once from a dashboard link (Active cases,
  // Pipeline, Team), same as CaseDetail's own `?tab=`. The <Select> controls
  // below remain the everyday way to change them; this just makes the
  // screen's existing stage/owner filters addressable by URL instead of
  // adding a second, parallel filtering system.
  const [stage, setStage] = useState<CaseStage | "all" | "active">(() => {
    const requested = searchParams.get("stage");
    if (requested === "all" || requested === "active") return requested;
    if (requested && isCaseStage(requested)) return requested;
    return "active";
  });
  const [owner, setOwner] = useState<string>(() => searchParams.get("owner") ?? "all");

  // "New leads" on the Founders Dashboard means "created within N days" —
  // cross-stage, so it is not one of the CaseStage values above. Read once,
  // same as stage/owner; there is no <Select> for it because nothing on this
  // screen offers to change it after arrival.
  const createdWithinDays = useMemo(() => {
    const raw = Number(searchParams.get("createdWithinDays"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [searchParams]);

  const seesEverything = session.can("case.read", "all");

  const filtered = useMemo(() => {
    const createdCutoff = createdWithinDays !== null ? Date.now() - createdWithinDays * 86400000 : null;
    return (cases.data ?? [])
      .filter((c) => {
        if (stage === "active") return c.stage !== "closed" && c.stage !== "lost";
        if (stage === "all") return true;
        return c.stage === stage;
      })
      .filter((c) => owner === "all" || c.ownerUserId === owner)
      .filter((c) => createdCutoff === null || new Date(c.createdAt).getTime() >= createdCutoff);
  }, [cases.data, stage, owner, createdWithinDays]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cases</h1>
          <p className="mt-1 text-sm text-ink-500">
            {seesEverything
              ? "Every case."
              : "Cases you own. A colleague's cases are not yours to browse."}
            {createdWithinDays !== null && ` Created in the last ${createdWithinDays} days.`}
          </p>
        </div>

        <div className="flex items-end gap-2">
          <Select
            value={stage}
            onChange={(event) => setStage(event.target.value as CaseStage | "all" | "active")}
            className="w-48"
          >
            {/* Early-stage cases are numerous and mostly empty (ADR-008), so the
                default hides the dead ones rather than making the list noise. */}
            <option value="active">Active only</option>
            <option value="all">Everything, including lost</option>
            {CASE_STAGES.map((value) => (
              <option key={value} value={value}>
                {CASE_STAGE_LABELS[value]}
              </option>
            ))}
          </Select>

          {seesEverything && (
            <Select
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className="w-48"
            >
              <option value="all">Any owner</option>
              {users.activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </Select>
          )}

          {session.can("case.create", "all") && (
            <Link to="/cases/new">
              <Button variant="primary">New case</Button>
            </Link>
          )}
        </div>
      </div>

      <Card>
        {cases.loading ? (
          <Empty>Loading cases…</Empty>
        ) : cases.error ? (
          <Empty>{cases.error.message}</Empty>
        ) : filtered.length === 0 ? (
          <Empty>
            {(cases.data ?? []).length === 0
              ? "You cannot see any cases with the permissions this user holds."
              : "No cases match this filter."}
          </Empty>
        ) : (
          <Table className="min-w-4xl">
            <thead>
              <tr className="border-b border-ink-150 text-left">
                <Th>Case</Th>
                <Th>Applicant</Th>
                <Th>Product</Th>
                <Th align="right">Amount</Th>
                <Th>Stage</Th>
                <Th>Documents</Th>
                <Th>Owner</Th>
                <Th>Opened</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((loanCase) => (
                <tr key={loanCase.id} className={cx(TABLE_ROW, loanCase.isOnHold && "opacity-70")}>
                  <Td>
                    <Link to={`/cases/${loanCase.id}`} className="tnum font-medium text-ink-900 hover:underline">
                      {loanCase.caseNumber}
                    </Link>
                    {loanCase.isPractice && (
                      <span className="ml-2">
                        <Badge tone="neutral" title="For testing/training only — excluded from every report and dashboard tile">
                          Practice
                        </Badge>
                      </span>
                    )}
                    {loanCase.isOnHold && (
                      <span className="ml-2">
                        <Badge tone="warn">Hold</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    {loanCase.applicantId ? (
                      <Link to={`/people/${loanCase.applicantId}`} className="hover:underline">
                        {loanCase.applicantName}
                      </Link>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </Td>
                  <Td muted>{reference.productLabel(loanCase.loanProductId)}</Td>
                  <Td align="right" className="tnum">
                    {lakhs(loanCase.requestedAmount ?? undefined)}
                  </Td>
                  <Td>
                    <StageBadge stage={loanCase.stage} label={CASE_STAGE_LABELS[loanCase.stage]} />
                  </Td>
                  <Td className="w-40">
                    {loanCase.progress ? (
                      <ProgressBar
                        percent={loanCase.progress.percentComplete}
                        applicable={loanCase.progress.applicableCount}
                      />
                    ) : (
                      <span className="text-xs text-ink-400">—</span>
                    )}
                  </Td>
                  <Td muted>{users.ownerName(loanCase.ownerUserId)}</Td>
                  <Td muted>{when(loanCase.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
