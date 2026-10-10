"use client";
// Upload area for one document. Click, keyboard (Enter/Space on the focused area) or drag-and-drop.
// Validates type and size in the browser for a fast message; the server re-validates the bytes
// (src/lib/upload.ts) and is the source of truth. "Ready" here only means the file passed the browser
// pre-check: nothing is uploaded until the audit starts.
import { useId, useRef, useState, type ReactNode } from "react";
import { Button, IconAlert, IconCheck, IconFile, IconX } from "./ui";

type Props = {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  maxMb: number;
  file: File | null;
  error: string | null;
  disabled?: boolean;
  /** Shown in place of the prompt while disabled (uploads off, or settings still loading). */
  disabledLabel?: string;
  onChange: (file: File | null) => void;
};

export function UploadBox({ step, title, description, icon, maxMb, file, error, disabled, disabledLabel = "Uploads are off on this deployment", onChange }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = () => !disabled && input.current?.click();
  const state = disabled ? "disabled" : error ? "error" : file ? "ready" : "empty";
  const frame = {
    disabled: "border-line bg-paper-deep/60",
    error: "border-danger-200 bg-danger-50/50",
    ready: "border-brand-200 bg-brand-50/60",
    empty: dragging ? "border-brand-600 bg-brand-50" : "border-line-strong bg-surface hover:border-brand-500",
  }[state];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-paper-deep text-xs font-semibold text-ink-soft num">{step}</span>
          {title}
        </label>
        <span className="text-xs text-ink-muted">Required</span>
      </div>

      <div
        onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { if (disabled) return; e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onChange(f); }}
        className={`relative flex min-h-44 flex-col justify-center rounded-xl border-2 border-dashed p-5 transition-colors ${frame}`}
      >
        <input
          ref={input} id={id} type="file" className="sr-only" disabled={disabled}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          aria-describedby={`${id}-hint${error ? ` ${id}-err` : ""}`}
          onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = ""; }}
        />

        {file && !error ? (
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-brand-700 ring-1 ring-brand-200"><IconFile className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink" title={file.name}>{file.name}</p>
              <p className="flex items-center gap-1 text-xs text-brand-800">
                <IconCheck className="size-3.5" /> Ready · {(file.size / 1048576).toFixed(2)} MB · {kindLabel(file)}
              </p>
            </div>
            {!disabled && (
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={choose}>Replace</Button>
                <Button variant="quiet" size="sm" onClick={() => onChange(null)} aria-label={`Remove ${title.toLowerCase()}`}><IconX className="size-4" /></Button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button" onClick={choose} disabled={disabled}
            className="flex flex-col items-center gap-2 rounded-lg py-2 text-center disabled:cursor-not-allowed"
          >
            <span className={`flex size-11 items-center justify-center rounded-full ${disabled ? "bg-surface text-ink-faint" : "bg-brand-50 text-brand-700"}`}>
              {icon}
            </span>
            <span className="text-sm font-medium text-ink">
              {disabled ? disabledLabel : <><span className="text-brand-700 underline decoration-brand-200 underline-offset-4">Choose a file</span> or drag it here</>}
            </span>
            <span className="text-xs text-ink-muted">{description}</span>
          </button>
        )}
      </div>

      <p id={`${id}-hint`} className="text-xs text-ink-muted">PDF, JPEG, PNG or WebP · up to {maxMb} MB</p>
      {error && (
        <p id={`${id}-err`} className="flex items-start gap-1.5 text-sm text-danger-700" role="alert">
          <IconAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

function kindLabel(f: File) {
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "PDF";
  if (f.type.startsWith("image/")) return f.type.slice(6).toUpperCase();
  return "file";
}

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
/** Browser-side pre-check. Returns a message, or null if the file looks acceptable. */
export function precheckFile(file: File, maxMb: number): string | null {
  if (file.size === 0) return "This file is empty.";
  if (file.size > maxMb * 1048576) return `This file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB. Try a smaller PDF or a lower-resolution photo.`;
  if (/\.(heic|heif)$/i.test(file.name)) return "HEIC photos are not supported. Please export the photo as JPEG or PNG.";
  if (file.type && !ACCEPTED.includes(file.type)) return "Upload a PDF, JPEG, PNG or WebP file.";
  if (!file.type && !/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) return "Upload a PDF, JPEG, PNG or WebP file.";
  return null;
}
