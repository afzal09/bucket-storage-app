import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2, Database } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Bucket } from '../api/types';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Badge, EmptyBlock, ErrorBlock, Field, LoadingBlock } from '../components/ui';
import { formatDate } from '../lib/format';
import { validateBucketName } from '../lib/validation';
import { useClient } from '../state/connection';
import { bucketsKey, useBuckets } from '../state/queries';
import { useToast } from '../state/toast';

const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'me-central-1'];

export function BucketsPage() {
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const buckets = useBuckets();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Bucket | null>(null);

  const remove = useMutation({
    mutationFn: (bucket: Bucket) => client.buckets.delete(bucket.name),
    onSuccess: (_, bucket) => {
      toast.success(`Deleted bucket ${bucket.name}`);
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: bucketsKey });
    },
    onError: toast.error,
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buckets</h1>
          <p className="muted">Buckets owned by your account.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => buckets.refetch()} disabled={buckets.isFetching}>
            <RefreshCw size={16} className={buckets.isFetching ? 'spin' : ''} />
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Create bucket
          </button>
        </div>
      </div>

      {buckets.isPending ? (
        <LoadingBlock label="Loading buckets…" />
      ) : buckets.isError ? (
        <ErrorBlock error={buckets.error} onRetry={() => buckets.refetch()} />
      ) : buckets.data.length === 0 ? (
        <EmptyBlock icon={<Database size={28} />} title="No buckets yet">
          Create your first bucket to start storing objects.
        </EmptyBlock>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Region</th>
                <th>Versioning</th>
                <th>Encryption</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {[...buckets.data]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((bucket) => (
                  <tr key={bucket.id}>
                    <td>
                      <Link to={`/b/${encodeURIComponent(bucket.name)}`} className="link-strong">
                        {bucket.name}
                      </Link>
                    </td>
                    <td>{bucket.region}</td>
                    <td>
                      <Badge tone={bucket.versioningStatus === 'ENABLED' ? 'good' : bucket.versioningStatus === 'SUSPENDED' ? 'warn' : 'neutral'}>
                        {bucket.versioningStatus.toLowerCase()}
                      </Badge>
                    </td>
                    <td>{bucket.defaultEncryption ? <Badge tone="info">{bucket.defaultEncryption.algorithm}</Badge> : <span className="muted">none</span>}</td>
                    <td>{formatDate(bucket.createdAt)}</td>
                    <td className="actions">
                      <button className="icon-btn" aria-label={`Delete bucket ${bucket.name}`} onClick={() => setDeleting(bucket)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateBucketDialog onClose={() => setCreating(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete bucket ${deleting.name}?`}
          confirmLabel="Delete bucket"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        >
          <p>
            Only empty buckets can be deleted. That includes hidden objects: delete markers and old versions count, so a
            versioned bucket must have every version removed first.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function CreateBucketDialog({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [region, setRegion] = useState(REGIONS[0]);
  const [touched, setTouched] = useState(false);
  const error = validateBucketName(name);

  const create = useMutation({
    mutationFn: () => client.buckets.create(name, region),
    onSuccess: (bucket) => {
      toast.success(`Created bucket ${bucket.name}`);
      void queryClient.invalidateQueries({ queryKey: bucketsKey });
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Dialog
      title="Create bucket"
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!error) create.mutate();
      }}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create bucket'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field
          label="Bucket name"
          hint="Globally unique. 3–63 lowercase letters, numbers or hyphens; no dots."
          error={touched ? error : null}
        >
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} onBlur={() => setTouched(true)} autoFocus autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Region" hint="The service does not restrict regions; pick or type any value.">
          <input list="regions" value={region} onChange={(e) => setRegion(e.target.value)} required />
          <datalist id="regions">
            {REGIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
      </div>
    </Dialog>
  );
}
