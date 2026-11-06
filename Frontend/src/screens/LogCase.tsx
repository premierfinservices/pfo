/**
 * Log a Case: the MIS form, replacing New Case (ADR-040).
 *
 * A case enters here only once the customer has promised documents, so this
 * asks what the MIS asks and nothing else. Saving raises the first task and
 * lands on Update Case, whose fixed line says what comes next.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { amountInWords, normaliseMobile, parseAmount } from "@domain/work/intake.js";

import { api } from "../api/client.js";
import { useApiQuery, useMutation } from "../api/hooks.js";
import { useSession } from "../session.js";
import { Button, Card, Empty, Field, Input, Select } from "../ui/index.js";

export interface WorkLists {
  readonly loanTypes: readonly string[];
  readonly otherLoanType: string;
  readonly variants: readonly string[];
  readonly leadSources: readonly { label: string; code: string }[];
  readonly firms: readonly { label: string; code: string }[];
  readonly employmentTypes: readonly { label: string; code: string }[];
  readonly places: readonly string[];
  readonly people: readonly { id: string; name: string; roles: readonly string[] }[];
  readonly rejectionReasons: readonly { id: string; label: string }[];
  readonly statusLabels: Record<string, string>;
  readonly nextStatuses: Record<string, readonly string[]>;
}

interface MobileMatch {
  readonly valid: boolean;
  readonly matches: readonly { id: string; caseNumber: string; customerName: string; stage: string }[];
  readonly hidden: number;
}

/** yyyy-mm-dd in India, `days` from today. */
export function dateFromToday(days: number): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

export function LogCase(): ReactNode {
  const session = useSession();
  const navigate = useNavigate();
  const lists = useApiQuery<WorkLists>("/work/lists");
  const mutation = useMutation();

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [place, setPlace] = useState("");
  const [amount, setAmount] = useState("");
  const [loanType, setLoanType] = useState("");
  const [variant, setVariant] = useState("");
  const [leadSource, setLeadSource] = useState("");
  // Every case is MCM for now (Tarun, 2 Nov 2026); still changeable here.
  const [firm, setFirm] = useState("mcm");
  const [employment, setEmployment] = useState("");
  const [telecaller, setTelecaller] = useState(session.user.id);
  const [pickup, setPickup] = useState(dateFromToday(1));
  const [different, setDifferent] = useState(false);
  const [isPractice, setIsPractice] = useState(false);
  const [match, setMatch] = useState<MobileMatch | null>(null);

  const words = useMemo(() => {
    const parsed = parseAmount(amount);
    return parsed === null ? "" : amountInWords(parsed);
  }, [amount]);

  // The match shows while the number is typed, with no popup.
  useEffect(() => {
    setDifferent(false);
    const normal = normaliseMobile(mobile);
    if (!normal) {
      setMatch(null);
      return;
    }
    let stale = false;
    void api<MobileMatch>(`/work/mobile?mobile=${normal}`).then((result) => {
      if (!stale) setMatch(result);
    });
    return () => {
      stale = true;
    };
  }, [mobile]);

  if (lists.loading) return <Empty>Loading…</Empty>;
  if (lists.error || !lists.data) return <Empty>{lists.error?.message ?? "Could not load the lists."}</Empty>;
  const data = lists.data;

  const matches = match?.matches ?? [];
  const hidden = match?.hidden ?? 0;
  const taken = matches.length + hidden > 0;
  const blocked = taken && !different;
  const telecallers = data.people.filter(
    (person) => person.roles.includes("telecaller") || person.roles.includes("manager") || person.id === session.user.id,
  );

  const save = async (): Promise<void> => {
    const created = await mutation.run(() =>
      api<{ id: string }>("/work/log-case", {
        method: "POST",
        body: {
          customerName: name,
          mobile,
          place,
          amount,
          loanType,
          variant,
          leadSource,
          firm,
          employmentType: employment,
          telecallerId: telecaller,
          pickupDate: pickup,
          differentCustomer: different,
          isPractice,
        },
      }),
    );
    if (created) navigate(`/update-case?case=${created.id}`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Log a Case</h1>
        <p className="mt-1 text-sm text-ink-500">For a customer who has promised to send documents.</p>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name">
            <Input value={name} onChange={(event) => setName(event.target.value)} className="uppercase" autoFocus />
          </Field>

          <Field label="Mobile">
            <Input value={mobile} inputMode="numeric" onChange={(event) => setMobile(event.target.value)} />
            {mobile.length >= 10 && match && !match.valid && (
              <span className="mt-1 block text-xs text-red-700">Type a 10-digit number starting 6, 7, 8 or 9.</span>
            )}
          </Field>

          {taken && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 sm:col-span-2">
              <p className="font-medium">This mobile is already on:</p>
              <ul className="mt-1 space-y-0.5">
                {matches.map((item) => (
                  <li key={item.id}>
                    <Link to={`/update-case?case=${item.id}`} className="underline">
                      {item.caseNumber}
                    </Link>{" "}
                    {item.customerName}
                  </li>
                ))}
                {hidden > 0 && <li>{hidden} other case{hidden === 1 ? "" : "s"} you cannot open</li>}
              </ul>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={different} onChange={(event) => setDifferent(event.target.checked)} />
                This is a different customer (for example a shared family number)
              </label>
            </div>
          )}

          <Field label="Place">
            <Input
              list="mis-places"
              value={place}
              onChange={(event) => setPlace(event.target.value.toUpperCase())}
            />
            <datalist id="mis-places">
              {data.places.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>

          <Field label="Loan amount" hint={words || "25L, 1.5cr or 2500000"}>
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>

          <Field label="Loan type">
            <Select value={loanType} onChange={(event) => setLoanType(event.target.value)}>
              <option value="">Pick…</option>
              {data.loanTypes.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </Field>

          <Field label={loanType === data.otherLoanType ? "Variant / details (needed)" : "Variant"}>
            <Input list="mis-variants" value={variant} onChange={(event) => setVariant(event.target.value)} />
            <datalist id="mis-variants">
              {data.variants.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>

          <Field label="Lead source">
            <Select value={leadSource} onChange={(event) => setLeadSource(event.target.value)}>
              <option value="">Pick…</option>
              {data.leadSources.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Firm">
            <Select value={firm} onChange={(event) => setFirm(event.target.value)}>
              <option value="">Pick…</option>
              {data.firms.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Employment type">
            <Select value={employment} onChange={(event) => setEmployment(event.target.value)}>
              <option value="">Pick…</option>
              {data.employmentTypes.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Telecaller">
            <Select value={telecaller} onChange={(event) => setTelecaller(event.target.value)}>
              {telecallers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Document pickup date">
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-44" type="date" value={pickup} min={dateFromToday(0)} onChange={(event) => setPickup(event.target.value)} />
              <Button type="button" variant="ghost" onClick={() => setPickup(dateFromToday(0))}>
                Today
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPickup(dateFromToday(1))}>
                Tomorrow
              </Button>
            </div>
          </Field>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={isPractice} onChange={(event) => setIsPractice(event.target.checked)} />
          Practice case (kept out of every report)
        </label>

        {mutation.error && <p className="mt-3 text-sm text-red-700">{mutation.error}</p>}

        <div className="mt-4 flex justify-end">
          <Button variant="primary" disabled={mutation.pending || blocked} onClick={() => void save()}>
            {mutation.pending ? "Saving…" : "Log case"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
