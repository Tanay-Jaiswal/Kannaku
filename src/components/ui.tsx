// Small shared UI primitives (buttons, badges, icons, notices) so every screen uses the same styles.
// Plain Tailwind and inline SVG: no extra dependency.
import type { ButtonHTMLAttributes, ReactNode, SVGProps } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet";
type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand-700 text-white shadow-card hover:bg-brand-800 active:bg-brand-900",
  secondary: "border border-line-strong bg-surface text-ink hover:border-brand-600 hover:text-brand-800",
  ghost: "text-brand-700 hover:bg-brand-50",
  quiet: "text-ink-muted hover:bg-paper-deep hover:text-ink",
};
const BTN_SIZE: Record<ButtonSize, string> = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" };

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${extra}`;
}

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export type Tone = "brand" | "ask" | "neutral" | "caution" | "danger" | "outline";
const BADGE_TONE: Record<Tone, string> = {
  brand: "bg-brand-700 text-white",
  ask: "bg-ask-100 text-ask-800",
  neutral: "bg-paper-deep text-ink-soft",
  caution: "bg-caution-50 text-caution-800 ring-1 ring-inset ring-caution-200",
  danger: "bg-danger-50 text-danger-800 ring-1 ring-inset ring-danger-200",
  outline: "text-ink-soft ring-1 ring-inset ring-line-strong",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${BADGE_TONE[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

const NOTICE_TONE = {
  info: { box: "border-line bg-surface text-ink-soft", icon: "text-brand-700" },
  caution: { box: "border-caution-200 bg-caution-50 text-caution-800", icon: "text-ask-700" },
  danger: { box: "border-danger-200 bg-danger-50 text-danger-800", icon: "text-danger-700" },
  success: { box: "border-brand-200 bg-brand-50 text-brand-900", icon: "text-brand-700" },
} as const;

/** A bordered message with an icon and a bold title. Colour is never the only signal: the title says it. */
export function Notice({ tone = "info", title, children, role, className = "" }:
  { tone?: keyof typeof NOTICE_TONE; title: ReactNode; children?: ReactNode; role?: "alert" | "status"; className?: string }) {
  const Icon = tone === "danger" ? IconAlert : tone === "caution" ? IconAlert : tone === "success" ? IconCheckCircle : IconInfo;
  return (
    <div role={role} className={`flex gap-3 rounded-xl border p-4 text-sm ${NOTICE_TONE[tone].box} ${className}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${NOTICE_TONE[tone].icon}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

/** Small uppercase label above a section heading. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.12em] text-brand-700 ${className}`}>{children}</p>;
}

// ---- Icons (24px grid, 1.75 stroke, currentColor) ----
type IconProps = SVGProps<SVGSVGElement>;
const base = (p: IconProps) => ({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const IconUpload = (p: IconProps) => <svg {...base(p)}><path d="M12 15V4m0 0 4 4m-4-4-4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>;
export const IconFile = (p: IconProps) => <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
export const IconReceipt = (p: IconProps) => <svg {...base(p)}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
export const IconClipboard = (p: IconProps) => <svg {...base(p)}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></svg>;
export const IconCheck = (p: IconProps) => <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const IconCheckCircle = (p: IconProps) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 3 3 5-6" /></svg>;
export const IconAlert = (p: IconProps) => <svg {...base(p)}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17h.01" /></svg>;
export const IconInfo = (p: IconProps) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
export const IconX = (p: IconProps) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IconXCircle = (p: IconProps) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
export const IconChevron = (p: IconProps) => <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>;
export const IconPrinter = (p: IconProps) => <svg {...base(p)}><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>;
export const IconScale = (p: IconProps) => <svg {...base(p)}><path d="M12 4v16M7 20h10M5 8h14M12 4l-1 0" /><path d="m5 8-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z" /></svg>;
export const IconShield = (p: IconProps) => <svg {...base(p)}><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>;
export const IconCalc = (p: IconProps) => <svg {...base(p)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></svg>;
export const IconQuestion = (p: IconProps) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></svg>;
export const IconLetter = (p: IconProps) => <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
export const IconFlask = (p: IconProps) => <svg {...base(p)}><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></svg>;
export const IconExternal = (p: IconProps) => <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>;
export const IconRefresh = (p: IconProps) => <svg {...base(p)}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>;
export const IconMinus = (p: IconProps) => <svg {...base(p)}><path d="M6 12h12" /></svg>;
export const IconArrowRight = (p: IconProps) => <svg {...base(p)}><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`motion-safe:animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The Kanakku mark: a ledger page with a tick, drawn in the brand colour. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--color-brand-800)" />
      <path d="M10 8.5h12M10 13h12M10 17.5h5" stroke="#d5ebe4" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m16.5 21.5 2.6 2.6 5-5.6" stroke="#f5e2b8" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
