import type { StorageClient } from '../api/client';
import type { ObjectRef } from '../api/types';
import { baseName, triggerDownload } from './format';

/** Above this size, hand the browser a presigned URL instead of buffering the file in memory. */
const MAX_BLOB_DOWNLOAD = 200 * 1024 * 1024;

/**
 * Downloads an object to disk.
 *
 * Small files are fetched with a signed request and saved from a Blob so the browser honours the
 * filename (cross-origin `download` attributes are ignored, and the service sends no
 * Content-Disposition). Historical versions always take this path, because presigned URLs cannot
 * carry a `versionId`.
 */
export async function downloadObject(
  client: StorageClient,
  ref: ObjectRef,
  opts: { versionId?: string; size?: number } = {},
): Promise<void> {
  if (!opts.versionId && opts.size !== undefined && opts.size > MAX_BLOB_DOWNLOAD) {
    const url = await client.objects.presign(ref, 'GET', 300);
    window.open(url, '_blank', 'noopener');
    return;
  }
  const blob = await client.objects.getBlob(ref, { versionId: opts.versionId });
  const href = URL.createObjectURL(blob);
  try {
    triggerDownload(href, baseName(ref.key));
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
}
