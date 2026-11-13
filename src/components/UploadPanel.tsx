import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { formatBytes } from '../lib/format';
import { useUploads, type UploadItem } from '../state/uploads';
import { Spinner } from './ui';

/** Floating transfer list, visible on every page while uploads exist. */
export function UploadPanel() {
  const { items, cancel, retry, clearFinished } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const title = active
    ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}…`
    : failed
      ? `${failed} ${failed === 1 ? 'upload' : 'uploads'} failed`
      : 'Uploads complete';

  return (
    <aside className="upload-panel" aria-label="Uploads">
      <header>
        <strong>{title}</strong>
        <div className="row">
          <button className="icon-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'}>
            {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {!active && (
            <button className="icon-btn" onClick={clearFinished} aria-label="Dismiss finished uploads">
              <X size={18} />
            </button>
          )}
        </div>
      </header>
      {!collapsed && (
        <ul>
          {items.map((item) => (
            <UploadRow key={item.id} item={item} onCancel={() => cancel(item.id)} onRetry={() => retry(item.id)} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function UploadRow({ item, onCancel, onRetry }: { item: UploadItem; onCancel: () => void; onRetry: () => void }) {
  const percent = item.file.size ? Math.min(100, Math.round((item.loaded / item.file.size) * 100)) : 100;
  return (
    <li>
      <div className="upload-icon">
        {item.status === 'done' ? (
          <CheckCircle2 size={18} className="ok" />
        ) : item.status === 'error' ? (
          <CircleAlert size={18} className="bad" />
        ) : item.status === 'uploading' ? (
          <Spinner />
        ) : null}
      </div>
      <div className="grow">
        <div className="file-name" title={`${item.bucket}/${item.key}`}>
          {item.key}
        </div>
        <div className="muted small">
          {item.status === 'uploading' && `${percent}% · ${formatBytes(item.loaded)} of ${formatBytes(item.file.size)}`}
          {item.status === 'queued' && `Waiting · ${formatBytes(item.file.size)}`}
          {item.status === 'done' && `${formatBytes(item.file.size)} · uploaded to ${item.bucket}`}
          {item.status === 'cancelled' && 'Cancelled'}
          {item.status === 'error' && <span className="field-error">{item.error}</span>}
        </div>
        {item.status === 'uploading' && (
          <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      {(item.status === 'queued' || item.status === 'uploading') && (
        <button className="icon-btn" onClick={onCancel} aria-label={`Cancel upload of ${item.key}`}>
          <X size={16} />
        </button>
      )}
      {(item.status === 'error' || item.status === 'cancelled') && (
        <button className="icon-btn" onClick={onRetry} aria-label={`Retry upload of ${item.key}`}>
          <RotateCcw size={16} />
        </button>
      )}
    </li>
  );
}
