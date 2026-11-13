import { HardDrive, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { StorageClient, parseEndpoint } from '../api/client';
import { errorMessage } from '../api/errors';
import { CopyButton, Field } from '../components/ui';
import { DEFAULT_ENDPOINT } from '../lib/config';
import { useConnection } from '../state/connection';

type Mode = 'create' | 'existing';

interface NewKey {
  accessKeyId: string;
  secretKey: string;
  ownerId: string;
}

export function ConnectPage() {
  const { connection, connect } = useConnection();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>(connection ? 'existing' : 'create');
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? DEFAULT_ENDPOINT);
  const [ownerId, setOwnerId] = useState(connection?.ownerId ?? '');
  const [accessKeyId, setAccessKeyId] = useState(connection?.accessKeyId ?? '');
  const [secretKey, setSecretKey] = useState(connection?.secretKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NewKey | null>(null);

  function finish(credentials: { ownerId: string; accessKeyId: string; secretKey: string }) {
    connect({ endpoint: parseEndpoint(endpoint).origin, ...credentials });
    navigate('/', { replace: true });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const origin = parseEndpoint(endpoint).origin;
      if (mode === 'create') {
        const owner = ownerId.trim();
        if (!owner) throw new Error('Owner ID is required.');
        const key = await new StorageClient({ endpoint: origin }).auth.createAccessKey(owner);
        setCreated({ ...key, ownerId: owner });
      } else {
        const id = accessKeyId.trim();
        if (!id || !secretKey) throw new Error('Access key ID and secret are both required.');
        // Verify the credentials before saving them: an authenticated listing is the product-level read check.
        await new StorageClient({ endpoint: origin, accessKeyId: id, secretKey }).buckets.list();
        finish({ ownerId: ownerId.trim(), accessKeyId: id, secretKey });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect">
      <div className="connect-card">
        <div className="connect-head">
          <HardDrive size={28} />
          <div>
            <h1>Bucket Storage</h1>
            <p className="muted">Connect to your object storage service</p>
          </div>
        </div>

        {created ? (
          <div className="stack">
            <div className="callout callout-warn">
              <ShieldAlert size={18} />
              <div>
                <strong>Save your secret key now.</strong> The service shows it exactly once and cannot recover it.
              </div>
            </div>
            <KeyValue label="Owner ID" value={created.ownerId} />
            <KeyValue label="Access key ID" value={created.accessKeyId} />
            <KeyValue label="Secret key" value={created.secretKey} />
            <button
              className="btn btn-primary"
              onClick={() => finish({ ownerId: created.ownerId, accessKeyId: created.accessKeyId, secretKey: created.secretKey })}
            >
              I’ve saved it — continue
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <div className="segmented" role="group" aria-label="Connection method">
              <button type="button" aria-pressed={mode === 'create'} className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
                New credentials
              </button>
              <button type="button" aria-pressed={mode === 'existing'} className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>
                Existing credentials
              </button>
            </div>

            <Field label="Service endpoint" hint="Origin of the service, with no path.">
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:4000" inputMode="url" required />
            </Field>

            {mode === 'create' ? (
              <Field
                label="Owner ID"
                hint="The account that will own your buckets. The service does not check or reserve this name."
              >
                <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="my-team" autoFocus required />
              </Field>
            ) : (
              <>
                <Field label="Access key ID">
                  <input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA…" autoComplete="off" spellCheck={false} required />
                </Field>
                <Field label="Secret key">
                  <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="off" required />
                </Field>
                <Field label="Owner ID (optional)" hint="Only used as a display label.">
                  <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} />
                </Field>
              </>
            )}

            {error && (
              <div className="callout callout-error" role="alert">
                {error}
              </div>
            )}

            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Working…' : mode === 'create' ? 'Create access key' : 'Connect'}
            </button>
            <p className="muted small">
              Credentials are kept in this browser’s local storage and used to sign each request in your browser. Use this on a
              machine you trust.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-copy">
      <span className="muted small">{label}</span>
      <div className="row">
        <code className="grow">{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}
