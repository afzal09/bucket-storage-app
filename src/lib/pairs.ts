import type { StringMap } from '../api/types';

export type Pair = { key: string; value: string };

export function mapToPairs(map: StringMap | undefined): Pair[] {
  return Object.entries(map ?? {}).map(([key, value]) => ({ key, value }));
}

/** Drops blank rows; later duplicates win. */
export function pairsToMap(pairs: Pair[]): StringMap {
  const result: StringMap = {};
  for (const { key, value } of pairs) {
    const name = key.trim();
    if (name) result[name] = value;
  }
  return result;
}

/** User metadata travels as `x-amz-meta-*` headers, so names must be header tokens and values plain ASCII. */
export function validateMetadata(pairs: Pair[]): string | null {
  for (const { key, value } of pairs) {
    const name = key.trim();
    if (!name && !value) continue;
    if (!/^[A-Za-z0-9-]+$/.test(name)) return `Metadata name “${name}” may only contain letters, numbers and hyphens.`;
    // eslint-disable-next-line no-control-regex
    if (/[^\x20-\x7e]/.test(value)) return `Metadata value for “${name}” must be printable ASCII (it is sent as an HTTP header).`;
  }
  return null;
}
