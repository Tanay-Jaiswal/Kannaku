"use client";
// Upload area for one document. Validates type and size in the browser for a fast message; the server
// re-validates the bytes (src/lib/upload.ts) and is the source of truth.
import { useId } from "react";

type Props = {
  title: string;
  hint: string;
  file: File | null;
  error: string | null;
  disabled?: boolean;
  onChange: (file: File | null) => void;
};

export function UploadBox({ title, hint, file, error, disabled, onChange }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white p-8 text-center ${
          error ? "border-rose-400" : file ? "border-teal-600" : "border-slate-300 hover:border-teal-600"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className="text-base font-semibold">{title}</span>
        <span className="text-sm text-slate-500">{hint}</span>
        {file ? (
          <span className="mt-2 max-w-full truncate text-sm font-medium text-teal-800">
            {file.name} · {(file.size / 1048576).toFixed(2)} MB
          </span>
        ) : (
          <span className="mt-2 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white">Choose file</span>
        )}
        <input
          id={id}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      {file && !disabled && (
        <button type="button" className="self-start text-xs text-slate-500 underline" onClick={() => onChange(null)}>
          Remove file
        </button>
      )}
    </div>
  );
}

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
/** Browser-side pre-check. Returns a message, or null if the file looks acceptable. */
export function precheckFile(file: File, maxMb: number): string | null {
  if (file.size === 0) return "This file is empty.";
  if (file.size > maxMb * 1048576) return `This file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB. Try a smaller PDF or a lower-resolution photo.`;
  if (/\.(heic|heif)$/i.test(file.name)) return "HEIC photos are not supported. Please export the photo as JPEG or PNG.";
  if (file.type && !ACCEPTED.includes(file.type)) return "Upload a PDF, JPEG, PNG or WebP file.";
  return null;
}
