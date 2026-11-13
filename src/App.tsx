import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { BucketLayout } from './pages/BucketLayout';
import { BucketsPage } from './pages/BucketsPage';
import { ConnectPage } from './pages/ConnectPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { VersionsPage } from './pages/VersionsPage';
import { useConnection } from './state/connection';

export default function App() {
  const { connection } = useConnection();
  return (
    <Routes>
      <Route path="/connect" element={<ConnectPage />} />
      <Route element={connection ? <AppShell /> : <Navigate to="/connect" replace />}>
        <Route index element={<BucketsPage />} />
        <Route path="b/:bucket" element={<BucketLayout />}>
          <Route index element={<Navigate to="objects" replace />} />
          <Route path="objects" element={<ObjectsPage />} />
          <Route path="versions" element={<VersionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
