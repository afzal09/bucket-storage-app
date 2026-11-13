import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ExternalLink, Link2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ObjectMetadata, VersionMetadata, VersioningStatus } from '../api/types';
import { downloadObject } from '../lib/download';
import { baseName, formatBytes, formatDate, shortId, toNumber } from '../lib/format';
import { useClient } from '../state/connection';
import { keys } from '../state/queries';
import { useToast } from '../state/toast';
import { ConfirmDialog, Dialog } from './Dialog';
import { mapToPairs, pairsToMap, type Pair } from '../lib/pairs';
import { PairsEditor } from './PairsEditor';
import { Badge, CopyButton, ErrorBlock, LoadingBlock } from './ui';

interface ObjectDrawerProps {
  bucket: string;
  object: ObjectMetadata;
  versioning: VersioningStatus;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function ObjectDrawer({ bucket, object, versioning, onClose, onCopy, onDelete }: ObjectDrawerProps) {
  const client = useClient();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      await downloadObject(client, { bucket, key: object.key }, { size: toNumber(object.size) });
    } catch (error) {
      toast.error(error);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog title={baseName(object.key)} variant="drawer" onClose={onClose}>
      <div className="stack-lg">
        <div className="row wrap">
          <button className="btn btn-primary" onClick={download} disabled={downloading}>
            <Download size={16} />
            {downloading ? 'Downloading…' : 'Download'}
          </button>
          <button className="btn" onClick={onCopy}>
            <Copy size={16} />
            Copy to…
          </button>
          <button className="btn btn-danger-outline" onClick={onDelete}>
            <Trash2 size={16} />
            Delete
          </button>
        </div>

        <section>
          <h3>Overview</h3>
          <dl className="dl">
            <dt>Key</dt>
            <dd className="mono">{object.key}</dd>
            <dt>Size</dt>
            <dd>
              {formatBytes(object.size)} <span className="muted">({toNumber(object.size).toLocaleString()} bytes)</span>
            </dd>
            <dt>Content type</dt>
            <dd>{object.contentType}</dd>
            <dt>Storage class</dt>
            <dd>{object.storageClass.replace('_', ' ').toLowerCase()}</dd>
            <dt>Last modified</dt>
            <dd>{formatDate(object.lastModified)}</dd>
            <dt>ETag</dt>
            <dd className="mono">{object.etag}</dd>
            <dt>Version ID</dt>
            <dd className="mono">{object.versionId}</dd>
          </dl>
          {Object.keys(object.userMetadata ?? {}).length > 0 && (
            <>
              <h4>User metadata</h4>
              <dl className="dl">
                {Object.entries(object.userMetadata).flatMap(([name, value]) => [
                  <dt key={`${name}-k`}>{name}</dt>,
                  <dd key={`${name}-v`}>{value}</dd>,
                ])}
              </dl>
            </>
          )}
        </section>

        <PreviewSection bucket={bucket} object={object} />
        <ShareSection bucket={bucket} objectKey={object.key} />
        <TagsSection bucket={bucket} objectKey={object.key} />
        <VersionsSection bucket={bucket} objectKey={object.key} versioning={versioning} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- preview

const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|xml|html?|css|js|jsx|ts|tsx|sh|py|rb|go|rs|java|sql|toml|ini|env)$/i;
const MAX_TEXT_PREVIEW = 256 * 1024;

type PreviewKind = 'image' | 'video' | 'audio' | 'text' | 'none';

function previewKind(contentType: string, key: string): PreviewKind {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/') && !type.includes('svg')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('text/') || /json|xml|yaml|javascript|csv/.test(type)) return 'text';
  if (type === 'application/octet-stream' && TEXT_EXTENSIONS.test(key)) return 'text';
  return 'none';
}

function PreviewSection({ bucket, object }: { bucket: string; object: ObjectMetadata }) {
  const client = useClient();
  const kind = previewKind(object.contentType, object.key);
  const size = toNumber(object.size);

  // Media elements load straight from a short-lived presigned link (no Authorization header needed).
  const mediaUrl = useQuery({
    queryKey: ['preview-url', bucket, object.key, object.versionId],
    queryFn: () => client.objects.presign({ bucket, key: object.key }, 'GET', 600),
    enabled: kind === 'image' || kind === 'video' || kind === 'audio',
    staleTime: 5 * 60_000,
  });
  const text = useQuery({
    queryKey: ['preview-text', bucket, object.key, object.versionId],
    queryFn: async ({ signal }) => (await client.objects.getBlob({ bucket, key: object.key }, { signal })).text(),
    enabled: kind === 'text' && size <= MAX_TEXT_PREVIEW,
  });

  if (kind === 'none') return null;
  return (
    <section>
      <h3>Preview</h3>
      {kind === 'text' && size > MAX_TEXT_PREVIEW ? (
        <p className="muted">Too large to preview ({formatBytes(size)}). Download it to view.</p>
      ) : kind === 'text' ? (
        text.isPending ? (
          <LoadingBlock label="Loading preview…" />
        ) : text.isError ? (
          <ErrorBlock error={text.error} />
        ) : (
          <pre className="preview-text">{text.data || '(empty file)'}</pre>
        )
      ) : mediaUrl.isPending ? (
        <LoadingBlock label="Loading preview…" />
      ) : mediaUrl.isError ? (
        <ErrorBlock error={mediaUrl.error} />
      ) : kind === 'image' ? (
        <img className="preview-media" src={mediaUrl.data} alt={object.key} />
      ) : kind === 'video' ? (
        <video className="preview-media" src={mediaUrl.data} controls preload="metadata" />
      ) : (
        <audio className="preview-audio" src={mediaUrl.data} controls preload="metadata" />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ share

const EXPIRIES = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
];

function ShareSection({ bucket, objectKey }: { bucket: string; objectKey: string }) {
  const client = useClient();
  const toast = useToast();
  const [seconds, setSeconds] = useState(3600);
  const [link, setLink] = useState<{ url: string; label: string } | null>(null);

  const generate = useMutation({
    mutationFn: () => client.objects.presign({ bucket, key: objectKey }, 'GET', seconds),
    onSuccess: (url) => setLink({ url, label: EXPIRIES.find((e) => e.seconds === seconds)?.label ?? `${seconds}s` }),
    onError: toast.error,
  });

  return (
    <section>
      <h3>Share link</h3>
      <p className="muted small">Anyone who has the link can read the latest version of this object until it expires.</p>
      <div className="row wrap">
        <select aria-label="Link lifetime" value={seconds} onChange={(e) => { setSeconds(Number(e.target.value)); setLink(null); }}>
          {EXPIRIES.map((e) => (
            <option key={e.seconds} value={e.seconds}>
              Expires in {e.label}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => generate.mutate()} disabled={generate.isPending}>
          <Link2 size={16} />
          {generate.isPending ? 'Generating…' : 'Generate link'}
        </button>
      </div>
      {link && (
        <div className="stack">
          <input readOnly value={link.url} aria-label="Presigned URL" onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <CopyButton text={link.url} label="Copy link" />
            <a className="btn btn-sm" href={link.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              Open
            </a>
            <span className="muted small">Valid for {link.label}</span>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- tags

function TagsSection({ bucket, objectKey }: { bucket: string; objectKey: string }) {
  const client = useClient();
  const tags = useQuery({
    queryKey: keys.tags(bucket, objectKey),
    queryFn: () => client.objects.getTags({ bucket, key: objectKey }),
  });

  return (
    <section>
      <h3>Tags</h3>
      {tags.isPending ? (
        <LoadingBlock label="Loading tags…" />
      ) : tags.isError ? (
        <ErrorBlock error={tags.error} onRetry={() => tags.refetch()} />
      ) : (
        <TagsEditor key={JSON.stringify(tags.data.tags)} bucket={bucket} objectKey={objectKey} initial={tags.data.tags} />
      )}
    </section>
  );
}

function TagsEditor({ bucket, objectKey, initial }: { bucket: string; objectKey: string; initial: Record<string, string> }) {
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pairs, setPairs] = useState<Pair[]>(() => mapToPairs(initial));
  const dirty = JSON.stringify(pairsToMap(pairs)) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () => client.objects.setTags({ bucket, key: objectKey }, pairsToMap(pairs)),
    onSuccess: () => {
      toast.success('Tags saved');
      void queryClient.invalidateQueries({ queryKey: keys.tags(bucket, objectKey) });
    },
    onError: toast.error,
  });

  return (
    <div className="stack">
      <PairsEditor pairs={pairs} onChange={setPairs} keyLabel="Tag" valueLabel="Value" addLabel="Add tag" />
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save tags'}
        </button>
        {dirty && (
          <button className="btn btn-sm" onClick={() => setPairs(mapToPairs(initial))}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- versions

function VersionsSection({ bucket, objectKey, versioning }: { bucket: string; objectKey: string; versioning: VersioningStatus }) {
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<VersionMetadata | null>(null);

  const versions = useQuery({
    queryKey: [...keys.versions(bucket), objectKey],
    queryFn: async () => {
      // `prefix` also matches longer keys that start with this one, so keep exact matches only.
      const result = await client.objects.listVersions(bucket, { prefix: objectKey });
      return result.versions.filter((v) => v.key === objectKey);
    },
  });

  const remove = useMutation({
    mutationFn: (version: VersionMetadata) => client.objects.delete({ bucket, key: objectKey }, version.versionId),
    onSuccess: () => {
      toast.success('Version permanently deleted');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: keys.objects(bucket) });
      void queryClient.invalidateQueries({ queryKey: keys.versions(bucket) });
    },
    onError: toast.error,
  });

  async function downloadVersion(version: VersionMetadata) {
    try {
      await downloadObject(client, { bucket, key: objectKey }, { versionId: version.versionId });
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <section>
      <h3>Versions</h3>
      {versioning === 'DISABLED' && (
        <p className="muted small">Versioning is off for this bucket, but the service still keeps earlier versions of overwritten keys.</p>
      )}
      {versions.isPending ? (
        <LoadingBlock label="Loading versions…" />
      ) : versions.isError ? (
        <ErrorBlock error={versions.error} onRetry={() => versions.refetch()} />
      ) : (
        <ul className="version-list">
          {versions.data.map((version) => (
            <li key={version.versionId}>
              <div className="grow">
                <div className="row wrap">
                  <code title={version.versionId}>{shortId(version.versionId)}</code>
                  {version.isLatest && <Badge tone="good">latest</Badge>}
                  {version.isDeleteMarker && <Badge tone="warn">delete marker</Badge>}
                </div>
                <div className="muted small">
                  {formatDate(version.lastModified)}
                  {!version.isDeleteMarker && ` · ${formatBytes(version.size)}`}
                </div>
              </div>
              {!version.isDeleteMarker && (
                <button className="icon-btn" aria-label="Download this version" onClick={() => downloadVersion(version)}>
                  <Download size={16} />
                </button>
              )}
              <button className="icon-btn" aria-label="Delete this version permanently" onClick={() => setRemoving(version)}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
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
            {removing.isDeleteMarker
              ? 'Removing the delete marker makes the previous version visible again.'
              : 'This version’s metadata is removed and cannot be recovered.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
