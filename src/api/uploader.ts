import type { StorageClient } from './client';
import type { CompletedPart, PutResult, StringMap } from './types';

/** Every non-final part must be at least 5 MiB (enforced by the server at completion time). */
export const MIN_PART_SIZE = 5 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;
/** Files larger than this are uploaded in parts. */
export const MULTIPART_THRESHOLD = PART_SIZE;

export interface UploadParams {
  bucket: string;
  key: string;
  file: Blob;
  contentType?: string;
  userMetadata?: StringMap;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Uploads one file. Small files use a single PUT; large files use the multipart flow
 * (initiate → parts → complete) and abort the session if anything goes wrong so no
 * orphaned parts are left behind.
 */
export async function uploadFile(client: StorageClient, params: UploadParams): Promise<PutResult> {
  const { bucket, key, file, signal, onProgress } = params;
  const ref = { bucket, key };
  const contentType = params.contentType || 'application/octet-stream';

  if (file.size <= MULTIPART_THRESHOLD) {
    return client.uploadObject(ref, file, {
      contentType,
      userMetadata: params.userMetadata,
      signal,
      onProgress,
    });
  }

  const { uploadId } = await client.multipart.initiate(ref, contentType);
  try {
    const completed: CompletedPart[] = [];
    let uploaded = 0;
    const partCount = Math.ceil(file.size / PART_SIZE);
    for (let index = 0; index < partCount; index += 1) {
      signal?.throwIfAborted();
      const chunk = file.slice(index * PART_SIZE, Math.min(file.size, (index + 1) * PART_SIZE));
      const partNumber = index + 1;
      // Parts are not retried automatically: the contract gives no replay guarantees.
      const part = await client.uploadPart(ref, uploadId, partNumber, chunk, {
        signal,
        onProgress: (loaded) => onProgress?.(uploaded + loaded, file.size),
      });
      uploaded += chunk.size;
      completed.push({ partNumber, etag: part.etag });
    }
    return await client.multipart.complete(ref, uploadId, completed);
  } catch (error) {
    // Best effort: the original error is what the user needs to see.
    await client.multipart.abort(ref, uploadId).catch(() => undefined);
    throw error;
  }
}
