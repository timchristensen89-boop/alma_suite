import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Badge, Button, Card, PageHeader } from '@alma/ui';
import {
  DEFAULT_HANDBOOK_CONTENT,
  resolveHandbookContent,
  type OnboardingPhase,
  type OnboardingStep
} from '../../data/handbook';
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconHandbook
} from '../../lib/icons';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';

const PHASE_ORDER: OnboardingPhase[] = [
  'First day',
  'First week',
  'First month',
  'Ongoing'
];

function phaseTone(phase: OnboardingPhase) {
  switch (phase) {
    case 'First day':
      return 'danger' as const;
    case 'First week':
      return 'warning' as const;
    case 'First month':
      return 'info' as const;
    default:
      return 'muted' as const;
  }
}

function StepCard({ step, index }: { step: OnboardingStep; index: number }) {
  return (
    <article className="onboarding-step">
      <div className="onboarding-step-marker">
        <span className="onboarding-step-number">{index + 1}</span>
      </div>
      <div className="onboarding-step-body">
        <header className="onboarding-step-header">
          <div>
            <h3>{step.title}</h3>
            <p className="muted">{step.description}</p>
          </div>
          {step.contact ? (
            <Badge tone="neutral">Talk to: {step.contact}</Badge>
          ) : null}
        </header>

        {step.actions && step.actions.length > 0 ? (
          <ul className="onboarding-actions">
            {step.actions.map((action, i) => (
              <li key={i}>
                <span className="onboarding-bullet" aria-hidden="true">
                  <IconCheck size={12} />
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {step.systems && step.systems.length > 0 ? (
          <div className="onboarding-systems">
            <span className="eyebrow">Systems</span>
            {step.systems.map((system) => (
              <Badge key={system} tone="indigo">
                {system}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function OnboardingPage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);

  const grouped = useMemo(() => {
    const map = new Map<OnboardingPhase, OnboardingStep[]>();
    PHASE_ORDER.forEach((phase) => map.set(phase, []));
    handbook.onboardingSteps.forEach((step) => {
      const list = map.get(step.phase);
      if (list) list.push(step);
    });
    return map;
  }, [handbook.onboardingSteps]);

  let stepNumber = 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Handbook"
        title="New staff — getting started"
        description="What to read, what to upload, who to ask, and how to start using Alma before working solo."
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
          <strong>{handbook.onboardingSteps.length}</strong>
          <span>steps to cover</span>
        </div>
        <div>
          <strong>
            {handbook.onboardingSteps.filter((s) => s.phase === 'First day').length}
          </strong>
          <span>on day one</span>
        </div>
        <div>
          <strong>
            {new Set(
              handbook.onboardingSteps.flatMap((s) => s.systems ?? [])
            ).size}
          </strong>
          <span>systems to learn</span>
        </div>
      </div>

      {PHASE_ORDER.map((phase) => {
        const steps = grouped.get(phase) ?? [];
        if (steps.length === 0) return null;

        return (
          <section key={phase} className="onboarding-phase">
            <header className="onboarding-phase-header">
              <Badge tone={phaseTone(phase)} dot>
                {phase}
              </Badge>
              <span className="muted small">
                <IconClock size={12} /> {steps.length}{' '}
                {steps.length === 1 ? 'step' : 'steps'}
              </span>
            </header>

            <div className="onboarding-steps">
              {steps.map((step) => {
                stepNumber += 1;
                return (
                  <StepCard key={step.id} step={step} index={stepNumber - 1} />
                );
              })}
            </div>
          </section>
        );
      })}

      <Card>
        <div className="inline-actions" style={{ gap: 12, alignItems: 'flex-start' }}>
          <IconHandbook size={18} />
          <div>
            <strong>Welcome aboard.</strong>{' '}
              <span className="muted">
              Questions? Talk to the Venue Manager first. Anything they cannot
              answer will be escalated.
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
