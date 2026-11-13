import { Link } from 'react-router-dom';
import { EmptyBlock } from '../components/ui';

export function NotFoundPage() {
  return (
    <EmptyBlock title="Page not found">
      <Link to="/">Back to buckets</Link>
    </EmptyBlock>
  );
}
