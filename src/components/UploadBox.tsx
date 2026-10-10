// Upload area for one document. Phase 1 is layout only: the file is not read or sent anywhere yet.
type Props = { id: string; title: string; hint: string };

export function UploadBox({ id, title, hint }: Props) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center hover:border-teal-600"
    >
      <span className="text-base font-semibold">{title}</span>
      <span className="text-sm text-slate-500">{hint}</span>
      <span className="mt-2 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white">Choose file</span>
      <input id={id} name={id} type="file" accept="image/*,application/pdf" className="sr-only" />
    </label>
  );
}
