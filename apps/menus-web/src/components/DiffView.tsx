import type { MenuDiff } from '@alma/shared';
import { menuDiffIsEmpty } from '@alma/shared';

/**
 * A publish diff, grouped: the heading, then what was added, removed,
 * repriced, retagged, 86'd, moved, and section/footer edits.
 * `templateTitle` is what a blank heading prints ("À la carte").
 */
export function DiffView({ diff, emptyText = 'No content changes.', templateTitle = 'the template title' }: { diff: MenuDiff; emptyText?: string; templateTitle?: string }) {
  if (menuDiffIsEmpty(diff)) return <p className="subtle">{emptyText}</p>;
  const heading = (value: string) => value.trim() || templateTitle;
  const group = (title: string, rows: React.ReactNode[]) =>
    rows.length ? (
      <div className="diff-group" key={title}>
        <h4>{title}</h4>
        <ul>{rows}</ul>
      </div>
    ) : null;
  return (
    <div className="diff-view">
      {group(
        'Heading',
        diff.headingChange
          ? [
              <li key="heading">
                <span className="diff-from">{heading(diff.headingChange.from)}</span> → <span className="diff-to">{heading(diff.headingChange.to)}</span>
              </li>
            ]
          : []
      )}
      {group(
        'Added',
        diff.added.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong> <span className="subtle">in {row.section}</span>
          </li>
        ))
      )}
      {group(
        'Removed',
        diff.removed.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong> <span className="subtle">from {row.section}</span>
          </li>
        ))
      )}
      {group(
        'Price changes',
        diff.priceChanges.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong> <span className="diff-from">{row.from}</span> → <span className="diff-to">{row.to}</span>
          </li>
        ))
      )}
      {group(
        'Tag changes',
        diff.tagChanges.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong> <span className="diff-from">{row.from}</span> → <span className="diff-to">{row.to}</span>
          </li>
        ))
      )}
      {group(
        "86'd / back on",
        diff.visibilityChanges.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong> <span className="subtle">{row.visible ? 'back on the menu' : "86'd (off the print)"}</span>
          </li>
        ))
      )}
      {group(
        'Renamed',
        diff.renamed.map((row) => (
          <li key={row.dishKey}>
            <span className="diff-from">{row.from}</span> → <strong>{row.to}</strong>
          </li>
        ))
      )}
      {group(
        'Description changes',
        diff.descriptionChanges.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong>
            <div className="subtle">
              <span className="diff-from">{row.from}</span> → <span className="diff-to">{row.to}</span>
            </div>
          </li>
        ))
      )}
      {group(
        'Moved',
        diff.moved.map((row) => (
          <li key={row.dishKey}>
            <strong>{row.name}</strong> <span className="subtle">{row.from} → {row.to}</span>
          </li>
        ))
      )}
      {group(
        'Sections',
        diff.sectionChanges.map((line, index) => <li key={index}>{line}</li>)
      )}
      {group(
        'Footer',
        diff.footerChanges.map((line, index) => <li key={index}>{line}</li>)
      )}
    </div>
  );
}
