/**
 * Which files in the document store no `document` row points at.
 *
 * Paths are relative to the store's `Documents/` folder with forward slashes —
 * the same shape as `document.file_path` and as `buildStoragePath` produces.
 * Every document on disk has a `<file>.meta.json` sidecar written next to it by
 * the storage server; a sidecar travels with its document and is never an
 * orphan on its own unless the document it describes is gone.
 *
 * Orphan kinds, and why only one of them is safe to move without a human:
 *   - "prototype": a real owner kind but a non-UUID owner id (`person/per_001`).
 *     The API only ever builds paths from UUID ids, so no row can point here —
 *     these are the retired in-browser prototype's sample files.
 *   - "unreferenced-uuid": a real owner kind and a UUID id. Most likely bytes
 *     from an upload whose transaction rolled back (documents.ts writes bytes
 *     before the insert). Could be a real customer's file, so review first.
 *   - "unrecognised": anything not shaped like a document path at all.
 */

const OWNER_KINDS = new Set(["person", "property", "organisation", "case"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIDECAR_SUFFIX = ".meta.json";

export type OrphanKind = "prototype" | "unreferenced-uuid" | "unrecognised";

export interface OrphanedFile {
  readonly path: string;
  /** The sidecar that belongs with `path`, if one is on disk. */
  readonly sidecar: string | null;
  readonly kind: OrphanKind;
}

export interface StoredFileClassification {
  readonly referencedPresent: string[];
  readonly referencedMissing: string[];
  readonly orphans: OrphanedFile[];
}

function orphanKind(filePath: string): OrphanKind {
  const [ownerKind, ownerId] = filePath.split("/");
  if (!ownerKind || !ownerId || !OWNER_KINDS.has(ownerKind)) return "unrecognised";
  return UUID.test(ownerId) ? "unreferenced-uuid" : "prototype";
}

export function classifyStoredFiles(
  diskPaths: readonly string[],
  referencedPaths: readonly string[],
): StoredFileClassification {
  const onDisk = new Set(diskPaths);
  const referenced = new Set(referencedPaths);

  const referencedPresent: string[] = [];
  const orphans: OrphanedFile[] = [];

  for (const filePath of [...onDisk].sort()) {
    if (filePath.endsWith(SIDECAR_SUFFIX)) {
      const described = filePath.slice(0, -SIDECAR_SUFFIX.length);
      if (!onDisk.has(described) && !referenced.has(described)) {
        orphans.push({ path: filePath, sidecar: null, kind: orphanKind(filePath) });
      }
      continue;
    }
    if (referenced.has(filePath)) {
      referencedPresent.push(filePath);
      continue;
    }
    const sidecar = `${filePath}${SIDECAR_SUFFIX}`;
    orphans.push({
      path: filePath,
      sidecar: onDisk.has(sidecar) ? sidecar : null,
      kind: orphanKind(filePath),
    });
  }

  const referencedMissing = [...referenced].filter((p) => !onDisk.has(p)).sort();
  return { referencedPresent, referencedMissing, orphans };
}
