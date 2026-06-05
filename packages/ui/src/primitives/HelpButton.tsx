import { useCallback, useRef, useState } from 'react';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

export type HelpFeature = { name: string; desc: string };

export type HelpContent = {
  /** Page / feature title shown at the top of the popover. */
  title: string;
  /** One-sentence summary of what this page is for. */
  intro?: string;
  /** "How to" — ordered steps to use the main flow. */
  steps?: string[];
  /** Key features on this page, each a name + short description. */
  features?: HelpFeature[];
  /** Short practical tips / gotchas. */
  tips?: string[];
};

type Props = HelpContent & {
  /** Unique id so only one help/dismissible layer is open at a time. */
  layerId?: string;
  /** Optional extra className on the anchor. */
  className?: string;
};

/**
 * A small "?" button that opens a popover explaining the current page: what it
 * does, how to use it, its key features, and tips. Shared across the suite so
 * every section can carry a consistent quick how-to.
 */
export function HelpButton({ title, intro, steps, features, tips, layerId, className }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissibleLayer(layerRef, open, close, layerId ?? `help-${title}`);

  return (
    <div ref={layerRef} className={`help-anchor${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="help-trigger"
        aria-label={`How to use ${title}`}
        aria-expanded={open}
        title={`How to use ${title}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open ? (
        <div className="help-panel" role="dialog" aria-label={`How to use ${title}`}>
          <button type="button" className="help-close" onClick={close} aria-label="Close help">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
            </svg>
          </button>

          <div className="help-head">
            <span className="help-eyebrow">How to</span>
            <strong className="help-title">{title}</strong>
            {intro ? <p className="help-intro">{intro}</p> : null}
          </div>

          {steps && steps.length > 0 ? (
            <div className="help-section">
              <span className="help-section-label">Step by step</span>
              <ol className="help-steps">
                {steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {features && features.length > 0 ? (
            <div className="help-section">
              <span className="help-section-label">On this page</span>
              <ul className="help-features">
                {features.map((feature, i) => (
                  <li key={i}>
                    <strong>{feature.name}</strong>
                    <span>{feature.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tips && tips.length > 0 ? (
            <div className="help-section">
              <span className="help-section-label">Good to know</span>
              <ul className="help-tips">
                {tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
