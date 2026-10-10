// Upload validation (Phase 3). Files are identified by their bytes, never by the name or the browser's
// declared type, and rejected with a message the user can act on. Nothing here logs file content.
import { createHash } from "node:crypto";
import { KanakkuError } from "./errors";
import { limits } from "./limits";

export type CheckedFile = {
  kind: "pdf" | "image";
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  pages: number | null; // PDF pages if countable, else null
  sha256: string;
  base64: string;
};

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function sniffType(b: Uint8Array): CheckedFile["mediaType"] | "heic" | null {
  if (startsWith(b, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(b, ascii("ftyp"), 4) && /^(heic|heix|hevc|mif1|heif)$/.test(String.fromCharCode(...b.slice(8, 12)))) return "heic";
  return null;
}

/** Validates one uploaded document. `label` is "bill" or "discharge summary", used in messages. */
export function checkUpload(buf: Uint8Array, label: string): CheckedFile {
  const l = limits();
  if (buf.byteLength === 0) throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} file is empty. Please choose the file again.`);
  if (buf.byteLength > l.maxUploadBytes)
    throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} is ${(buf.byteLength / 1048576).toFixed(1)} MB; the limit is ${(l.maxUploadBytes / 1048576).toFixed(1)} MB. Try a smaller PDF or a lower-resolution photo.`);
  const type = sniffType(buf);
  if (type === "heic")
    throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} is an HEIC photo, which is not supported. Please export it as JPEG or PNG.`);
  if (!type)
    throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} is not a supported file. Upload a PDF, JPEG, PNG or WebP.`);

  let pages: number | null = null;
  if (type === "application/pdf") {
    // latin1 keeps every byte as one char, so PDF keywords can be searched without a PDF library.
    const text = Buffer.from(buf).toString("latin1");
    if (/\/Encrypt\b/.test(text))
      throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} PDF is password-protected or encrypted. Please upload an unlocked copy (for example, print it to a new PDF).`);
    if (!/%%EOF\s*$/.test(text.slice(-1024)))
      throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} PDF looks incomplete or damaged. Please download or export it again.`);
    const counted = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
    pages = counted > 0 ? counted : null; // compressed object streams hide page objects; the provider still enforces its own limit
    if (pages != null && pages > l.maxPdfPages)
      throw new KanakkuError("UNSUPPORTED_FILE", `The ${label} PDF has ${pages} pages; the limit is ${l.maxPdfPages}. Upload only the itemized pages.`);
  }
  return {
    kind: type === "application/pdf" ? "pdf" : "image",
    mediaType: type,
    bytes: buf.byteLength,
    pages,
    sha256: createHash("sha256").update(buf).digest("hex"),
    base64: Buffer.from(buf).toString("base64"),
  };
}
