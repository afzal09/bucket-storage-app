import { FolderUp, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { MULTIPART_THRESHOLD } from '../api/uploader';
import { formatBytes } from '../lib/format';
import { nonAsciiWarning, normalizePrefix, validateObjectKey } from '../lib/validation';
import { useToast } from '../state/toast';
import { useUploads } from '../state/uploads';
import { Dialog } from './Dialog';
import { pairsToMap, validateMetadata, type Pair } from '../lib/pairs';
import { PairsEditor } from './PairsEditor';
import { Badge, Field } from './ui';

interface UploadDialogProps {
  bucket: string;
  prefix: string;
  initialFiles: File[];
  /** Keys known to exist in the current listing, used to flag overwrites. */
  existingKeys: Set<string>;
  onClose: () => void;
}

interface Candidate {
  file: File;
  /** Path relative to the destination prefix (folder uploads keep their structure). */
  relativePath: string;
}

function toCandidates(files: File[]): Candidate[] {
  return files.map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
}

export function UploadDialog({ bucket, prefix, initialFiles, existingKeys, onClose }: UploadDialogProps) {
  const uploads = useUploads();
  const toast = useToast();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [candidates, setCandidates] = useState<Candidate[]>(() => toCandidates(initialFiles));
  const [destination, setDestination] = useState(prefix);
  const [metadata, setMetadata] = useState<Pair[]>([]);

  const destinationPrefix = normalizePrefix(destination);
  const rows = useMemo(
    () =>
      candidates.map((candidate) => {
        const key = destinationPrefix + candidate.relativePath;
        return { ...candidate, key, error: validateObjectKey(key), warning: nonAsciiWarning(key), overwrite: existingKeys.has(key) };
      }),
    [candidates, destinationPrefix, existingKeys],
  );
  const metadataError = validateMetadata(metadata);
  const hasBlockingError = rows.some((row) => row.error) || Boolean(metadataError);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setCandidates((current) => [...current, ...toCandidates(Array.from(list))]);
  }

  function submit() {
    if (!rows.length || hasBlockingError) return;
    uploads.add(
      rows.map((row) => ({
        bucket,
        key: row.key,
        file: row.file,
        contentType: row.file.type || undefined,
        userMetadata: pairsToMap(metadata),
      })),
    );
    toast.success(`Uploading ${rows.length} ${rows.length === 1 ? 'file' : 'files'}…`);
    onClose();
  }

  return (
    <Dialog
      title="Upload objects"
      size="lg"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!rows.length || hasBlockingError}>
            <Upload size={16} />
            Upload {rows.length || ''} {rows.length === 1 ? 'file' : 'files'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <button type="button" className="btn" onClick={() => filesInput.current?.click()}>
            <Upload size={16} />
            Add files
          </button>
          <button type="button" className="btn" onClick={() => folderInput.current?.click()}>
            <FolderUp size={16} />
            Add folder
          </button>
          <input ref={filesInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <input
            ref={folderInput}
            type="file"
            hidden
            // Non-standard but widely supported attribute for choosing a directory.
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {rows.length === 0 ? (
          <p className="muted">Choose files to upload, or drop them onto the object list.</p>
        ) : (
          <ul className="file-list">
            {rows.map((row, index) => (
              <li key={`${row.key}-${index}`}>
                <div className="grow">
                  <div className="file-name">{row.key}</div>
                  <div className="muted small">
                    {formatBytes(row.file.size)}
                    {row.file.size > MULTIPART_THRESHOLD && ' · multipart upload'}
                  </div>
                  {row.error && <div className="field-error small">{row.error}</div>}
                  {!row.error && row.warning && <div className="warn-text small">{row.warning}</div>}
                </div>
                {row.overwrite && <Badge tone="warn">new version of existing key</Badge>}
                <button type="button" className="icon-btn" aria-label={`Remove ${row.relativePath}`} onClick={() => setCandidates((c) => c.filter((_, i) => i !== index))}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Field label="Destination folder" hint="Key prefix for these files. Leave empty for the bucket root.">
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. images/2026/" spellCheck={false} />
        </Field>

        <div className="field">
          <span>User metadata (optional)</span>
          <PairsEditor pairs={metadata} onChange={setMetadata} keyLabel="Name" valueLabel="Value" addLabel="Add metadata" />
          {metadataError ? (
            <small className="field-error">{metadataError}</small>
          ) : (
            <small className="muted">Stored with each object as <code>x-amz-meta-*</code>. It cannot be edited later.</small>
          )}
        </div>
      </div>
    </Dialog>
  );
}
