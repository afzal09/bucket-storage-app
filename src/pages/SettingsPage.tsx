import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CorsRule, EncryptionConfig, LifecycleRule, PolicyEffect, PolicyStatement } from '../api/types';
import { ConfirmDialog } from '../components/Dialog';
import { ErrorBlock, Field, LoadingBlock } from '../components/ui';
import { useClient } from '../state/connection';
import { bucketsKey, keys } from '../state/queries';
import { useToast } from '../state/toast';
import { useBucket } from './BucketLayout';

export function SettingsPage() {
  const bucket = useBucket();
  return (
    <div className="stack-lg settings">
      <VersioningCard />
      <EncryptionCard />
      <LifecycleCard />
      <CorsCard />
      <PolicyCard />
      <DangerCard name={bucket.name} />
    </div>
  );
}

function Card({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="card card-pad">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {children}
    </section>
  );
}

/** Loads one config value and hands it to a form that owns its draft state. */
function useConfig<T>(kind: string, load: () => Promise<T>) {
  const bucket = useBucket();
  return useQuery({ queryKey: keys.config(bucket.name, kind), queryFn: load });
}

function useSave<T>(kind: string, label: string, save: () => Promise<T>) {
  const bucket = useBucket();
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: () => {
      toast.success(`${label} saved`);
      void queryClient.invalidateQueries({ queryKey: keys.config(bucket.name, kind) });
      void queryClient.invalidateQueries({ queryKey: bucketsKey });
    },
    onError: toast.error,
  });
}

// ------------------------------------------------------------- versioning

function VersioningCard() {
  const bucket = useBucket();
  const client = useClient();
  const config = useConfig('versioning', () => client.buckets.getVersioning(bucket.name));
  const [choice, setChoice] = useState<'ENABLED' | 'SUSPENDED' | null>(null);
  const current = config.data?.status;
  const next = choice ?? (current === 'SUSPENDED' ? 'SUSPENDED' : 'ENABLED');
  const save = useSave('versioning', 'Versioning', () => client.buckets.setVersioning(bucket.name, next));

  return (
    <Card
      title="Versioning"
      description="When enabled, deleting a key adds a delete marker instead of removing data. Once turned on it can be suspended but never returned to “disabled”."
    >
      {config.isPending ? (
        <LoadingBlock />
      ) : config.isError ? (
        <ErrorBlock error={config.error} onRetry={() => config.refetch()} />
      ) : (
        <div className="row wrap">
          <span>
            Current status: <strong>{current?.toLowerCase()}</strong>
          </span>
          <select aria-label="Versioning status" value={next} onChange={(e) => setChoice(e.target.value as 'ENABLED' | 'SUSPENDED')}>
            <option value="ENABLED">Enabled</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <button className="btn btn-primary" disabled={save.isPending || next === current} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- encryption

function EncryptionCard() {
  const bucket = useBucket();
  const client = useClient();
  const config = useConfig('encryption', () => client.buckets.getEncryption(bucket.name));
  return (
    <Card
      title="Default encryption"
      description="Applied to new objects uploaded with a single request. Existing objects are unchanged, multipart uploads bypass it, and the service has no way to switch it off again."
    >
      {config.isPending ? (
        <LoadingBlock />
      ) : config.isError ? (
        <ErrorBlock error={config.error} onRetry={() => config.refetch()} />
      ) : (
        <EncryptionForm key={JSON.stringify(config.data)} initial={'algorithm' in config.data ? (config.data as EncryptionConfig) : null} />
      )}
    </Card>
  );
}

function EncryptionForm({ initial }: { initial: EncryptionConfig | null }) {
  const bucket = useBucket();
  const client = useClient();
  const [algorithm, setAlgorithm] = useState<EncryptionConfig['algorithm']>(initial?.algorithm ?? 'SSE_S3');
  const [kmsKeyId, setKmsKeyId] = useState(initial?.kmsKeyId ?? '');
  const config: EncryptionConfig = algorithm === 'SSE_KMS' && kmsKeyId.trim() ? { algorithm, kmsKeyId: kmsKeyId.trim() } : { algorithm };
  const dirty = !initial || JSON.stringify(config) !== JSON.stringify(initial);
  const save = useSave('encryption', 'Encryption', () => client.buckets.setEncryption(bucket.name, config));

  return (
    <div className="stack">
      <div className="row wrap">
        <Field label="Algorithm">
          <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as EncryptionConfig['algorithm'])}>
            <option value="SSE_S3">SSE-S3 (service-managed keys)</option>
            <option value="SSE_KMS">SSE-KMS (local envelope simulation)</option>
          </select>
        </Field>
        {algorithm === 'SSE_KMS' && (
          <Field label="KMS key label" hint="Stored for reference; the service does not call an external KMS.">
            <input value={kmsKeyId} onChange={(e) => setKmsKeyId(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : initial ? 'Save' : 'Enable encryption'}
        </button>
        {!initial && <span className="muted small">No default encryption is configured.</span>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- lifecycle

type LifecycleDraft = { id: string; prefix: string; transitionAfterDays: string; targetStorageClass: '' | 'INFREQUENT_ACCESS' | 'ARCHIVE'; expireAfterDays: string };

function LifecycleCard() {
  const bucket = useBucket();
  const client = useClient();
  const config = useConfig('lifecycle', () => client.buckets.getLifecycle(bucket.name));
  return (
    <Card
      title="Lifecycle rules"
      description="A daily sweep (02:00 server time) moves old objects to a cheaper storage class label or expires them. Saving replaces the whole rule set."
    >
      {config.isPending ? (
        <LoadingBlock />
      ) : config.isError ? (
        <ErrorBlock error={config.error} onRetry={() => config.refetch()} />
      ) : (
        <LifecycleForm key={JSON.stringify(config.data.rules)} initial={config.data.rules} />
      )}
    </Card>
  );
}

function LifecycleForm({ initial }: { initial: LifecycleRule[] }) {
  const bucket = useBucket();
  const client = useClient();
  const [rows, setRows] = useState<LifecycleDraft[]>(() =>
    initial.map((r) => ({
      id: r.id,
      prefix: r.prefix ?? '',
      transitionAfterDays: r.transitionAfterDays?.toString() ?? '',
      targetStorageClass: r.targetStorageClass ?? '',
      expireAfterDays: r.expireAfterDays?.toString() ?? '',
    })),
  );

  const update = (index: number, change: Partial<LifecycleDraft>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));

  const { rules, error } = toLifecycleRules(rows);
  const dirty = JSON.stringify(rules) !== JSON.stringify(initial);
  const save = useSave('lifecycle', 'Lifecycle rules', () => client.buckets.setLifecycle(bucket.name, rules));

  return (
    <div className="stack">
      {rows.length === 0 && <p className="muted">No rules configured.</p>}
      {rows.map((row, index) => (
        <fieldset className="rule" key={index}>
          <legend>Rule {index + 1}</legend>
          <div className="grid-2">
            <Field label="Rule ID">
              <input value={row.id} onChange={(e) => update(index, { id: e.target.value })} />
            </Field>
            <Field label="Key prefix" hint="Empty applies to every object.">
              <input value={row.prefix} onChange={(e) => update(index, { prefix: e.target.value })} placeholder="logs/" />
            </Field>
            <Field label="Transition after (days)">
              <input inputMode="numeric" value={row.transitionAfterDays} onChange={(e) => update(index, { transitionAfterDays: e.target.value })} />
            </Field>
            <Field label="Transition to">
              <select value={row.targetStorageClass} onChange={(e) => update(index, { targetStorageClass: e.target.value as LifecycleDraft['targetStorageClass'] })}>
                <option value="">—</option>
                <option value="INFREQUENT_ACCESS">Infrequent access</option>
                <option value="ARCHIVE">Archive</option>
              </select>
            </Field>
            <Field label="Expire after (days)">
              <input inputMode="numeric" value={row.expireAfterDays} onChange={(e) => update(index, { expireAfterDays: e.target.value })} />
            </Field>
            <div className="rule-remove">
              <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                <Trash2 size={14} />
                Remove rule
              </button>
            </div>
          </div>
        </fieldset>
      ))}
      {error && <div className="callout callout-error">{error}</div>}
      <div className="row">
        <button className="btn" onClick={() => setRows([...rows, { id: `rule-${rows.length + 1}`, prefix: '', transitionAfterDays: '', targetStorageClass: '', expireAfterDays: '' }])}>
          <Plus size={16} />
          Add rule
        </button>
        <button className="btn btn-primary" disabled={save.isPending || !dirty || Boolean(error)} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </div>
  );
}

const positiveNumber = (value: string): number | null | undefined => {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function toLifecycleRules(rows: LifecycleDraft[]): { rules: LifecycleRule[]; error: string | null } {
  const rules: LifecycleRule[] = [];
  for (const row of rows) {
    const label = row.id.trim() || 'A rule';
    if (!row.id.trim()) return { rules, error: 'Every rule needs an ID.' };
    const transition = positiveNumber(row.transitionAfterDays);
    const expire = positiveNumber(row.expireAfterDays);
    if (transition === null || expire === null) return { rules, error: `${label}: days must be positive numbers.` };
    if ((transition !== undefined) !== Boolean(row.targetStorageClass)) {
      return { rules, error: `${label}: a transition needs both a number of days and a target class.` };
    }
    if (transition === undefined && expire === undefined) return { rules, error: `${label}: set a transition, an expiry, or both.` };
    const rule: LifecycleRule = { id: row.id.trim() };
    if (row.prefix) rule.prefix = row.prefix;
    if (transition !== undefined && row.targetStorageClass) {
      rule.transitionAfterDays = transition;
      rule.targetStorageClass = row.targetStorageClass;
    }
    if (expire !== undefined) rule.expireAfterDays = expire;
    rules.push(rule);
  }
  return { rules, error: null };
}

// ------------------------------------------------------------------- CORS

const HTTP_METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'];
type CorsDraft = { origins: string; methods: string[]; headers: string };

function CorsCard() {
  const bucket = useBucket();
  const client = useClient();
  const config = useConfig('cors', () => client.buckets.getCors(bucket.name));
  return (
    <Card
      title="CORS rules"
      description="Stored with the bucket for reference. The service currently applies its own global CORS policy, so these rules do not change browser access yet."
    >
      {config.isPending ? (
        <LoadingBlock />
      ) : config.isError ? (
        <ErrorBlock error={config.error} onRetry={() => config.refetch()} />
      ) : (
        <CorsForm key={JSON.stringify(config.data.rules)} initial={config.data.rules} />
      )}
    </Card>
  );
}

const splitList = (value: string) => value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

function CorsForm({ initial }: { initial: CorsRule[] }) {
  const bucket = useBucket();
  const client = useClient();
  const [rows, setRows] = useState<CorsDraft[]>(() =>
    initial.map((r) => ({ origins: r.allowedOrigins.join('\n'), methods: r.allowedMethods, headers: (r.allowedHeaders ?? []).join(', ') })),
  );
  const update = (index: number, change: Partial<CorsDraft>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));

  const rules: CorsRule[] = rows.map((row) => {
    const rule: CorsRule = { allowedOrigins: splitList(row.origins), allowedMethods: row.methods };
    const headers = splitList(row.headers);
    if (headers.length) rule.allowedHeaders = headers;
    return rule;
  });
  const invalid = rules.some((r) => r.allowedOrigins.length === 0 || r.allowedMethods.length === 0);
  const dirty = JSON.stringify(rules) !== JSON.stringify(initial);
  const save = useSave('cors', 'CORS rules', () => client.buckets.setCors(bucket.name, rules));

  return (
    <div className="stack">
      {rows.length === 0 && <p className="muted">No rules configured.</p>}
      {rows.map((row, index) => (
        <fieldset className="rule" key={index}>
          <legend>Rule {index + 1}</legend>
          <div className="stack">
            <Field label="Allowed origins" hint="One per line or comma-separated, e.g. http://localhost:5173">
              <textarea rows={2} value={row.origins} onChange={(e) => update(index, { origins: e.target.value })} spellCheck={false} />
            </Field>
            <div className="field">
              <span>Allowed methods</span>
              <div className="row wrap">
                {HTTP_METHODS.map((method) => (
                  <label className="check-inline" key={method}>
                    <input
                      type="checkbox"
                      checked={row.methods.includes(method)}
                      onChange={(e) => update(index, { methods: e.target.checked ? [...row.methods, method] : row.methods.filter((m) => m !== method) })}
                    />
                    {method}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Allowed headers (optional)">
              <input value={row.headers} onChange={(e) => update(index, { headers: e.target.value })} placeholder="authorization, content-type" spellCheck={false} />
            </Field>
            <div>
              <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                <Trash2 size={14} />
                Remove rule
              </button>
            </div>
          </div>
        </fieldset>
      ))}
      {invalid && <div className="callout callout-error">Each rule needs at least one origin and one method.</div>}
      <div className="row">
        <button className="btn" onClick={() => setRows([...rows, { origins: '', methods: ['GET'], headers: '' }])}>
          <Plus size={16} />
          Add rule
        </button>
        <button className="btn btn-primary" disabled={save.isPending || !dirty || invalid} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- policy

const POLICY_ACTIONS = ['*', 'GetObject', 'PutObject', 'DeleteObject', 'GetObjectTagging', 'PutObjectTagging'];

function PolicyCard() {
  const bucket = useBucket();
  const client = useClient();
  const config = useConfig('policy', () => client.buckets.getPolicy(bucket.name));
  return (
    <Card
      title="Access policy"
      description={
        <>
          Grant or deny other owners access to objects. The bucket owner always has full access, and a <code>*</code> principal still requires a signed request or presigned link. A matching DENY overrides ALLOW. Saving replaces every statement.
        </>
      }
    >
      {config.isPending ? (
        <LoadingBlock />
      ) : config.isError ? (
        <ErrorBlock error={config.error} onRetry={() => config.refetch()} />
      ) : (
        <PolicyForm
          key={JSON.stringify(config.data.map((p) => [p.principal, p.action, p.resourcePattern, p.effect]))}
          initial={config.data.map((p) => ({ principal: p.principal, action: p.action, resourcePattern: p.resourcePattern, effect: p.effect }))}
        />
      )}
    </Card>
  );
}

function PolicyForm({ initial }: { initial: PolicyStatement[] }) {
  const bucket = useBucket();
  const client = useClient();
  const [rows, setRows] = useState<PolicyStatement[]>(initial);
  const update = (index: number, change: Partial<PolicyStatement>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));

  const statements = rows.map((r) => ({ ...r, principal: r.principal.trim(), resourcePattern: r.resourcePattern?.trim() || undefined }));
  const invalid = statements.some((s) => !s.principal);
  const dirty = JSON.stringify(statements) !== JSON.stringify(initial.map((s) => ({ ...s })));
  const save = useSave('policy', 'Policy', () => client.buckets.setPolicy(bucket.name, statements));

  return (
    <div className="stack">
      {rows.length === 0 && <p className="muted">No statements — only the owner can access objects.</p>}
      {rows.map((row, index) => (
        <fieldset className="rule" key={index}>
          <legend>Statement {index + 1}</legend>
          <div className="grid-2">
            <Field label="Effect">
              <select value={row.effect} onChange={(e) => update(index, { effect: e.target.value as PolicyEffect })}>
                <option value="ALLOW">Allow</option>
                <option value="DENY">Deny</option>
              </select>
            </Field>
            <Field label="Principal" hint="An owner ID, or * for everyone.">
              <input value={row.principal} onChange={(e) => update(index, { principal: e.target.value })} placeholder="reader-owner" spellCheck={false} />
            </Field>
            <Field label="Action">
              <select value={row.action} onChange={(e) => update(index, { action: e.target.value })}>
                {POLICY_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a === '*' ? '* (all actions)' : a}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Resource pattern" hint={`Default ${bucket.name}/*`}>
              <input value={row.resourcePattern ?? ''} onChange={(e) => update(index, { resourcePattern: e.target.value })} placeholder={`${bucket.name}/public/*`} spellCheck={false} />
            </Field>
          </div>
          <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
            <Trash2 size={14} />
            Remove statement
          </button>
        </fieldset>
      ))}
      {invalid && <div className="callout callout-error">Every statement needs a principal.</div>}
      <div className="row">
        <button className="btn" onClick={() => setRows([...rows, { principal: '', action: 'GetObject', resourcePattern: `${bucket.name}/*`, effect: 'ALLOW' }])}>
          <Plus size={16} />
          Add statement
        </button>
        <button className="btn btn-primary" disabled={save.isPending || !dirty || invalid} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- danger

function DangerCard({ name }: { name: string }) {
  const client = useClient();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => client.buckets.delete(name),
    onSuccess: () => {
      toast.success(`Deleted bucket ${name}`);
      void queryClient.invalidateQueries({ queryKey: bucketsKey });
      navigate('/');
    },
    onError: toast.error,
  });

  return (
    <section className="card card-pad card-danger">
      <h2>Delete bucket</h2>
      <p className="muted">
        Permanently deletes this bucket. It must be completely empty: delete markers and old versions count as contents, so remove them from the Versions tab first.
      </p>
      <div>
        <button className="btn btn-danger" onClick={() => setConfirming(true)}>
          <Trash2 size={16} />
          Delete this bucket
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Delete bucket ${name}?`}
          confirmLabel="Delete bucket"
          danger
          requireText={name}
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        >
          <p>This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
