import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';

export function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            {Icon && <Icon className="h-5 w-5 text-primary-600 shrink-0" aria-hidden="true" />}
            {title}
          </h2>
          {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap gap-2 sm:justify-end">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
      <p className="text-gray-500 mt-1">{description}</p>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-8" role="status" aria-label="Loading">
      <div className="h-6 w-6 border-2 border-gray-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500 py-6 text-center">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3" role="alert">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function SuccessNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-3" role="status">
      {message}
    </p>
  );
}

export function Kpi({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: 'neutral' | 'good' | 'bad' }) {
  const valueColor = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 sm:p-4 min-w-0">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums truncate ${valueColor}`}>{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
