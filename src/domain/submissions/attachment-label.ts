/**
 * What one attached document is called in the email to a banker.
 *
 * A month of GSTR-3B is named by its month ("GSTR-3B Jul 2026"), not by the
 * financial year it falls in: twelve lines all reading "GST 3B – FY 2026-27"
 * leave the banker unable to tell which month is which. It also carries no
 * financial year, so the email does not describe twelve months that straddle
 * April as "two years of GST documents". Pure.
 */

import { documentRowLabel, financialYearOf, type PeriodKind } from "../requirements/index.js";
import { monthlyReturnName } from "../work/file-names.js";

export interface AttachmentLabelInput {
  readonly documentTypeCode: string;
  readonly typeName: string;
  readonly periodKind: PeriodKind | undefined;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export function attachmentLabel(input: AttachmentLabelInput): { label: string; financialYearLabel?: string } {
  const { documentTypeCode, typeName, periodKind, periodStart, periodEnd } = input;
  if (documentTypeCode === "gst_returns" && periodStart && periodEnd && periodStart.slice(0, 7) === periodEnd.slice(0, 7)) {
    return { label: monthlyReturnName(periodStart) };
  }
  if (!periodStart) return { label: typeName };
  const financialYearLabel = financialYearOf(new Date(periodStart)).label;
  return { label: documentRowLabel(typeName, financialYearLabel, periodKind), financialYearLabel };
}
