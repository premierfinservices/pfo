/**
 * Products: the loan products cases are logged under, read-only (ADR-050).
 *
 * Until 6 Nov 2026 this screen showed the per-browser prototype dataset
 * (`Frontend/src/fake/`), not the database. It now reads `GET /api/reference`,
 * the same list real cases use. Products stay read-only here (Master Roadmap,
 * Phase 2): a new product is a migration, because the checklists depend on it.
 */

import { useMemo, useState, type ReactNode } from "react";

import { useReference } from "../api/catalogue.js";
import { Badge, Card, Empty, Input, TABLE_ROW, Table, Td, Th } from "../ui/index.js";

const NEEDS: Record<string, string> = {
  mandatory: "Needed",
  optional: "Optional",
  not_applicable: "No",
};

export function LendingProducts(): ReactNode {
  const reference = useReference();
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return reference.loanProducts.filter((product) => {
      const text = [product.name ?? "", product.code, product.category, product.variant, product.customerProductName ?? ""]
        .join(" ")
        .toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [reference.loanProducts, search]);

  if (reference.loading) return <Empty>Loading products…</Empty>;
  if (reference.error) return <Empty>{reference.error.message}</Empty>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Products</h1>
        <p className="mt-1 text-sm text-ink-500">The loan products cases are logged under, and what each one asks for.</p>
      </div>
      <Input
        placeholder="Search by name, code or category"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-md"
      />
      <Card title={`${visible.length} of ${reference.loanProducts.length} products`}>
        {visible.length === 0 ? (
          <Empty>No product matches.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Group</Th>
                <Th>Property</Th>
                <Th>GST</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => (
                <tr key={product.id} className={TABLE_ROW}>
                  <Td>
                    <span className="block text-sm text-ink-900">{product.name ?? product.code}</span>
                    <span className="block text-xs text-ink-500">{product.code}</span>
                  </Td>
                  <Td>{product.customerProductName ?? "—"}</Td>
                  <Td>{product.propertyRequirement ? NEEDS[product.propertyRequirement] : "—"}</Td>
                  <Td>{product.gstRequirement ? NEEDS[product.gstRequirement] : "—"}</Td>
                  <Td>{product.isActive ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
