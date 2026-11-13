import { useQuery } from '@tanstack/react-query';
import { useClient } from './connection';

export const bucketsKey = ['buckets'] as const;

export function useBuckets() {
  const client = useClient();
  return useQuery({ queryKey: bucketsKey, queryFn: ({ signal }) => client.buckets.list(signal) });
}

/** Query keys for bucket-scoped data, kept together so mutations can invalidate precisely. */
export const keys = {
  objects: (bucket: string) => ['objects', bucket] as const,
  objectsAt: (bucket: string, prefix: string) => ['objects', bucket, prefix] as const,
  versions: (bucket: string) => ['versions', bucket] as const,
  tags: (bucket: string, key: string) => ['tags', bucket, key] as const,
  config: (bucket: string, kind: string) => ['config', bucket, kind] as const,
};
