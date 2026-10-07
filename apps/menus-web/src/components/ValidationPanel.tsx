import type { MenuFillReport, MenuValidationIssue } from '@alma/shared';
import { Badge } from '@alma/ui';

type Props = {
  errors: MenuValidationIssue[];
  warnings: MenuValidationIssue[];
  fill: MenuFillReport | null;
  onJump: (issue: MenuValidationIssue) => void;
};

/** How full the A4 page is. Amber from 92%, red past 100% (which is an error). */
export function OverflowMeter({ fill }: { fill: MenuFillReport | null }) {
  const ratio = fill?.fillRatio ?? 0;
  const percent = Math.round(ratio * 100);
  const tone = !fill ? 'idle' : fill.overflow ? 'over' : ratio > 0.92 ? 'tight' : 'ok';
  return (
    <div className={`overflow-meter is-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-label="Page fill">
      <div className="overflow-meter-head">
        <span>Page fill</span>
        <strong>{fill ? `${percent}%` : '…'}</strong>
      </div>
      <div className="overflow-meter-track">
        <div className="overflow-meter-bar" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className="overflow-meter-note">
        {!fill ? 'Measuring the preview…' : fill.overflow ? 'Past one A4 page — publishing is blocked until it fits.' : ratio > 0.92 ? 'Nearly full. Long descriptions may push it over.' : 'Fits on one A4 page.'}
      </span>
    </div>
  );
}

export function ValidationPanel({ errors, warnings, fill, onJump }: Props) {
  const total = errors.length + warnings.length;
  return (
    <section className="validation-panel" aria-live="polite">
      <OverflowMeter fill={fill} />
      <div className="validation-head">
        <h3>Checks</h3>
        {total === 0 ? <Badge tone="positive" dot>All clear</Badge> : null}
        {errors.length ? <Badge tone="danger" dot>{errors.length} error{errors.length === 1 ? '' : 's'}</Badge> : null}
        {warnings.length ? <Badge tone="warning" dot>{warnings.length} warning{warnings.length === 1 ? '' : 's'}</Badge> : null}
      </div>
      {total === 0 ? (
        <p className="subtle">Dietary tags, prices and the page fit all check out.</p>
      ) : (
        <ul className="validation-list">
          {[...errors, ...warnings].map((issue, index) => (
            <li key={`${issue.code}-${issue.dishKey ?? ''}-${index}`} className={`is-${issue.level}`}>
              <span className="validation-dot" aria-hidden="true" />
              <span className="validation-message">{issue.message}</span>
              {issue.sectionIndex !== undefined ? (
                <button type="button" className="validation-jump" onClick={() => onJump(issue)}>
                  Jump
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="validation-foot subtle">Errors block publishing. Warnings are shown again before you publish.</p>
    </section>
  );
}
