import { useEffect, useRef } from 'react';
import type { PromotionCardAction, PromotionPublishPreview } from '@alma/shared';
import { Badge, Button, Spinner } from '@alma/ui';

type Props = {
  open: boolean;
  preview: PromotionPublishPreview | null;
  loading: boolean;
  publishing: boolean;
  error: string | null;
  isLive: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

const CARD_ACTION_TEXT: Record<PromotionCardAction, string> = {
  NONE: 'No printed card is linked.',
  CURRENT: 'The card’s live PDF already prints these times, price and conditions. It stays as it is.',
  PUBLISH_DRAFT: 'The card has a draft: it is published with the listing, in one step. If the card cannot be published, nothing is.',
  REPUBLISH: 'The card’s live PDF is behind this promotion (the price, times or conditions moved). It is reprinted and published with the listing.',
  UNPUBLISHED: 'The card has never been published and has no draft: the listing goes out without a menu PDF.'
};

/**
 * Publish confirmation for a promotion: what the website would see change,
 * and what happens to the card — with the card's own validation and page
 * fill when it has to be published too.
 */
export function PromotionPublishDialog({ open, preview, loading, publishing, error, isLive, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const errors = preview?.validation.errors ?? [];
  const warnings = preview?.validation.warnings ?? [];
  const card = preview?.card ?? null;
  const cardErrors = card?.preview?.validation.errors ?? [];
  const cardWarnings = card?.preview?.validation.warnings ?? [];
  const canPublish = Boolean(preview?.canPublish) && !publishing;
  const anyWarnings = warnings.length > 0 || cardWarnings.length > 0;

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="promo-publish-title">
      <form method="dialog" className="menu-dialog-body" onSubmit={(event) => event.preventDefault()}>
        <header>
          <span className="menu-dialog-eyebrow">Publish to the website</span>
          <h2 id="promo-publish-title">{isLive ? 'Update the listing' : 'Put it on What’s On'}</h2>
        </header>

        {loading || !preview ? (
          <div className="menu-dialog-loading">
            <Spinner label="Checking the promotion" />
            <span className="subtle">Checking the listing, comparing with what the website shows, checking the card…</span>
          </div>
        ) : (
          <>
            <div className="menu-dialog-status">
              {errors.length + cardErrors.length ? (
                <Badge tone="danger" dot>
                  {errors.length + cardErrors.length} error{errors.length + cardErrors.length === 1 ? '' : 's'}
                </Badge>
              ) : (
                <Badge tone="positive" dot>No errors</Badge>
              )}
              {anyWarnings ? (
                <Badge tone="warning" dot>
                  {warnings.length + cardWarnings.length} warning{warnings.length + cardWarnings.length === 1 ? '' : 's'}
                </Badge>
              ) : null}
              {card ? <Badge tone="neutral">Card: {card.name}</Badge> : <Badge tone="muted">No card</Badge>}
            </div>
            {errors.length ? (
              <ul className="menu-dialog-issues is-error">
                {errors.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
            {warnings.length ? (
              <ul className="menu-dialog-issues is-warning">
                {warnings.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            ) : null}

            <h3>What the website sees</h3>
            {preview.listingChanges.length ? (
              <ul className="promo-changes">
                {preview.listingChanges.map((change, index) => (
                  <li key={index}>{change}</li>
                ))}
              </ul>
            ) : (
              <p className="subtle">No listing changes since the last publish.</p>
            )}

            <h3>The printed card</h3>
            <p className="promo-card-action">{CARD_ACTION_TEXT[card?.action ?? 'NONE']}</p>
            {card?.preview ? (
              <>
                <div className="menu-dialog-status">
                  {cardErrors.length ? <Badge tone="danger" dot>{cardErrors.length} card error{cardErrors.length === 1 ? '' : 's'}</Badge> : <Badge tone="positive" dot>Card ready</Badge>}
                  {card.preview.fill ? (
                    <Badge tone={card.preview.fill.overflow ? 'danger' : 'neutral'}>
                      {card.preview.fill.pages && card.preview.fill.pages.length > 1 ? `Fullest page ${Math.round(card.preview.fill.fillRatio * 100)}%` : `Card ${Math.round(card.preview.fill.fillRatio * 100)}% full`}
                    </Badge>
                  ) : (
                    <Badge tone="danger">{card.preview.renderer.message}</Badge>
                  )}
                </div>
                {cardErrors.length ? (
                  <ul className="menu-dialog-issues is-error">
                    {cardErrors.map((issue, index) => (
                      <li key={index}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
                {cardWarnings.length ? (
                  <ul className="menu-dialog-issues is-warning">
                    {cardWarnings.map((issue, index) => (
                      <li key={index}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
                {card.preview.summary ? <p className="menu-dialog-summary">Card changes: {card.preview.summary}</p> : null}
              </>
            ) : null}
            {anyWarnings ? <p className="subtle">Publishing accepts these warnings as they are.</p> : null}
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}

        <footer className="menu-dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={publishing}>
            Back
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!canPublish}>
            {publishing ? 'Publishing…' : anyWarnings ? 'Publish anyway' : 'Publish'}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
