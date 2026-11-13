import { ChevronRight } from 'lucide-react';
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { Bucket } from '../api/types';
import { Badge, ErrorBlock, LoadingBlock } from '../components/ui';
import { Link } from 'react-router-dom';
import { useBuckets } from '../state/queries';

export interface BucketContext {
  bucket: Bucket;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBucket(): Bucket {
  return useOutletContext<BucketContext>().bucket;
}

export function BucketLayout() {
  const { bucket: name = '' } = useParams();
  const buckets = useBuckets();
  const bucket = buckets.data?.find((b) => b.name === name);

  if (buckets.isPending) return <LoadingBlock label="Loading bucket…" />;
  if (buckets.isError) return <ErrorBlock error={buckets.error} onRetry={() => buckets.refetch()} />;
  if (!bucket) {
    return (
      <div className="state-block">
        <strong>Bucket “{name}” was not found</strong>
        <span className="muted">It may have been deleted, or it belongs to a different owner than your credentials.</span>
        <Link className="btn" to="/">
          Back to buckets
        </Link>
      </div>
    );
  }

  const base = `/b/${encodeURIComponent(bucket.name)}`;
  const context: BucketContext = { bucket };
  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Buckets</Link>
        <ChevronRight size={14} />
        <span>{bucket.name}</span>
      </nav>
      <div className="page-head">
        <div className="row">
          <h1>{bucket.name}</h1>
          <Badge>{bucket.region}</Badge>
          <Badge tone={bucket.versioningStatus === 'ENABLED' ? 'good' : bucket.versioningStatus === 'SUSPENDED' ? 'warn' : 'neutral'}>
            versioning {bucket.versioningStatus.toLowerCase()}
          </Badge>
          {bucket.defaultEncryption && <Badge tone="info">{bucket.defaultEncryption.algorithm}</Badge>}
        </div>
      </div>
      <nav className="tabs" aria-label="Bucket sections">
        <NavLink to={`${base}/objects`}>
          Objects
        </NavLink>
        <NavLink to={`${base}/versions`}>
          Versions
        </NavLink>
        <NavLink to={`${base}/settings`}>Settings</NavLink>
      </nav>
      <Outlet context={context} />
    </div>
  );
}
