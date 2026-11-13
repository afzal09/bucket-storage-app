import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VersionMetadata } from '../api/types';
import { ConfirmDialog } from '../components/Dialog';
import { Badge, CopyButton, EmptyBlock, ErrorBlock, LoadingBlock } from '../components/ui';
import { downloadObject } from '../lib/download';
import { formatBytes, formatDate, shortId } from '../lib/format';
import { useClient } from '../state/connection';
import { keys } from '../state/queries';
import { useToast } from '../state/toast';
import { useBucket } from './BucketLayout';

export function VersionsPage() {
  const bucket = useBucket();
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [prefix, setPrefix] = useState('');
  const [removing, setRemoving] = useState<VersionMetadata | null>(null);

  // Debounce so typing a prefix does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setPrefix(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const versions = useQuery({
    queryKey: [...keys.versions(bucket.name), 'all', prefix],
    queryFn: ({ signal }) => client.objects.listVersions(bucket.name, { prefix, signal }),
  });

  const remove = useMutation({
    mutationFn: (version: VersionMetadata) => client.objects.delete({ bucket: bucket.name, key: version.key }, version.versionId),
    onSuccess: () => {
      toast.success('Version permanently deleted');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: keys.versions(bucket.name) });
      void queryClient.invalidateQueries({ queryKey: keys.objects(bucket.name) });
    },
    onError: toast.error,
  });

  async function download(version: VersionMetadata) {
    try {
      await downloadObject(client, { bucket: bucket.name, key: version.key }, { versionId: version.versionId });
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <p className="muted grow">
          Every write keeps the previous version. Delete markers hide a key from the object list; delete the marker to bring the key back.
        </p>
        <div className="row">
          <label className="search">
            <Search size={16} />
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Key prefix" aria-label="Filter by key prefix" />
          </label>
          <button className="btn" onClick={() => versions.refetch()} disabled={versions.isFetching} aria-label="Refresh">
            <RefreshCw size={16} className={versions.isFetching ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {versions.isPending ? (
        <LoadingBlock label="Loading versions…" />
      ) : versions.isError ? (
        <ErrorBlock error={versions.error} onRetry={() => versions.refetch()} />
      ) : versions.data.versions.length === 0 ? (
        <EmptyBlock icon={<History size={28} />} title="No versions">
          {prefix ? 'No keys match this prefix.' : 'Objects you upload will appear here with their history.'}
        </EmptyBlock>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Version</th>
                <th>Status</th>
                <th>Size</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {versions.data.versions.map((version, index) => {
                const firstOfKey = index === 0 || versions.data.versions[index - 1].key !== version.key;
                return (
                  <tr key={version.versionId} className={firstOfKey ? 'group-start' : ''}>
                    <td className="mono">{firstOfKey ? version.key : <span className="muted">↳</span>}</td>
                    <td>
                      <span className="row">
                        <code title={version.versionId}>{shortId(version.versionId)}</code>
                        <CopyButton text={version.versionId} label="" />
                      </span>
                    </td>
                    <td>
                      <span className="row wrap">
                        {version.isLatest && <Badge tone="good">latest</Badge>}
                        {version.isDeleteMarker && <Badge tone="warn">delete marker</Badge>}
                      </span>
                    </td>
                    <td>{version.isDeleteMarker ? <span className="muted">—</span> : formatBytes(version.size)}</td>
                    <td>{formatDate(version.lastModified)}</td>
                    <td className="actions">
                      {!version.isDeleteMarker && (
                        <button className="icon-btn" aria-label={`Download version ${shortId(version.versionId)} of ${version.key}`} onClick={() => download(version)}>
                          <Download size={16} />
                        </button>
                      )}
                      <button className="icon-btn" aria-label={`Delete version ${shortId(version.versionId)} of ${version.key}`} onClick={() => setRemoving(version)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Delete this version permanently?"
          confirmLabel="Delete version"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        >
          <p>
            <code>{removing.key}</code> · <code>{shortId(removing.versionId)}</code>
          </p>
          <p>
            {removing.isDeleteMarker
              ? 'Removing the delete marker makes the previous version visible again.'
              : 'This version cannot be recovered afterwards.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
