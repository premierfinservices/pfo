/**
 * What PFO refuses to store, and what type it says a stored file is.
 *
 * WHY THIS EXISTS (ADR-051). Until now any bytes under any name were accepted,
 * and the type recorded for a file was whatever the browser (or the sender of
 * an inbound email) claimed. Documents are later opened by employees and mailed
 * to lenders from the office's own address, so a program or a web page dressed
 * as a customer document is the thing to keep out.
 *
 * DELIBERATELY NOT AN ALLOWLIST (Tarun, 12 Nov 2026). Real case folders hold
 * file types nobody listed in advance, and a folder drop must keep working.
 * So: named dangerous types are refused, and the two families PFO shows on
 * screen (PDF, images) must really be what their name says. Everything else is
 * stored and only ever offered as a download.
 *
 * LENIENT ON PURPOSE elsewhere: banks export HTML tables named `.xls`, and
 * phones save a PNG as `.jpg`. Neither is refused.
 */

/** Programs, scripts, installers, shortcuts, web pages and macro-carrying Office files. */
const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "dll", "com", "scr", "pif", "cpl", "msi", "msp", "msix", "appx", "apk", "jar",
  "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "mjs", "wsf", "wsh", "hta", "sh", "py", "php",
  "lnk", "url", "reg", "inf", "chm", "iso", "img", "vhd",
  "html", "htm", "xhtml", "mht", "mhtml", "svg",
  "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppsm",
]);

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif",
]);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  zip: "application/zip",
};

/** The extension Windows would act on: it drops trailing dots and spaces from a name. */
function extensionOf(fileName: string): string {
  const name = fileName.replace(/[. ]+$/, "");
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The type PFO records and serves for a file, from its NAME, never from what
 * the sender claimed. Unknown means "a download", which is always safe.
 */
export function contentTypeFor(fileName: string): string {
  return CONTENT_TYPES[extensionOf(fileName)] ?? "application/octet-stream";
}

/** True for the types a browser may show in place; everything else is a download. */
export function isShownInline(fileName: string): boolean {
  const type = contentTypeFor(fileName);
  return type === "application/pdf" || (type.startsWith("image/") && type !== "image/heic");
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function looksLikeImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, ascii("GIF8")) ||
    (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) ||
    startsWith(bytes, ascii("BM")) ||
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || // TIFF, little-endian
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) || // TIFF, big-endian
    startsWith(bytes, ascii("ftyp"), 4) // HEIC/HEIF
  );
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // Readers accept a little junk before the header, so the first kilobyte is searched.
  const marker = ascii("%PDF");
  const limit = Math.min(bytes.length, 1024) - marker.length;
  for (let index = 0; index <= limit; index += 1) {
    if (startsWith(bytes, marker, index)) return true;
  }
  return false;
}

/**
 * Why this file may not be stored, as a sentence for the employee, or `null`
 * when it may.
 */
export function uploadRefusal(fileName: string, bytes: Uint8Array): string | null {
  const extension = extensionOf(fileName);

  if (BLOCKED_EXTENSIONS.has(extension)) {
    return `"${fileName}" is a .${extension} file, which Premier Finserv One does not store. Save it as a PDF or an image and upload that.`;
  }
  // A Windows program, whatever it is called.
  if (startsWith(bytes, ascii("MZ"))) {
    return `"${fileName}" is a program, not a document, so it was not stored.`;
  }
  if (extension === "pdf" && !looksLikePdf(bytes)) {
    return `"${fileName}" is named as a PDF but is not one, so it was not stored.`;
  }
  if (IMAGE_EXTENSIONS.has(extension) && !looksLikeImage(bytes)) {
    return `"${fileName}" is named as an image but is not one, so it was not stored.`;
  }
  return null;
}
