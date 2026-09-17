/**
 * Bankers — standalone, case-independent master data.
 *
 * A banker (`bank_contact`) belongs to a bank and a branch, and is created
 * here ONCE, independent of any case — whether zero cases exist, many exist,
 * or documents have or have not been received. The case-side "Add bank" flow
 * (`Frontend/src/screens/BanksTab.tsx`) only ever SELECTS a banker created
 * here; it never creates one, so a banker is never retyped case after case.
 *
 * Talks to the real backend (`Backend/bankers.ts`), not
 * `Frontend/src/fake/store.ts` — unlike `LenderCatalogue.tsx`, which stays a
 * read-only prototype screen and is untouched by this file. Filtering and
 * search are client-side, the same choice `LenderCatalogue` and `useLenders`
 * already make: the catalogue is small enough that a round trip per keystroke
 * would be pure overhead.
 */

import { useMemo, useState, type ReactNode } from "react";

import { api } from "../api/client.js";
import { useApiQuery, useMutation } from "../api/hooks.js";
import { useLenders } from "../api/lenders.js";
import type { ApiBanker, ApiLender } from "../api/types.js";
import { useSession } from "../session.js";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  PermissionCode,
  Select,
  useToast,
} from "../ui/index.js";

export function Bankers(): ReactNode {
  const session = useSession();
  const mayRead = session.can("organisation.read", "all");
  const mayManage = session.can("organisation.update", "all");

  const lenders = useLenders();
  const bankers = useApiQuery<readonly ApiBanker[]>(mayRead ? "/bankers" : null);

  const [bankFilter, setBankFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiBanker | null>(null);

  const branchesForFilter = useMemo(
    () => lenders.lenders.find((lender) => lender.id === bankFilter)?.branches ?? [],
    [lenders.lenders, bankFilter],
  );

  const visible = useMemo(() => {
    const rows = bankers.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((banker) => {
      if (bankFilter && banker.institutionOrganisationId !== bankFilter) return false;
      if (branchFilter && banker.branchOrganisationId !== branchFilter) return false;
      if (q === "") return true;
      const haystack = [banker.name, banker.designation, banker.workEmail, banker.workMobile]
        .filter((part): part is string => part !== null)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [bankers.data, bankFilter, branchFilter, search]);

  if (!mayRead) {
    return (
      <Card title="Bankers">
        <Empty>You do not have permission to see bankers.</Empty>
        <PermissionCode code="organisation.read" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Bankers</h1>
        <p className="mt-1 text-sm text-ink-500">
          Bank contacts used across cases. Add a banker once here, and every case's "Add bank" step
          can pick them from a list instead of typing them in again.
        </p>
      </div>

      <Card
        title={`${visible.length} of ${bankers.data?.length ?? 0} bankers`}
        actions={
          mayManage && (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add banker
            </Button>
          )
        }
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs font-medium text-ink-700">Bank</span>
              <Select
                value={bankFilter}
                onChange={(event) => {
                  setBankFilter(event.target.value);
                  setBranchFilter("");
                }}
              >
                <option value="">All banks</option>
                {lenders.lenders.map((lender) => (
                  <option key={lender.id} value={lender.id}>
                    {lender.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-ink-700">Branch</span>
              <Select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                disabled={!bankFilter}
              >
                <option value="">All branches</option>
                {branchesForFilter.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-ink-700">Search</span>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search bankers…"
              />
            </label>
          </div>

          {bankers.loading && <Empty>Loading…</Empty>}
          {bankers.error && <p className="text-sm text-ink-700">{bankers.error.message}</p>}
          {bankers.data && visible.length === 0 && (
            <Empty>
              {bankFilter && branchFilter
                ? "No bankers added for this branch."
                : "No bankers match. Try fewer words, or clear the filters."}
            </Empty>
          )}

          {visible.length > 0 && (
            <ul className="divide-y divide-ink-100">
              {visible.map((banker) => (
                <BankerRow
                  key={banker.id}
                  banker={banker}
                  mayManage={mayManage}
                  onEdit={() => {
                    setEditing(banker);
                    setFormOpen(true);
                  }}
                  onChanged={bankers.refetch}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {formOpen && mayManage && (
        <BankerFormModal
          lenders={lenders.lenders}
          banker={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            bankers.refetch();
          }}
        />
      )}
    </div>
  );
}

function BankerRow({
  banker,
  mayManage,
  onEdit,
  onChanged,
}: {
  banker: ApiBanker;
  mayManage: boolean;
  onEdit: () => void;
  onChanged: () => void;
}): ReactNode {
  const toast = useToast();
  const mutation = useMutation();

  async function toggleActive(): Promise<void> {
    const result = await mutation.run(() =>
      api<ApiBanker>(`/bankers/${banker.id}/active`, {
        method: "PUT",
        body: { isActive: !banker.isActive },
      }),
    );
    if (result) {
      toast.show(banker.isActive ? "Banker deactivated." : "Banker reactivated.", "good");
      onChanged();
    }
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
          {banker.name ?? banker.workEmail ?? "Unnamed banker"}
          {banker.isPrimary && <Badge tone="good">Primary</Badge>}
          {!banker.isActive && <Badge tone="neutral">Inactive</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {[
            banker.institutionName,
            banker.branchName,
            banker.designation,
            banker.workEmail,
            banker.workMobile,
          ]
            .filter((part): part is string => part !== null && part !== "")
            .join(" · ")}
        </p>
        {mutation.error && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {mutation.error}
          </p>
        )}
      </div>
      {mayManage && (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="secondary" disabled={mutation.pending} onClick={toggleActive}>
            {banker.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a banker
//
// Shared with the case-side "Add bank" flow's escape hatch
// (`Frontend/src/screens/BanksTab.tsx`) — a case never creates a banker
// inline, it opens this same modal, pre-scoped to the branch it already
// picked.
// ---------------------------------------------------------------------------

export function BankerFormModal({
  lenders,
  banker,
  lockToBranchId,
  onClose,
  onSaved,
}: {
  lenders: readonly ApiLender[];
  /** Present: editing. Absent: creating. */
  banker: ApiBanker | null;
  /** Set when opened as the case-side escape hatch: the branch is already
   * chosen and must not change underneath the case flow that opened this. */
  lockToBranchId?: string | undefined;
  onClose: () => void;
  onSaved: (banker: ApiBanker) => void;
}): ReactNode {
  const mutation = useMutation();
  const isEdit = banker !== null;

  const lockedBank = lockToBranchId
    ? lenders.find((lender) => lender.branches.some((branch) => branch.id === lockToBranchId))
    : undefined;

  const [bankId, setBankId] = useState(
    lockToBranchId ? (lockedBank?.id ?? "") : (banker?.institutionOrganisationId ?? ""),
  );
  const [branchId, setBranchId] = useState(lockToBranchId ?? banker?.branchOrganisationId ?? "");
  const [name, setName] = useState(banker?.name ?? "");
  const [designation, setDesignation] = useState(banker?.designation ?? "");
  const [phone, setPhone] = useState(banker?.workMobile ?? "");
  const [email, setEmail] = useState(banker?.workEmail ?? "");
  const [isPrimary, setIsPrimary] = useState(banker?.isPrimary ?? false);

  const branches = lenders.find((lender) => lender.id === bankId)?.branches ?? [];
  const bankAndBranchFixed = isEdit || lockToBranchId !== undefined;

  async function submit(): Promise<void> {
    const body = {
      name: name.trim() === "" ? null : name.trim(),
      designation: designation.trim() === "" ? null : designation.trim(),
      workMobile: phone.trim() === "" ? null : phone.trim(),
      workEmail: email.trim() === "" ? null : email.trim(),
      isPrimary,
    };

    const result = isEdit
      ? await mutation.run(() => api<ApiBanker>(`/bankers/${banker!.id}`, { method: "PATCH", body }))
      : await mutation.run(() =>
          api<ApiBanker>("/bankers", { method: "POST", body: { branchOrganisationId: branchId, ...body } }),
        );

    if (result) onSaved(result);
  }

  return (
    <Modal open title={isEdit ? "Edit banker" : "Add banker"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank">
            {bankAndBranchFixed ? (
              <p className="rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
                {isEdit ? banker!.institutionName : (lockedBank?.name ?? "—")}
              </p>
            ) : (
              <Select
                value={bankId}
                onChange={(event) => {
                  setBankId(event.target.value);
                  setBranchId("");
                }}
              >
                <option value="">Choose a bank…</option>
                {lenders.map((lender) => (
                  <option key={lender.id} value={lender.id}>
                    {lender.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Branch">
            {bankAndBranchFixed ? (
              <p className="rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
                {isEdit
                  ? (banker!.branchName ?? "—")
                  : (lockedBank?.branches.find((branch) => branch.id === branchId)?.name ?? "—")}
              </p>
            ) : (
              <Select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!bankId}>
                <option value="">Choose a branch…</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.city ? ` — ${branch.city}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Banker name" hint="Optional for a shared mailbox — leave blank and fill in the email instead.">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation">
            <Input value={designation} onChange={(event) => setDesignation(event.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
        </div>
        <Field label="Email">
          <Input value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
          Primary contact for this branch
        </label>

        {mutation.error && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            {mutation.error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={mutation.pending || !branchId || (name.trim() === "" && email.trim() === "")}
            onClick={submit}
          >
            {mutation.pending ? "Saving…" : isEdit ? "Save changes" : "Add banker"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
