import { Check, Copy, Loader2, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, isAuthError } from '../api/errors';
import { copyToClipboard } from '../lib/format';
import { useToast } from '../state/toast';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <Loader2 size={18} className="spin" />
    </span>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-block">
      <Spinner label={label} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state-block state-error" role="alert">
      <TriangleAlert size={22} />
      <strong>Something went wrong</strong>
      <span>{errorMessage(error)}</span>
      <div className="row">
        {onRetry && (
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        )}
        {isAuthError(error) && (
          <Link className="btn btn-primary" to="/connect">
            Update credentials
          </Link>
        )}
      </div>
    </div>
  );
}

export function EmptyBlock({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="state-block">
      {icon}
      <strong>{title}</strong>
      {children && <span className="muted">{children}</span>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        if (await copyToClipboard(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } else {
          toast.error(new Error('Could not access the clipboard'));
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}
