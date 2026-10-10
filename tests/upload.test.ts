import { describe, it, expect, afterEach } from "vitest";
import { checkUpload, sniffType } from "../src/lib/upload";
import { KanakkuError } from "../src/lib/errors";

const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const pdf = (body = "1 0 obj << /Type /Page >> endobj") => enc(`%PDF-1.7\n${body}\ntrailer\n%%EOF\n`);
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as KanakkuError).code + ": " + (e as KanakkuError).userMessage; } return "ok"; };

describe("upload validation", () => {
  afterEach(() => { delete process.env.KANAKKU_MAX_UPLOAD_MB; delete process.env.KANAKKU_MAX_PDF_PAGES; });

  it("identifies files by their bytes, not their name", () => {
    expect(sniffType(pdf())).toBe("application/pdf");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(enc("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(enc("\0\0\0\x18ftypheic"))).toBe("heic");
    expect(sniffType(enc("<html>not a pdf</html>"))).toBeNull();
  });

  it("accepts a normal PDF and image, with sha256 and page count", () => {
    const f = checkUpload(pdf(), "bill");
    expect(f).toMatchObject({ kind: "pdf", mediaType: "application/pdf", pages: 1 });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), "bill").kind).toBe("image");
  });

  it("rejects empty, unsupported, HEIC, encrypted, damaged, oversized and long files with useful messages", () => {
    expect(code(() => checkUpload(new Uint8Array(), "bill"))).toMatch(/UNSUPPORTED_FILE: The bill file is empty/);
    expect(code(() => checkUpload(enc("hello world"), "bill"))).toMatch(/Upload a PDF, JPEG, PNG or WebP/);
    expect(code(() => checkUpload(enc("\0\0\0\x18ftypheic...."), "bill"))).toMatch(/HEIC/);
    expect(code(() => checkUpload(pdf("<< /Encrypt 5 0 R >>"), "discharge summary"))).toMatch(/discharge summary PDF is password-protected/);
    expect(code(() => checkUpload(enc("%PDF-1.7\n1 0 obj"), "bill"))).toMatch(/incomplete or damaged/);
    process.env.KANAKKU_MAX_UPLOAD_MB = "0.1";
    expect(code(() => checkUpload(pdf("x".repeat(200_000)), "bill"))).toMatch(/limit is 0.1 MB/);
    delete process.env.KANAKKU_MAX_UPLOAD_MB;
    process.env.KANAKKU_MAX_PDF_PAGES = "2";
    expect(code(() => checkUpload(pdf("/Type /Page /Type /Page /Type /Pages /Type /Page"), "bill"))).toMatch(/has 3 pages; the limit is 2/);
  });
});
