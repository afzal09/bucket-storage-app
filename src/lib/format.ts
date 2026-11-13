import type { RuntimeSize } from '../api/types';

export function toNumber(size: RuntimeSize): number {
  return typeof size === 'number' ? size : Number(size);
}

export function formatBytes(size: RuntimeSize | undefined): string {
  if (size === undefined) return '—';
  const bytes = toNumber(size);
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

export function shortId(id: string, length = 8): string {
  return id.length > length ? id.slice(0, length) : id;
}

export function baseName(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function triggerDownload(href: string, filename?: string): void {
  const link = document.createElement('a');
  link.href = href;
  if (filename) link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
