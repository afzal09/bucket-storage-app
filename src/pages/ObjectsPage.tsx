import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, File as FileIcon, Folder, FolderPlus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ObjectMetadata } from '../api/types';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { CopyDialog } from '../components/CopyDialog';
import { ObjectDrawer } from '../components/ObjectDrawer';
import { UploadDialog } from '../components/UploadDialog';
import { Badge, EmptyBlock, ErrorBlock, Field, LoadingBlock } from '../components/ui';
import { downloadObject } from '../lib/download';
import { baseName, formatBytes, formatDate, toNumber } from '../lib/format';
import { normalizePrefix } from '../lib/validation';
import { useClient } from '../state/connection';
import { keys } from '../state/queries';
import { useToast } from '../state/toast';
import { useBucket } from './BucketLayout';

export function ObjectsPage() {
  const bucket = useBucket();
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const prefix = normalizePrefix(params.get('prefix') ?? '');

  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [copyKey, setCopyKey] = useState<string | null>(null);
  const [deleteKeys, setDeleteKeys] = useState<string[] | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [dragging, setDragging] = useState(false);

  const listing = useInfiniteQuery({
    queryKey: keys.objectsAt(bucket.name, prefix),
    queryFn: ({ pageParam, signal }) =>
      client.objects.list(bucket.name, { prefix, delimiter: '/', marker: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.isTruncated ? last.nextMarker : undefined),
  });

  const { folders, objects } = useMemo(() => {
    const pages = listing.data?.pages ?? [];
    // Delimiter grouping happens after each raw page is selected, so a prefix can repeat across pages.
    const folders = [...new Set(pages.flatMap((p) => p.commonPrefixes))];
    const objects = pages.flatMap((p) => p.contents).filter((o) => o.key !== prefix);
    return { folders, objects };
  }, [listing.data, prefix]);

  const needle = filter.trim().toLowerCase();
  const visibleFolders = needle ? folders.filter((f) => baseName(f).toLowerCase().includes(needle)) : folders;
  const visibleObjects = needle ? objects.filter((o) => baseName(o.key).toLowerCase().includes(needle)) : objects;
  const existingKeys = useMemo(() => new Set(objects.map((o) => o.key)), [objects]);
  const openObject = openKey ? objects.find((o) => o.key === openKey) : undefined;

  const goTo = (next: string) => setParams(next ? { prefix: next } : {}, { replace: false });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.objects(bucket.name) });
    setSelected(new Set());
  };

  const remove = useMutation({
    mutationFn: async (targets: string[]) => {
      const failures: string[] = [];
      let markers = 0;
      for (const key of targets) {
        try {
          const result = await client.objects.delete({ bucket: bucket.name, key });
          if (result.deleteMarker) markers += 1;
        } catch (error) {
          failures.push(`${baseName(key)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { failures, markers, total: targets.length };
    },
    onSuccess: ({ failures, markers, total }) => {
      if (failures.length) toast.error(new Error(`${failures.length} of ${total} could not be deleted — ${failures[0]}`));
      else toast.success(markers ? `Deleted ${total} (delete ${markers === 1 ? 'marker' : 'markers'} added)` : `Deleted ${total} ${total === 1 ? 'object' : 'objects'}`);
      setDeleteKeys(null);
      setOpenKey(null);
      refresh();
      void queryClient.invalidateQueries({ queryKey: keys.versions(bucket.name) });
    },
    onError: toast.error,
  });

  async function quickDownload(object: ObjectMetadata) {
    try {
      await downloadObject(client, { bucket: bucket.name, key: object.key }, { size: toNumber(object.size) });
    } catch (error) {
      toast.error(error);
    }
  }

  const allVisible = visibleObjects.map((o) => o.key);
  const allSelected = allVisible.length > 0 && allVisible.every((k) => selected.has(k));
  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- drag and drop (files only; folders are picked from the upload dialog)
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const dropHandlers = {
    onDragEnter: (event: DragEvent) => hasFiles(event) && (event.preventDefault(), setDragging(true)),
    onDragOver: (event: DragEvent) => hasFiles(event) && event.preventDefault(),
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length) setUploadFiles(files);
    },
  };

  const segments = prefix.split('/').filter(Boolean);
  const isEmpty = !listing.isPending && !listing.isError && folders.length === 0 && objects.length === 0;

  return (
    <div className={`objects ${dragging ? 'dragging' : ''}`} {...dropHandlers}>
      <div className="toolbar">
        <nav className="crumbs" aria-label="Folder path">
          <button className="crumb" onClick={() => goTo('')} disabled={!prefix}>
            {bucket.name}
          </button>
          {segments.map((segment, index) => (
            <span className="row" key={index}>
              <ChevronRight size={14} />
              <button className="crumb" onClick={() => goTo(segments.slice(0, index + 1).join('/') + '/')} disabled={index === segments.length - 1}>
                {segment}
              </button>
            </span>
          ))}
        </nav>
        <div className="row wrap">
          <label className="search">
            <Search size={16} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder" aria-label="Filter loaded items" />
          </label>
          <button className="btn" onClick={refresh} disabled={listing.isFetching} aria-label="Refresh">
            <RefreshCw size={16} className={listing.isFetching ? 'spin' : ''} />
          </button>
          <button className="btn" onClick={() => setNewFolder(true)}>
            <FolderPlus size={16} />
            New folder
          </button>
          <button className="btn btn-primary" onClick={() => setUploadFiles([])}>
            <Upload size={16} />
            Upload
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar" role="status">
          <strong>{selected.size} selected</strong>
          <button className="btn btn-sm btn-danger-outline" onClick={() => setDeleteKeys([...selected])}>
            <Trash2 size={14} />
            Delete
          </button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {listing.isPending ? (
        <LoadingBlock label="Loading objects…" />
      ) : listing.isError ? (
        <ErrorBlock error={listing.error} onRetry={() => listing.refetch()} />
      ) : isEmpty ? (
        <EmptyBlock icon={<Upload size={28} />} title={prefix ? 'This folder is empty' : 'This bucket is empty'}>
          Drop files here or use Upload. Folders are just key prefixes, so a folder appears once it contains an object.
        </EmptyBlock>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    aria-label="Select all objects"
                    checked={allSelected}
                    disabled={allVisible.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(allVisible))}
                  />
                </th>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleFolders.map((folder) => (
                <tr key={folder} className="clickable" onClick={() => goTo(folder)}>
                  <td />
                  <td>
                    <button className="name-btn" onClick={(e) => { e.stopPropagation(); goTo(folder); }}>
                      <Folder size={18} className="icon-folder" />
                      {baseName(folder)}
                    </button>
                  </td>
                  <td className="muted">—</td>
                  <td className="muted">Folder</td>
                  <td className="muted">—</td>
                  <td />
                </tr>
              ))}
              {visibleObjects.map((object) => (
                <tr key={object.key} className={`clickable ${selected.has(object.key) ? 'selected' : ''}`} onClick={() => setOpenKey(object.key)}>
                  <td className="check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${baseName(object.key)}`} checked={selected.has(object.key)} onChange={() => toggle(object.key)} />
                  </td>
                  <td>
                    <button className="name-btn" onClick={(e) => { e.stopPropagation(); setOpenKey(object.key); }}>
                      <FileIcon size={18} className="icon-file" />
                      {baseName(object.key)}
                    </button>
                    {object.storageClass !== 'STANDARD' && <Badge tone="info">{object.storageClass.replace('_', ' ').toLowerCase()}</Badge>}
                  </td>
                  <td>{formatBytes(object.size)}</td>
                  <td className="muted">{object.contentType}</td>
                  <td>{formatDate(object.lastModified)}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" aria-label={`Download ${baseName(object.key)}`} onClick={() => quickDownload(object)}>
                      <Download size={16} />
                    </button>
                    <button className="icon-btn" aria-label={`Delete ${baseName(object.key)}`} onClick={() => setDeleteKeys([object.key])}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {visibleFolders.length + visibleObjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    Nothing matches “{filter}”{listing.hasNextPage && ' in the items loaded so far'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {listing.hasNextPage && (
            <div className="table-foot">
              <button className="btn" onClick={() => listing.fetchNextPage()} disabled={listing.isFetchingNextPage}>
                {listing.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}

      {dragging && <div className="drop-overlay">Drop files to upload to {prefix || 'the bucket root'}</div>}

      {openObject && (
        <ObjectDrawer
          bucket={bucket.name}
          object={openObject}
          versioning={bucket.versioningStatus}
          onClose={() => setOpenKey(null)}
          onCopy={() => setCopyKey(openObject.key)}
          onDelete={() => setDeleteKeys([openObject.key])}
        />
      )}
      {uploadFiles && (
        <UploadDialog bucket={bucket.name} prefix={prefix} initialFiles={uploadFiles} existingKeys={existingKeys} onClose={() => setUploadFiles(null)} />
      )}
      {copyKey && <CopyDialog sourceBucket={bucket.name} sourceKey={copyKey} onClose={() => setCopyKey(null)} />}
      {newFolder && (
        <NewFolderDialog
          prefix={prefix}
          onClose={() => setNewFolder(false)}
          onCreate={(path) => {
            setNewFolder(false);
            goTo(path);
          }}
        />
      )}
      {deleteKeys && (
        <ConfirmDialog
          title={deleteKeys.length === 1 ? `Delete ${baseName(deleteKeys[0])}?` : `Delete ${deleteKeys.length} objects?`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleteKeys)}
          onClose={() => setDeleteKeys(null)}
        >
          <p>
            {bucket.versioningStatus === 'ENABLED'
              ? 'Versioning is enabled, so a delete marker is added and earlier versions are kept. You can remove the marker from the Versions tab.'
              : 'The object is deleted and its latest content is removed from storage.'}
          </p>
          {deleteKeys.length > 1 && (
            <ul className="plain-list">
              {deleteKeys.slice(0, 5).map((key) => (
                <li key={key} className="mono">{key}</li>
              ))}
              {deleteKeys.length > 5 && <li className="muted">…and {deleteKeys.length - 5} more</li>}
            </ul>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function NewFolderDialog({ prefix, onClose, onCreate }: { prefix: string; onClose: () => void; onCreate: (path: string) => void }) {
  const [name, setName] = useState('');
  const clean = name.trim().replace(/^\/+|\/+$/g, '');
  const invalid = clean.split('/').some((s) => s === '.' || s === '..');
  return (
    <Dialog
      title="New folder"
      size="sm"
      onClose={onClose}
      onSubmit={() => clean && !invalid && onCreate(normalizePrefix(prefix + clean))}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!clean || invalid}>Open folder</button>
        </>
      }
    >
      <Field
        label="Folder name"
        hint="Folders are only key prefixes: it will show up in listings after you upload a file into it."
        error={invalid ? 'Names cannot contain “.” or “..” segments.' : null}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} placeholder="reports/2026" />
      </Field>
    </Dialog>
  );
}
