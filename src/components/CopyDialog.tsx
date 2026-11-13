import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { baseName } from '../lib/format';
import { validateObjectKey } from '../lib/validation';
import { useClient } from '../state/connection';
import { keys, useBuckets } from '../state/queries';
import { useToast } from '../state/toast';
import { Dialog } from './Dialog';
import { Field } from './ui';

interface CopyDialogProps {
  sourceBucket: string;
  sourceKey: string;
  onClose: () => void;
}

export function CopyDialog({ sourceBucket, sourceKey, onClose }: CopyDialogProps) {
  const client = useClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const buckets = useBuckets();

  const folder = sourceKey.includes('/') ? sourceKey.slice(0, sourceKey.lastIndexOf('/') + 1) : '';
  const [bucket, setBucket] = useState(sourceBucket);
  const [key, setKey] = useState(`${folder}copy-of-${baseName(sourceKey)}`);
  const error = validateObjectKey(key);
  const isSelf = bucket === sourceBucket && key === sourceKey;

  const copy = useMutation({
    mutationFn: () => client.objects.copy({ bucket: sourceBucket, key: sourceKey }, { bucket, key }),
    onSuccess: () => {
      toast.success(`Copied to ${bucket}/${key}`);
      void queryClient.invalidateQueries({ queryKey: keys.objects(bucket) });
      void queryClient.invalidateQueries({ queryKey: keys.versions(bucket) });
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Dialog
      title="Copy object"
      onClose={onClose}
      onSubmit={() => !error && !isSelf && copy.mutate()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={Boolean(error) || isSelf || copy.isPending}>
            {copy.isPending ? 'Copying…' : 'Copy'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">
          Source: <code>{sourceBucket}/{sourceKey}</code>
        </p>
        <Field label="Destination bucket">
          <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {(buckets.data ?? [{ name: sourceBucket }]).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Destination key"
          error={error ?? (isSelf ? 'Choose a different bucket or key.' : null)}
          hint="Content type and user metadata are copied; tags are not."
        >
          <input value={key} onChange={(e) => setKey(e.target.value)} autoFocus spellCheck={false} />
        </Field>
      </div>
    </Dialog>
  );
}
