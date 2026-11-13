import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/errors';
import type { StringMap } from '../api/types';
import { uploadFile } from '../api/uploader';
import { keys } from './queries';
import { useClient } from './connection';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: number;
  bucket: string;
  key: string;
  file: File;
  contentType: string;
  userMetadata: StringMap;
  status: UploadStatus;
  loaded: number;
  error?: string;
}

export interface UploadRequest {
  bucket: string;
  key: string;
  file: File;
  contentType?: string;
  userMetadata?: StringMap;
}

interface UploadsApi {
  items: UploadItem[];
  add: (requests: UploadRequest[]) => void;
  cancel: (id: number) => void;
  retry: (id: number) => void;
  clearFinished: () => void;
}

const MAX_CONCURRENT = 2;
const UploadsContext = createContext<UploadsApi | null>(null);

/**
 * A small global upload queue. It lives above the router outlet so transfers keep running
 * while the user navigates between buckets and pages.
 */
export function UploadProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  // The pump loop needs the latest list synchronously, so mirror state in a ref.
  const itemsRef = useRef<UploadItem[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const nextId = useRef(1);

  const commit = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: number, changes: Partial<UploadItem>) =>
      commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item))),
    [commit],
  );

  const pump = useCallback(function pump() {
    let active = itemsRef.current.filter((item) => item.status === 'uploading').length;
    for (const item of itemsRef.current) {
      if (active >= MAX_CONCURRENT) break;
      if (item.status !== 'queued') continue;
      active += 1;
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      patch(item.id, { status: 'uploading', loaded: 0, error: undefined });

      uploadFile(client, {
        bucket: item.bucket,
        key: item.key,
        file: item.file,
        contentType: item.contentType,
        userMetadata: item.userMetadata,
        signal: controller.signal,
        onProgress: (loaded) => patch(item.id, { loaded }),
      })
        .then(() => {
          patch(item.id, { status: 'done', loaded: item.file.size });
          void queryClient.invalidateQueries({ queryKey: keys.objects(item.bucket) });
          void queryClient.invalidateQueries({ queryKey: keys.versions(item.bucket) });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) patch(item.id, { status: 'cancelled' });
          else patch(item.id, { status: 'error', error: errorMessage(error) });
        })
        .finally(() => {
          controllers.current.delete(item.id);
          pump();
        });
    }
  }, [client, patch, queryClient]);

  const add = useCallback(
    (requests: UploadRequest[]) => {
      const created: UploadItem[] = requests.map((request) => ({
        id: nextId.current++,
        bucket: request.bucket,
        key: request.key,
        file: request.file,
        contentType: request.contentType || request.file.type || 'application/octet-stream',
        userMetadata: request.userMetadata ?? {},
        status: 'queued',
        loaded: 0,
      }));
      commit([...itemsRef.current, ...created]);
      pump();
    },
    [commit, pump],
  );

  const cancel = useCallback(
    (id: number) => {
      const controller = controllers.current.get(id);
      if (controller) controller.abort();
      else patch(id, { status: 'cancelled' });
    },
    [patch],
  );

  const retry = useCallback(
    (id: number) => {
      patch(id, { status: 'queued', loaded: 0, error: undefined });
      pump();
    },
    [patch, pump],
  );

  const clearFinished = useCallback(() => {
    commit(itemsRef.current.filter((item) => item.status === 'queued' || item.status === 'uploading'));
  }, [commit]);

  // Warn before closing the tab while a transfer is in flight.
  const busy = items.some((item) => item.status === 'queued' || item.status === 'uploading');
  useEffect(() => {
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [busy]);

  const value = useMemo<UploadsApi>(
    () => ({ items, add, cancel, retry, clearFinished }),
    [items, add, cancel, retry, clearFinished],
  );
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUploads(): UploadsApi {
  const value = useContext(UploadsContext);
  if (!value) throw new Error('useUploads must be used inside UploadProvider');
  return value;
}
