import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Search, X } from 'lucide-react';

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      loadingLabel = 'Loading',
      fullWidth = false,
      disabled,
      className = '',
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={`ip-button ip-button--${variant} ip-button--${size} ${fullWidth ? 'ip-button--full' : ''} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner size="sm" label={loadingLabel} /> : children}
      </button>
    );
  },
);

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon,
      size = 'md',
      variant = 'ghost',
      loading = false,
      disabled,
      className = '',
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={`ip-icon-button ip-icon-button--${variant} ip-icon-button--${size} ${className}`}
        aria-label={label}
        title={label}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner size="sm" label={label} /> : icon}
      </button>
    );
  },
);

interface FieldStateProps {
  error?: boolean;
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & FieldStateProps
>(function Input({ error, className = '', ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`ip-input ${error ? 'ip-field--error' : ''} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldStateProps
>(function Textarea({ error, className = '', ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={`ip-input ip-textarea ${error ? 'ip-field--error' : ''} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FieldStateProps
>(function Select({ error, className = '', children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={`ip-input ip-select ${error ? 'ip-field--error' : ''} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    >
      {children}
    </select>
  );
});

export interface ChoiceProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  description?: ReactNode;
  error?: boolean;
}

function Choice({
  label,
  description,
  error,
  className = '',
  ...props
}: ChoiceProps) {
  return (
    <label
      className={`ip-choice ${error ? 'ip-choice--error' : ''} ${className}`}
    >
      <input aria-invalid={error || undefined} {...props} />
      <span>
        <span className="ip-choice__label">{label}</span>
        {description ? (
          <span className="ip-choice__description">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'children'
> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: string;
  description?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className = '',
  ...props
}: SwitchProps) {
  return (
    <span className={`ip-switch-row ${className}`}>
      <span>
        <span className="ip-choice__label">{label}</span>
        {description ? (
          <span className="ip-choice__description">{description}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="ip-switch"
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      >
        <span aria-hidden="true" />
      </button>
    </span>
  );
}

export interface FormFieldProps {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  children,
  hint,
  error,
  optional,
  className = '',
}: FormFieldProps) {
  return (
    <div className={`ip-form-field ${className}`}>
      <label htmlFor={htmlFor}>
        {label}{' '}
        {optional ? (
          <span className="ip-form-field__optional">Optional</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <span className="ip-form-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ip-form-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'section' | 'div';
  interactive?: boolean;
}

export function Card({
  as: Element = 'section',
  interactive,
  className = '',
  ...props
}: CardProps) {
  return (
    <Element
      className={`ip-card ${interactive ? 'ip-card--interactive' : ''} ${className}`}
      {...props}
    />
  );
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone | 'brand' | 'gold';
}

export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: BadgeProps) {
  return (
    <span className={`ip-badge ip-badge--${tone} ${className}`} {...props} />
  );
}

export interface AlertProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  tone?: Exclude<Tone, 'neutral'>;
  title?: ReactNode;
  dismissLabel?: string;
  onDismiss?: () => void;
}

export function Alert({
  tone = 'info',
  title,
  children,
  dismissLabel = 'Dismiss alert',
  onDismiss,
  className = '',
  ...props
}: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`ip-alert ip-alert--${tone} ${className}`}
      {...props}
    >
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton
          label={dismissLabel}
          icon={<X size={18} />}
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}

export interface TabsProps {
  tabs: ReadonlyArray<{ id: string; label: ReactNode; disabled?: boolean }>;
  activeId: string;
  onChange: (id: string) => void;
  label: string;
}

export function Tabs({ tabs, activeId, onChange, label }: TabsProps) {
  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    for (let step = 1; step <= tabs.length; step += 1) {
      const nextIndex = (index + direction * step + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (next && !next.disabled) {
        onChange(next.id);
        document.getElementById(`ip-tab-${next.id}`)?.focus();
        return;
      }
    }
  }

  return (
    <div className="ip-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`ip-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          aria-controls={`ip-panel-${tab.id}`}
          tabIndex={tab.id === activeId ? 0 : -1}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Table({
  className = '',
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div
      className="ip-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Scrollable table"
    >
      <table className={`ip-table ${className}`} {...props} />
    </div>
  );
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  label?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  label = 'Pagination',
}: PaginationProps) {
  return (
    <nav className="ip-pagination" aria-label={label}>
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
  ...props
}: EmptyStateProps) {
  return (
    <div className={`ip-empty-state ${className}`} {...props}>
      {icon ? <div className="ip-empty-state__icon">{icon}</div> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  width,
  height,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={`ip-skeleton ${className}`}
      aria-hidden="true"
      style={{ width, height, ...style }}
      {...props}
    />
  );
}

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({
  size = 'md',
  label = 'Loading',
  className = '',
  ...props
}: SpinnerProps) {
  return (
    <span className={`ip-spinner-wrap ${className}`} role="status" {...props}>
      <span className={`ip-spinner ip-spinner--${size}`} aria-hidden="true" />
      <span className="ip-sr-only">{label}</span>
    </span>
  );
}

export type ToastTone = Exclude<Tone, 'neutral'>;
export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}
export interface ToastController {
  show: (toast: Omit<ToastMessage, 'id'>) => string;
  dismiss: (id: string) => void;
}

export interface StatCardProps extends HTMLAttributes<HTMLElement> {
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  trend?: ReactNode;
}

export function StatCard({
  label,
  value,
  helper,
  trend,
  className = '',
  ...props
}: StatCardProps) {
  return (
    <Card as="article" className={`ip-stat-card ${className}`} {...props}>
      <span className="ip-stat-card__label">{label}</span>
      <strong className="ip-stat-card__value">{value}</strong>
      <span className="ip-stat-card__meta">
        {helper} {trend}
      </span>
    </Card>
  );
}

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  onClear?: () => void;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    { label = 'Search', value, onClear, className = '', ...props },
    ref,
  ) {
    const id = useId();
    return (
      <label className={`ip-search-field ${className}`} htmlFor={id}>
        <span className="ip-sr-only">{label}</span>
        <Search size={18} aria-hidden="true" />
        <input
          ref={ref}
          id={id}
          type="search"
          value={value}
          aria-label={label}
          {...props}
        />
        {onClear && value ? (
          <IconButton
            label="Clear search"
            icon={<X size={16} />}
            size="sm"
            onClick={onClear}
          />
        ) : null}
      </label>
    );
  },
);

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  resultSummary?: ReactNode;
}

export function FilterBar({
  search,
  filters,
  actions,
  resultSummary,
  className = '',
  ...props
}: FilterBarProps) {
  return (
    <div className={`ip-filter-bar ${className}`} {...props}>
      <div className="ip-filter-bar__controls">
        {search}
        {filters}
      </div>
      {resultSummary ? (
        <div className="ip-filter-bar__summary">{resultSummary}</div>
      ) : null}
      {actions ? <div className="ip-filter-bar__actions">{actions}</div> : null}
    </div>
  );
}
