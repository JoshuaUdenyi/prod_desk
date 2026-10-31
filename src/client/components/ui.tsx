/**
 * Shared primitives.
 *
 * The reference kit is dark with a single violet accent, fully rounded buttons,
 * and status that always carries a word as well as a colour (PRD §10: never
 * rely on colour alone).
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '../lib/cn';

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong shadow-[0_1px_0_rgba(255,255,255,0.12)_inset]',
  secondary: 'border border-line bg-raised text-ink hover:border-line-strong hover:bg-[#191920]',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:border-danger/60',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-10 px-4 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-9 place-items-center rounded-full border border-line bg-raised text-muted',
        'transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  as: Tag = 'section',
}: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={cn('card', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A label, a big number and an optional delta chip — the kit's stat card. */
export function StatCard({
  label,
  value,
  suffix,
  delta,
  hint,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string;
  suffix?: string | null;
  delta?: { value: number; label?: string } | null;
  hint?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
  className?: string;
}) {
  const toneClass = {
    neutral: 'text-ink',
    positive: 'text-positive',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];

  return (
    <Card className={cn('p-5', className)}>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('tabular mt-2 text-[28px] leading-none font-semibold tracking-tight', toneClass)}>
        {value}
        {suffix ? <span className="ml-0.5 text-sm font-medium text-muted">{suffix}</span> : null}
      </p>
      <div className="mt-3 flex items-center gap-2">
        {delta ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              delta.value >= 0 ? 'bg-positive-soft text-positive' : 'bg-danger-soft text-danger',
            )}
          >
            {delta.value >= 0 ? '+' : ''}
            {delta.value.toFixed(1)}%
          </span>
        ) : null}
        {delta?.label ?? hint ? <span className="text-[11px] text-faint">{delta?.label ?? hint}</span> : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-raised text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/30',
  positive: 'bg-positive-soft text-positive border-positive/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const PROJECT_TONES: Record<string, Tone> = {
  draft: 'neutral',
  quoted: 'accent',
  approved: 'positive',
  in_production: 'warning',
  completed: 'positive',
  cancelled: 'danger',
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return <Pill tone={PROJECT_TONES[status] ?? 'neutral'}>{label}</Pill>;
}

const BAND_TONES: Record<string, Tone> = {
  critical: 'danger',
  low: 'warning',
  acceptable: 'neutral',
  good: 'positive',
  excellent: 'positive',
};

export function BandPill({ band, label }: { band: string; label: string }) {
  const icon =
    band === 'critical' || band === 'low' ? <AlertTriangle className="size-3" aria-hidden /> : <Check className="size-3" aria-hidden />;
  return (
    <Pill tone={BAND_TONES[band] ?? 'neutral'}>
      {icon}
      {label}
    </Pill>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...rest} className={cn('field', invalid && 'field-error', className)} />;
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...rest} className={cn('field min-h-24 resize-y', invalid && 'field-error', className)} />;
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={cn('field appearance-none pr-9', invalid && 'field-error', className)}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2 text-xs text-muted', className)}>
      <input id={id} type="checkbox" className="peer sr-only" {...rest} />
      <span
        className={cn(
          'grid size-4 place-items-center rounded-[5px] border border-line-strong bg-sunken transition-colors',
          'peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2',
          'peer-focus-visible:outline-accent',
        )}
      >
        <Check className="size-3 text-white opacity-0 peer-checked:opacity-100" aria-hidden />
      </span>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-5 border-b border-line" role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              '-mb-px border-b-2 pb-2.5 text-sm transition-colors',
              active
                ? 'border-accent font-medium text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'positive' | 'warning' | 'danger' }) {
  const width = Math.max(0, Math.min(100, value));
  const fill = { accent: 'bg-accent', positive: 'bg-positive', warning: 'bg-warning', danger: 'bg-danger' }[tone];

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="presentation">
      <div className={cn('h-full rounded-full transition-[width]', fill)} style={{ width: `${width}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="grid size-11 place-items-center rounded-full bg-raised text-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-raised', className)} />;
}

/** A right-hand sheet, used for the create/edit forms. */
export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose} className="border-transparent bg-transparent">
            <X className="size-4" aria-hidden />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t border-line px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts — one at a time is enough for a single-user tool
// ---------------------------------------------------------------------------

const ToastContext = createContext<(message: string, tone?: 'info' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null);

  const show = (message: string, tone: 'info' | 'error' = 'info') => setToast({ message, tone });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
          <div
            role="status"
            className={cn(
              'pointer-events-auto rounded-full border px-4 py-2 text-xs font-medium shadow-xl',
              toast.tone === 'error'
                ? 'border-danger/30 bg-danger-soft text-danger'
                : 'border-line bg-raised text-ink',
            )}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
