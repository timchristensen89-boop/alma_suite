import type { MenuFillReport, MenuPageFill, MenuValidationIssue } from '@alma/shared';
import { Badge } from '@alma/ui';

type Props = {
  errors: MenuValidationIssue[];
  warnings: MenuValidationIssue[];
  fill: MenuFillReport | null;
  /** "A4 portrait", "A5 landscape" — describeMenuFormat(template.format). */
  formatLabel?: string;
  onJump: (issue: MenuValidationIssue) => void;
};

function toneOf(fill: { fillRatio: number; overflow: boolean } | null): 'idle' | 'over' | 'tight' | 'ok' {
  if (!fill) return 'idle';
  return fill.overflow ? 'over' : fill.fillRatio > 0.92 ? 'tight' : 'ok';
}

function Meter({ label, fill }: { label: string; fill: { fillRatio: number; overflow: boolean } | null }) {
  const percent = Math.round((fill?.fillRatio ?? 0) * 100);
  return (
    <div className={`overflow-meter is-${toneOf(fill)}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-label={`${label} fill`}>
      <div className="overflow-meter-head">
        <span>{label}</span>
        <strong>{fill ? `${percent}% full` : '…'}</strong>
      </div>
      <div className="overflow-meter-track">
        <div className="overflow-meter-bar" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * How full the page is — or each page of a multi-page document. Amber from
 * 92%, red past 100% (which is an error). The copy names the sheet size.
 */
export function OverflowMeter({ fill, formatLabel = 'A4 portrait' }: { fill: MenuFillReport | null; formatLabel?: string }) {
  const pages: MenuPageFill[] = fill?.pages ?? [];
  if (pages.length > 1) {
    const over = pages.filter((page) => page.overflow);
    const tight = pages.filter((page) => !page.overflow && page.fillRatio > 0.92);
    const list = (set: MenuPageFill[]) => set.map((page) => page.page).join(', ');
    const note = over.length
      ? `Page${over.length === 1 ? '' : 's'} ${list(over)} run${over.length === 1 ? 's' : ''} past the sheet — publishing is blocked until every page fits.`
      : tight.length
        ? `Page${tight.length === 1 ? '' : 's'} ${list(tight)} nearly full. Long descriptions may push it over.`
        : `Every page fits its ${formatLabel} sheet.`;
    return (
      <div className={`overflow-meters is-${toneOf(fill)}`}>
        {pages.map((page) => (
          <Meter key={page.page} label={`Page ${page.page}`} fill={page} />
        ))}
        <span className="overflow-meter-note">{note}</span>
      </div>
    );
  }
  const ratio = fill?.fillRatio ?? 0;
  return (
    <div className={`overflow-meter is-${toneOf(fill)}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(Math.round(ratio * 100), 100)} aria-label="Page fill">
      <div className="overflow-meter-head">
        <span>Page fill</span>
        <strong>{fill ? `${Math.round(ratio * 100)}%` : '…'}</strong>
      </div>
      <div className="overflow-meter-track">
        <div className="overflow-meter-bar" style={{ width: `${Math.min(Math.round(ratio * 100), 100)}%` }} />
      </div>
      <span className="overflow-meter-note">
        {!fill
          ? 'Measuring the preview…'
          : fill.overflow
            ? `Past one ${formatLabel} page — publishing is blocked until it fits.`
            : ratio > 0.92
              ? 'Nearly full. Long descriptions may push it over.'
              : `Fits on one ${formatLabel} page.`}
      </span>
    </div>
  );
}

export function ValidationPanel({ errors, warnings, fill, formatLabel, onJump }: Props) {
  const total = errors.length + warnings.length;
  return (
    <section className="validation-panel" aria-live="polite">
      <OverflowMeter fill={fill} formatLabel={formatLabel} />
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
