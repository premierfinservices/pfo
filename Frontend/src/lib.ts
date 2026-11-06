/** Formatting shared across screens. The prototype-store lookups went with `fake/` (ADR-050). */

export function money(amount?: number): string {
  if (amount === undefined) return "—";
  // Indian grouping: 35,00,000 rather than 3,500,000. Getting this wrong is the
  // first thing anyone in Madurai would notice.
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function lakhs(amount?: number): string {
  if (amount === undefined) return "—";
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return money(amount);
}

export function bytes(size: number): string {
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

export function when(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const days = Math.round((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 0 && days < 30) return `${days} days ago`;
  if (days < 0 && days > -30) return `in ${Math.abs(days)} days`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function exactly(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
