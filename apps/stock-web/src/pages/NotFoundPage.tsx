import { Link } from 'react-router-dom';
import { Card, EmptyState } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <div className="page-stack">
      <Card>
        <EmptyState
          title="We couldn't find that page"
          description={
            <>
              The URL didn't match any section.{' '}
              <Link to="/">Go to the overview</Link>.
            </>
          }
        />
      </Card>
    </div>
  );
}
