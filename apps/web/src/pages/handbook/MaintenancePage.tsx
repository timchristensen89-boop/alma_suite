import { Link } from 'react-router-dom';
import { Badge, Button, Card, PageHeader } from '@alma/ui';
import {
  DEFAULT_HANDBOOK_CONTENT,
  resolveHandbookContent,
  type MaintenanceCategory,
  type MaintenanceContact
} from '../../data/handbook';
import {
  IconArrowLeft,
  IconCheck,
  IconMail,
  IconPhone
} from '../../lib/icons';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';

function urgencyTone(urgency: MaintenanceCategory['urgency']) {
  switch (urgency) {
    case 'Immediate':
      return 'danger' as const;
    case 'Same-day':
      return 'warning' as const;
    default:
      return 'muted' as const;
  }
}

function isPlaceholder(value?: string) {
  return !!value && value.trim().startsWith('[');
}

function ContactCard({
  contact,
  role,
  emphasis
}: {
  contact: MaintenanceContact;
  role: 'primary' | 'backup';
  emphasis?: string;
}) {
  const placeholderName = isPlaceholder(contact.name);

  return (
    <div className={`maint-contact maint-contact-${role}`}>
      <div className="maint-contact-head">
        <Badge tone={role === 'primary' ? 'indigo' : 'muted'} dot>
          {role === 'primary' ? 'Call first' : 'Backup'}
        </Badge>
        {emphasis ? <span className="muted small">{emphasis}</span> : null}
      </div>
      <div className="maint-contact-identity">
        <strong className={placeholderName ? 'is-placeholder' : ''}>
          {contact.name}
        </strong>
        <span className="muted">{contact.role}</span>
      </div>
      <div className="maint-contact-links">
        {contact.phone ? (
          <a
            className={`maint-contact-link ${
              isPlaceholder(contact.phone) ? 'is-placeholder' : ''
            }`.trim()}
            href={
              isPlaceholder(contact.phone)
                ? undefined
                : `tel:${contact.phone.replace(/\s+/g, '')}`
            }
          >
            <IconPhone size={12} /> {contact.phone}
          </a>
        ) : null}
        {contact.email ? (
          <a className="maint-contact-link" href={`mailto:${contact.email}`}>
            <IconMail size={12} /> {contact.email}
          </a>
        ) : null}
      </div>
      {contact.availability ? (
        <p className="muted small maint-contact-availability">
          {contact.availability}
        </p>
      ) : null}
      {contact.notes ? (
        <p className="muted small">{contact.notes}</p>
      ) : null}
    </div>
  );
}

function CategoryBlock({ category }: { category: MaintenanceCategory }) {
  return (
    <article className="maint-category">
      <header className="maint-category-header">
        <div>
          <div className="maint-category-meta">
            <Badge tone={urgencyTone(category.urgency)} dot>
              {category.urgency}
            </Badge>
          </div>
          <h3>{category.title}</h3>
          <p className="muted">{category.description}</p>
        </div>
      </header>

      <div className="maint-contacts">
        <ContactCard contact={category.primary} role="primary" />
        {category.backup ? (
          <ContactCard contact={category.backup} role="backup" />
        ) : null}
      </div>

      {category.beforeYouCall && category.beforeYouCall.length > 0 ? (
        <div className="maint-checklist">
          <p className="eyebrow">Before you call</p>
          <ul>
            {category.beforeYouCall.map((item, index) => (
              <li key={index}>
                <span className="maint-bullet" aria-hidden="true">
                  <IconCheck size={12} />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {category.notes ? (
        <div className="maint-notes">
          <p>{category.notes}</p>
        </div>
      ) : null}
    </article>
  );
}

export function MaintenancePage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);
  const placeholderCount = handbook.maintenanceCategories.reduce((acc, cat) => {
    let n = 0;
    if (isPlaceholder(cat.primary.name) || isPlaceholder(cat.primary.phone))
      n += 1;
    if (
      cat.backup &&
      (isPlaceholder(cat.backup.name) || isPlaceholder(cat.backup.phone))
    )
      n += 1;
    return acc + n;
  }, 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Handbook"
        title="Maintenance contacts"
        description="What to check first, when to stop service, and who to contact when something breaks."
        actions={
          <Link to="/handbook">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<IconArrowLeft size={14} />}
            >
              Back to handbook
            </Button>
          </Link>
        }
      />

      <div className="handbook-quick-facts">
        <div>
          <strong>{handbook.maintenanceCategories.length}</strong>
          <span>categories</span>
        </div>
        <div>
          <strong>
            {handbook.maintenanceCategories.filter((c) => c.urgency === 'Immediate').length}
          </strong>
          <span>immediate priority</span>
        </div>
        <div>
          <strong>{placeholderCount}</strong>
          <span>contacts to fill in</span>
        </div>
      </div>

      {placeholderCount > 0 ? (
        <Card>
          <div
            className="inline-actions"
            style={{ gap: 12, alignItems: 'flex-start' }}
          >
            <IconPhone size={18} />
            <div>
              <strong>
                {placeholderCount} contact
                {placeholderCount === 1 ? '' : 's'} still need numbers.
              </strong>{' '}
              <span className="muted">
                Entries wrapped in [brackets] are placeholders. Ask a manager
                before calling an unconfirmed contact.
              </span>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="maint-grid">
        {handbook.maintenanceCategories.map((category) => (
          <CategoryBlock key={category.id} category={category} />
        ))}
      </div>
    </div>
  );
}
