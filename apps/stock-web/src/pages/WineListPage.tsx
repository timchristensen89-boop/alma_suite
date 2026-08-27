import { useEffect, useMemo, useState } from 'react';
import type { WineListPayload, WineRow } from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, Input, Select, Spinner, Textarea } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

// The wine list, as the printed menu describes it.
//
// Everything editable here is descriptive — grape, region, vintage, the style
// band, the pairing marks, the note. Prices are shown against each pour and are
// deliberately read-only: they belong to the register item, which is where the
// till and the reports read them.

const PAIRS: Array<{ id: 's' | 'r' | 'v'; mark: string; label: string }> = [
  { id: 's', mark: '○', label: 'Seafood & ceviche' },
  { id: 'r', mark: '△', label: 'Rich & grilled' },
  { id: 'v', mark: '◇', label: 'Veg & cheese' }
];

const POUR_LABEL: Record<number, string> = { 60: '60 mL', 150: '150 mL', 250: '250 mL', 375: '375 mL', 750: 'Bottle' };
const pourLabel = (ml: number) => POUR_LABEL[ml] ?? `${ml} mL`;

function money(cents: number | null) {
  return cents === null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function wineName(wine: WineRow) {
  return `${wine.producer}${wine.cuvee ? ` '${wine.cuvee}'` : ''}`;
}

export function WineListPage() {
  useDocumentTitle('Wine list');
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [data, setData] = useState<WineListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [venue, setVenue] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<WineRow | null>(null);
  const [linking, setLinking] = useState<{ recipeId: string; ml: string }>({ recipeId: '', ml: '750' });

  async function load() {
    try {
      setData(await api<WineListPayload>('/api/wines'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the wine list');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.wines.filter((wine) => {
      if (venue && wine.venue !== venue) return false;
      if (!needle) return true;
      const hay = `${wineName(wine)} ${wine.grape ?? ''} ${wine.region ?? ''} ${wine.origin ?? ''} ${wine.section ?? ''} ${wine.tastingNote ?? ''}`;
      return hay.toLowerCase().includes(needle);
    });
  }, [data, venue, search]);

  // A wine nobody can sell: on the list, but no register item behind any size.
  const unsellable = shown.filter((wine) => wine.pours.length === 0).length;
  const unpriced = shown.filter((wine) => wine.pours.some((pour) => pour.priceCents === null)).length;

  function open(wine: WineRow) {
    setOpenId(wine.id === openId ? null : wine.id);
    setDraft({ ...wine, pairsWith: [...wine.pairsWith] });
    setLinking({ recipeId: '', ml: '750' });
    setNote(null);
  }

  function patch(changes: Partial<WineRow>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  function replace(updated: WineRow) {
    setData((current) =>
      current ? { ...current, wines: current.wines.map((wine) => (wine.id === updated.id ? updated : wine)) } : current
    );
    setDraft({ ...updated, pairsWith: [...updated.pairsWith] });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setNote(null);
    try {
      const updated = await api<WineRow>(`/api/wines/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          producer: draft.producer,
          cuvee: draft.cuvee,
          grape: draft.grape,
          region: draft.region,
          origin: draft.origin,
          vintage: draft.vintage,
          section: draft.section,
          styleBand: draft.styleBand,
          pairsWith: draft.pairsWith,
          tastingNote: draft.tastingNote,
          sommelierPour: draft.sommelierPour,
          limitedStock: draft.limitedStock,
          serveChilled: draft.serveChilled
        })
      });
      replace(updated);
      setNote('Saved.');
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not save the wine');
    } finally {
      setSaving(false);
    }
  }

  async function linkPour() {
    if (!draft || !linking.recipeId) return;
    setSaving(true);
    setNote(null);
    try {
      replace(
        await api<WineRow>(`/api/wines/${draft.id}/pours`, {
          method: 'POST',
          body: JSON.stringify({ recipeId: linking.recipeId, ml: Number(linking.ml) })
        })
      );
      setLinking({ recipeId: '', ml: '750' });
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not link that pour');
    } finally {
      setSaving(false);
    }
  }

  async function unlinkPour(pourId: string) {
    setSaving(true);
    setNote(null);
    try {
      replace(await api<WineRow>(`/api/wines/pours/${pourId}`, { method: 'DELETE' }));
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not unlink that pour');
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Card title="Wine list"><p className="error-text">{error}</p></Card>;
  if (!data) return <Card title="Wine list"><Spinner label="Loading the wine list" /></Card>;

  const linkable = data.unlinked.filter((row) => !draft || !row.venue || row.venue === draft.venue);

  return (
    <div className="wine-page">
      <Card
        title="Wine list"
        subtitle="What each wine is, as the printed menu describes it. Prices belong to the register item and are shown here read-only."
      >
        <div className="wine-controls">
          <Input label="Search" value={search} placeholder="Grape, region, producer, a word from the note"
                 onChange={(event) => setSearch(event.currentTarget.value)} />
          <Select
            label="Venue"
            value={venue}
            options={[{ label: 'Both venues', value: '' }, ...data.venues.map((v) => ({ label: v, value: v }))]}
            onChange={(event) => setVenue(event.currentTarget.value)}
          />
        </div>
        <p className="subtle wine-summary">
          {shown.length} of {data.wines.length} wines
          {unsellable > 0 ? ` · ${unsellable} with no register item behind them` : ''}
          {unpriced > 0 ? ` · ${unpriced} with a pour that has no price` : ''}
          {data.unlinked.length > 0 ? ` · ${data.unlinked.length} register items not linked to any wine` : ''}
        </p>
      </Card>

      {shown.length === 0 ? (
        <Card><p className="subtle">No wine matches that.</p></Card>
      ) : null}

      {shown.map((wine) => {
        const isOpen = openId === wine.id && draft?.id === wine.id;
        return (
          <Card key={wine.id} className="wine-card">
            <button type="button" className="wine-head" onClick={() => open(wine)}>
              <span className="wine-title">
                <span className="wine-vintage">{wine.vintage ?? 'NV'}</span>
                <strong>{wineName(wine)}</strong>
                {wine.sommelierPour ? <Badge tone="info">Sommelier pour</Badge> : null}
                {wine.limitedStock ? <Badge tone="warning">Limited</Badge> : null}
                {wine.pours.length === 0 ? <Badge tone="danger">Not in the register</Badge> : null}
              </span>
              <span className="wine-sub">
                {[wine.grape, wine.region && `${wine.region}, ${wine.origin ?? ''}`.trim().replace(/,$/, ''), wine.venue]
                  .filter(Boolean)
                  .join(' · ')}
                <span className="wine-marks">
                  {wine.pairsWith.map((id) => PAIRS.find((pair) => pair.id === id)?.mark).join(' ')}
                </span>
              </span>
              <span className="wine-pours">
                {wine.pours.map((pour) => (
                  <span key={pour.id} className={`wine-pour${pour.priceCents === null ? ' is-unpriced' : ''}`}>
                    <small>{pourLabel(pour.ml)}</small>
                    <b>{money(pour.priceCents)}</b>
                  </span>
                ))}
              </span>
            </button>

            {isOpen && draft ? (
              <div className="wine-edit">
                <div className="wine-fields">
                  <Input label="Producer" value={draft.producer} onChange={(e) => patch({ producer: e.currentTarget.value })} />
                  <Input label="Cuvée" value={draft.cuvee ?? ''} placeholder="The bit in quotes"
                         onChange={(e) => patch({ cuvee: e.currentTarget.value })} />
                  <Input label="Vintage" type="number" value={draft.vintage ?? ''} placeholder="Blank for NV"
                         onChange={(e) => patch({ vintage: e.currentTarget.value ? Number(e.currentTarget.value) : null })} />
                  <Input label="Grape" value={draft.grape ?? ''} placeholder="Or the blend, spelled out"
                         onChange={(e) => patch({ grape: e.currentTarget.value })} />
                  <Input label="Region" value={draft.region ?? ''} onChange={(e) => patch({ region: e.currentTarget.value })} />
                  <Input label="Origin" value={draft.origin ?? ''} placeholder="SA, VIC, FRA…"
                         onChange={(e) => patch({ origin: e.currentTarget.value })} />
                  <Input label="Section" value={draft.section ?? ''} placeholder="The menu heading"
                         onChange={(e) => patch({ section: e.currentTarget.value })} />
                  <Input label="Style band" value={draft.styleBand ?? ''} placeholder="Crisp & refreshing…"
                         onChange={(e) => patch({ styleBand: e.currentTarget.value })} />
                </div>

                <div className="wine-marks-edit">
                  <span className="subtle">Goes with</span>
                  {PAIRS.map((pair) => (
                    <button
                      key={pair.id}
                      type="button"
                      className={draft.pairsWith.includes(pair.id) ? 'is-on' : ''}
                      disabled={!canManage}
                      onClick={() =>
                        patch({
                          pairsWith: draft.pairsWith.includes(pair.id)
                            ? draft.pairsWith.filter((id) => id !== pair.id)
                            : [...draft.pairsWith, pair.id]
                        })
                      }
                    >
                      {pair.mark} {pair.label}
                    </button>
                  ))}
                  <label className="wine-toggle">
                    <input type="checkbox" checked={draft.sommelierPour} disabled={!canManage}
                           onChange={(e) => patch({ sommelierPour: e.currentTarget.checked })} />
                    Sommelier pour
                  </label>
                  <label className="wine-toggle">
                    <input type="checkbox" checked={draft.limitedStock} disabled={!canManage}
                           onChange={(e) => patch({ limitedStock: e.currentTarget.checked })} />
                    Limited
                  </label>
                  <label className="wine-toggle">
                    <input type="checkbox" checked={draft.serveChilled} disabled={!canManage}
                           onChange={(e) => patch({ serveChilled: e.currentTarget.checked })} />
                    Serve chilled
                  </label>
                </div>

                <Textarea label="Tasting note" rows={2} value={draft.tastingNote ?? ''}
                          onChange={(e) => patch({ tastingNote: e.currentTarget.value })} />

                <div className="wine-pours-edit">
                  <span className="subtle">Pours — the price comes from the register item and is not editable here</span>
                  <table className="recipe-lines-table">
                    <thead>
                      <tr><th>Size</th><th>Register item</th><th>Price</th><th aria-label="Actions" /></tr>
                    </thead>
                    <tbody>
                      {draft.pours.map((pour) => (
                        <tr key={pour.id}>
                          <td>{pourLabel(pour.ml)}</td>
                          <td>{pour.recipeTitle}</td>
                          <td>{pour.priceCents === null ? <Badge tone="danger">No price</Badge> : money(pour.priceCents)}</td>
                          <td className="cell-actions">
                            <Button type="button" size="sm" variant="ghost" disabled={!canManage || saving}
                                    onClick={() => void unlinkPour(pour.id)}>
                              Unlink
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {draft.pours.length === 0 ? (
                        <tr><td colSpan={4} className="subtle">Nothing in the register sells this yet.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <div className="wine-link">
                    <Select
                      label="Add a pour"
                      value={linking.recipeId}
                      options={[
                        { label: 'Choose a register item…', value: '' },
                        ...linkable.map((row) => ({
                          label: `${row.title}${row.priceCents === null ? ' (no price)' : ` — ${money(row.priceCents)}`}`,
                          value: row.recipeId
                        }))
                      ]}
                      disabled={!canManage}
                      onChange={(e) => setLinking((current) => ({ ...current, recipeId: e.currentTarget.value }))}
                    />
                    <Input label="Size (mL)" type="number" value={linking.ml}
                           onChange={(e) => setLinking((current) => ({ ...current, ml: e.currentTarget.value }))} />
                    <Button type="button" size="sm" disabled={!canManage || !linking.recipeId || saving}
                            onClick={() => void linkPour()}>
                      Link
                    </Button>
                  </div>
                </div>

                {note ? <ActionFeedback tone={note === 'Saved.' ? 'success' : 'error'} message={note} /> : null}
                <div className="recipe-lines-toolbar">
                  <span style={{ flex: 1 }} />
                  <Button type="button" size="sm" disabled={!canManage || saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : 'Save wine'}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
