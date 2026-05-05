import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, PageHeader } from '@alma/ui';
import {
  DEFAULT_HANDBOOK_CONTENT,
  resolveHandbookContent,
  type Guideline,
  type GuidelineCategory
} from '../../data/handbook';
import { IconArrowLeft, IconCheck, IconHandbook } from '../../lib/icons';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';

const CATEGORY_ORDER: GuidelineCategory[] = [
  'Customer service',
  'Compliance',
  'Emergency',
  'Other'
];

function categoryTone(category: GuidelineCategory) {
  switch (category) {
    case 'Compliance':
      return 'indigo' as const;
    case 'Emergency':
      return 'danger' as const;
    case 'Customer service':
      return 'info' as const;
    default:
      return 'muted' as const;
  }
}

function GuidelineCard({ guideline }: { guideline: Guideline }) {
  const [open, setOpen] = useState(false);

  return (
    <article className={`guideline-card ${open ? 'is-open' : ''}`.trim()}>
      <header className="guideline-card-header">
        <div className="guideline-card-titles">
          <div className="guideline-card-meta">
            <Badge tone={categoryTone(guideline.category)} dot>
              {guideline.category}
            </Badge>
            {guideline.lastUpdated ? (
              <span className="muted small">
                Updated {guideline.lastUpdated}
              </span>
            ) : null}
          </div>
          <h3>{guideline.title}</h3>
          <p>{guideline.summary}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide details' : 'Read more'}
        </Button>
      </header>

      {open ? (
        <div className="guideline-card-body">
          {guideline.sections.map((section) => (
            <section key={section.heading} className="guideline-section">
              <h4>{section.heading}</h4>
              <ul>
                {section.bullets.map((bullet, index) => (
                  <li key={index}>
                    <span className="guideline-bullet" aria-hidden="true">
                      <IconCheck size={12} />
                    </span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {guideline.reminders && guideline.reminders.length > 0 ? (
            <aside className="guideline-reminders">
              <p className="eyebrow">Reminders</p>
              <ul>
                {guideline.reminders.map((reminder, index) => (
                  <li key={index}>{reminder}</li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function GuidelinesPage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);
  const [filter, setFilter] = useState<GuidelineCategory | 'all'>('all');

  const grouped = useMemo(() => {
    const visible =
      filter === 'all'
        ? handbook.guidelines
        : handbook.guidelines.filter((g) => g.category === filter);

    const map = new Map<GuidelineCategory, Guideline[]>();
    CATEGORY_ORDER.forEach((cat) => map.set(cat, []));
    visible.forEach((g) => {
      const list = map.get(g.category);
      if (list) list.push(g);
    });
    return map;
  }, [filter, handbook.guidelines]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<GuidelineCategory, number>();
    CATEGORY_ORDER.forEach((cat) => counts.set(cat, 0));
    handbook.guidelines.forEach((g) => {
      counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    });
    return counts;
  }, [handbook.guidelines]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Handbook"
        title="Staff guidelines"
        description="How we handle customers, alcohol, allergens, and emergencies. Read these once a month, and before your first solo shift."
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

      <div className="guideline-filters">
        <button
          type="button"
          className={`guideline-filter ${filter === 'all' ? 'is-active' : ''}`.trim()}
          onClick={() => setFilter('all')}
        >
          All
          <span className="count">{handbook.guidelines.length}</span>
        </button>
        {CATEGORY_ORDER.map((cat) => {
          const count = categoryCounts.get(cat) ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={cat}
              type="button"
              className={`guideline-filter ${filter === cat ? 'is-active' : ''}`.trim()}
              onClick={() => setFilter(cat)}
            >
              {cat}
              <span className="count">{count}</span>
            </button>
          );
        })}
      </div>

      {Array.from(grouped.entries()).map(([category, items]) => {
        if (items.length === 0) return null;
        return (
          <section key={category} className="guideline-group">
            <header className="guideline-group-header">
              <IconHandbook size={16} />
              <h2>{category}</h2>
              <span className="muted">
                {items.length} {items.length === 1 ? 'guideline' : 'guidelines'}
              </span>
            </header>
            <div className="guideline-list">
              {items.map((guideline) => (
                <GuidelineCard key={guideline.id} guideline={guideline} />
              ))}
            </div>
          </section>
        );
      })}

      <Card padding="tight">
        <p className="muted small" style={{ margin: 0 }}>
          Need to change one of these? Use the handbook editor on the index
          page. This view reads the saved settings content and falls back to the
          source defaults.
        </p>
      </Card>
    </div>
  );
}
