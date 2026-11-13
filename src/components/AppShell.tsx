import { useMutation } from '@tanstack/react-query';
import { HardDrive, KeyRound, LogOut, Server } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useClient, useConnection } from '../state/connection';
import { useToast } from '../state/toast';
import { UploadProvider } from '../state/uploads';
import { ConfirmDialog } from './Dialog';
import { UploadPanel } from './UploadPanel';

export function AppShell() {
  const { connection, disconnect } = useConnection();
  const client = useClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);

  const revoke = useMutation({
    mutationFn: () => client.auth.revokeAccessKey(connection!.accessKeyId),
    onSuccess: () => {
      toast.success('Access key revoked');
      setRevoking(false);
      disconnect();
      navigate('/connect');
    },
    onError: toast.error,
  });

  if (!connection) return null;

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <HardDrive size={20} />
          <span>Bucket Storage</span>
        </Link>
        <div className="topbar-meta">
          <span className="chip" title="Service endpoint">
            <Server size={14} />
            {new URL(connection.endpoint).host}
          </span>
          <span className="chip" title={`Access key ${connection.accessKeyId}`}>
            <KeyRound size={14} />
            {connection.ownerId || connection.accessKeyId}
          </span>
          <button className="btn btn-sm" onClick={() => setRevoking(true)} title="Disable this access key on the server, then sign out">
            Revoke key
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              disconnect();
              navigate('/connect');
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </header>
      <UploadProvider>
        <main className="content">
          <Outlet />
        </main>
        <UploadPanel />
      </UploadProvider>
      {revoking && (
        <ConfirmDialog
          title="Revoke access key?"
          confirmLabel="Revoke and sign out"
          danger
          busy={revoke.isPending}
          onConfirm={() => revoke.mutate()}
          onClose={() => setRevoking(false)}
        >
          <p>
            <code>{connection.accessKeyId}</code> will stop working on the server. The service cannot show you the secret
            again, so this credential is gone for good. Presigned links created with it keep working until they expire.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
