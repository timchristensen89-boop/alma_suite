import { Link, useLocation } from 'react-router-dom';
import { Button, Card, EmptyState } from '@alma/ui';
import { NAV_ITEMS } from '../config/navigation';
import { IconArrowRight, IconSearch } from '../lib/icons';

export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="page-stack">
      <Card padding="none">
        <div className="notfound-hero">
          <div className="notfound-badge" aria-hidden="true">
            404
          </div>
          <EmptyState
            icon={<IconSearch size={26} />}
            title="We couldn't find that page"
            description={
              <>
                <code className="notfound-path">{location.pathname}</code>{' '}
                doesn't match any route in the app. Try one of the sections
                below, or head back to the overview.
              </>
            }
            action={
              <Link to="/">
                <Button>Back to overview</Button>
              </Link>
            }
          />
        </div>
      </Card>

      <Card
        title="Jump to a section"
        subtitle="Every module wired into the app."
      >
        <div className="notfound-grid">
          {NAV_ITEMS.map((item) => (
            <Link key={item.to} to={item.to} className="notfound-link">
              <span className="notfound-link-icon">{item.icon}</span>
              <span className="notfound-link-body">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </span>
              <IconArrowRight size={14} />
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
