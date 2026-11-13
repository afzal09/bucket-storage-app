import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { StorageClient } from '../api/client';

export interface Connection {
  endpoint: string;
  ownerId: string;
  accessKeyId: string;
  secretKey: string;
}

interface ConnectionContextValue {
  connection: Connection | null;
  /** Always defined while a connection exists. */
  client: StorageClient | null;
  connect: (connection: Connection) => void;
  disconnect: () => void;
}

const STORAGE_KEY = 'bucket-storage-app.connection';

function load(): Connection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Connection>;
    if (value.endpoint && value.accessKeyId && value.secretKey) {
      return {
        endpoint: value.endpoint,
        ownerId: value.ownerId ?? '',
        accessKeyId: value.accessKeyId,
        secretKey: value.secretKey,
      };
    }
  } catch {
    /* corrupted or unavailable storage: start signed out */
  }
  return null;
}

function save(connection: Connection | null): void {
  try {
    if (connection) localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* the session still works, it just will not survive a reload */
  }
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection | null>(load);

  const client = useMemo(
    () => (connection ? new StorageClient(connection) : null),
    [connection],
  );

  const connect = useCallback(
    (next: Connection) => {
      queryClient.clear();
      save(next);
      setConnection(next);
    },
    [queryClient],
  );

  const disconnect = useCallback(() => {
    queryClient.clear();
    save(null);
    setConnection(null);
  }, [queryClient]);

  const value = useMemo(
    () => ({ connection, client, connect, disconnect }),
    [connection, client, connect, disconnect],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error('useConnection must be used inside ConnectionProvider');
  return value;
}

/** For components that only render while signed in. */
// eslint-disable-next-line react-refresh/only-export-components
export function useClient(): StorageClient {
  const { client } = useConnection();
  if (!client) throw new Error('useClient requires an active connection');
  return client;
}
