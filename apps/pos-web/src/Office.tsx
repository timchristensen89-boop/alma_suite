import { useCallback, useEffect, useState } from 'react';
import { api, messageForError } from './api';
import { QrSheet } from './QrSheet';

// ── POS back office — alma-pos.web.app/#office ─────────────────────────────
// Register settings live here, out of the way of service: printer/docket
// routing, modifier groups, surcharge & discount rules, and each venue's
// business identity. Uses the same session as the register.

const VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Profile = { id: string; name: string; venue?: string | null; matchKind: string; categoriesCsv: string; printerIp: string | null; active: boolean; sortOrder: number };
type Rule = { id: string; kind: string; label: string; percent: number; weekdays: string; holidays: boolean; startMinute: number | null; endMinute: number | null; active: boolean };
type ModGroup = { id: string; name: string; required: boolean; maxSelect: number; categories: string[]; options: Array<{ id: string; name: string; priceCents: number }> };
type Identity = { venue: string; postToReports: boolean; businessName: string; abn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; receiptLogo: string | null ; xeroTenantId: string | null; xeroSalesAccount: string | null; xeroTipsAccount: string | null };
type MenuHide = { id: string; kind: string; key: string; hiddenBy?: string | null; createdAt: string };
type MenuShape = { categories: Array<{ name: string; items: Array<{ recipeId: string; title: string; priceCents: number }> }> };
type Special = { id: string; title: string; salePriceCents: number; category: string; venue: string | null };
type VariantOption = { recipeId: string; label: string; title: string; priceCents: number; self: boolean };
type VariantGroup = { parentRecipeId: string; parentTitle: string; options: VariantOption[] };
type Terminal = {
  id: string;
  venue: string;
  name: string;
  code: string;
  status: string;
  squareDeviceId: string | null;
  pairedAt: string | null;
  lastUsedAt: string | null;
};

export function Office() {
  const [tab, setTab] = useState<'printers' | 'terminals' | 'qr' | 'menu' | 'modifiers' | 'variants' | 'specials' | 'rules' | 'identity'>('printers');
  const [hides, setHides] = useState<MenuHide[]>([]);
  const [fullMenu, setFullMenu] = useState<MenuShape | null>(null);
  const [hideSearch, setHideSearch] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [groups, setGroups] = useState<ModGroup[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [editGroup, setEditGroup] = useState<null | {
    id?: string;
    name: string;
    required: boolean;
    maxSelect: number;
    categoriesCsv: string;
    options: Array<{ name: string; price: string }>;
  }>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);
  const [variantEdit, setVariantEdit] = useState<VariantGroup | null>(null);
  const [variantSearch, setVariantSearch] = useState('');
  const [optionSearch, setOptionSearch] = useState('');
  const [pour, setPour] = useState({ label: 'Glass 150ml', ml: '150', parentMl: '750', price: '' });
  const [specials, setSpecials] = useState<Special[]>([]);
  const [xeroTenants, setXeroTenants] = useState<Array<{ id: string; name: string | null }>>([]);
  const [specialDraft, setSpecialDraft] = useState({ name: '', price: '', kind: 'FOOD', venue: '' });
  const [terminalVenue, setTerminalVenue] = useState(VENUES[0]!);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalName, setTerminalName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [qrItemSearch, setQrItemSearch] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [profileRows, ruleRows, menu] = await Promise.all([
        api<Profile[]>('/api/pos/printer-profiles'),
        api<Rule[]>('/api/pos/rules'),
        api<{ modifierGroups?: ModGroup[] }>('/api/pos/menu')
      ]);
      setProfiles(profileRows);
      setRules(ruleRows);
      setGroups(menu.modifierGroups ?? []);
      setFullMenu(menu as unknown as MenuShape);
      setHides(await api<MenuHide[]>('/api/pos/menu-hides'));
      setVariantGroups(await api<VariantGroup[]>('/api/pos/variants'));
      setSpecials(await api<Special[]>('/api/pos/specials'));
      // Which Xero organisations this connection can post into (blank when
      // Xero isn't connected — the row then just explains that).
      await api<{ tenants?: Array<{ id: string; name: string | null }> }>(
        `/api/pos/xero/status?venue=${encodeURIComponent(VENUES[0] ?? '')}`
      )
        .then((status) => setXeroTenants(status.tenants ?? []))
        .catch(() => setXeroTenants([]));
      setIdentities(await Promise.all(VENUES.map((venue) => api<Identity>(`/api/pos/venue-settings?venue=${encodeURIComponent(venue)}`))));
      setError(null);
    } catch (err) {
      setError(messageForError(err, 'Could not load settings.'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(() => setInfo(null), 4000);
    return () => clearTimeout(timer);
  }, [info]);

  const loadTerminals = useCallback(async (venue: string) => {
    try {
      setTerminals(await api<Terminal[]>(`/api/pos/terminals?venue=${encodeURIComponent(venue)}`));
    } catch (err) {
      setError(messageForError(err, 'Could not load the terminals.'));
    }
  }, []);

  // While a code is on screen the server is the only one who knows whether
  // it's been typed in yet, so poll — otherwise staff pair the terminal and
  // then stare at a screen that still says "waiting".
  useEffect(() => {
    if (tab !== 'terminals') return;
    void loadTerminals(terminalVenue);
    const timer = setInterval(() => void loadTerminals(terminalVenue), 4000);
    return () => clearInterval(timer);
  }, [tab, terminalVenue, loadTerminals]);

  async function pairTerminal() {
    setPairing(true);
    try {
      const created = await api<Terminal>('/api/pos/terminals/pair', {
        method: 'POST',
        body: JSON.stringify({ venue: terminalVenue, name: terminalName.trim() || undefined })
      });
      setTerminalName('');
      setInfo(`Type ${created.code} into the terminal to finish pairing.`);
      await loadTerminals(terminalVenue);
    } catch (err) {
      setError(messageForError(err, 'Square would not issue a device code.'));
    } finally {
      setPairing(false);
    }
  }

  // Guest-menu visibility. Same table as the register hides, a different
  // kind — so one list can be curated without touching the other.
  async function toggleQrHide(kind: 'QR_ITEM' | 'QR_CATEGORY', key: string, hiddenId?: string, label?: string) {
    try {
      if (hiddenId) {
        await api(`/api/pos/menu-hides/${hiddenId}`, { method: 'DELETE' });
      } else {
        await api('/api/pos/menu-hides', { method: 'POST', body: JSON.stringify({ kind, key, hiddenBy: label ?? key }) });
      }
      setHides(await api<MenuHide[]>('/api/pos/menu-hides'));
    } catch (err) {
      setError(messageForError(err, 'Could not change the guest menu.'));
    }
  }

  async function removeTerminal(id: string) {
    try {
      await api(`/api/pos/terminals/${id}`, { method: 'DELETE' });
      await loadTerminals(terminalVenue);
    } catch (err) {
      setError(messageForError(err, 'Could not remove the terminal.'));
    }
  }

  // Receipt logo: read → downscale to ≤320px wide → PNG data URL → save.
  async function uploadLogo(venue: string, file: File) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the image.'));
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Not a readable image.'));
        img.src = dataUrl;
      });
      const scale = Math.min(1, 320 / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const receiptLogo = canvas.toDataURL('image/png');
      await api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue, receiptLogo }) });
      setInfo('Logo saved — it prints on bills, receipts and emails.');
      void refresh();
    } catch (err) {
      setError(messageForError(err, 'Could not upload the logo.'));
    }
  }

  async function saveProfile(profile: Partial<Profile>) {
    try {
      await api('/api/pos/printer-profiles', { method: 'POST', body: JSON.stringify(profile) });
      setInfo('Printer profile saved.');
      void refresh();
    } catch (err) {
      setError(messageForError(err, 'Could not save the profile.'));
    }
  }

  async function saveRule(rule: Partial<Rule>) {
    try {
      await api('/api/pos/rules', { method: 'POST', body: JSON.stringify(rule) });
      setInfo('Rule saved.');
      void refresh();
    } catch (err) {
      setError(messageForError(err, 'Could not save the rule.'));
    }
  }

  const minuteLabel = (minute: number | null) =>
    minute === null ? '—' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  return (
    <div className="office-shell">
      <header className="office-header">
        <img src="/brand/alma-a-mark.png" alt="" className="pos-mark" />
        <strong>Back office</strong>
        <span className="pos-wordmark-chip">POS settings</span>
        <span style={{ flex: 1 }} />
        <a href="/" className="office-back">← Register</a>
      </header>
      <nav className="office-tabs">
        {(
          [
            ['printers', 'Printers & dockets'],
            ['terminals', 'Card terminals'],
            ['qr', 'Table QR codes'],
            ['menu', 'Menu visibility'],
            ['modifiers', 'Modifiers'],
            ['variants', 'Variants'],
            ['specials', 'Specials'],
            ['rules', 'Surcharges & discounts'],
            ['identity', 'Venues & receipts']
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      {error ? <div className="pos-error" onClick={() => setError(null)}>{error}</div> : null}
      {info ? <div className="pos-info" onClick={() => setInfo(null)}>{info}</div> : null}

      <main className="office-main">
        {tab === 'printers' ? (
          <section>
            <p className="office-lead">
              Each profile is a docket station: items route by kind (food / beverage) or by exact categories. Give a profile an
              IP when a physical Epson printer arrives — until then its station shows on the KDS.
            </p>
            {/* Grouped by venue: two venues each with a station called "Kitchen"
                in one flat list is how Avalon's kitchen ended up pointing at
                St Alma's printer. */}
            {(() => {
              const order = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];
              const groups = new Map<string, Profile[]>();
              for (const profile of profiles) {
                const key = profile.venue?.trim() || 'All venues';
                groups.set(key, [...(groups.get(key) ?? []), profile]);
              }
              return [...groups.entries()]
                .sort((a, b) => {
                  const ai = order.indexOf(a[0]);
                  const bi = order.indexOf(b[0]);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
                })
                .map(([venueName, rows]) => (
                  <div key={venueName} className="office-venue-group">
                    <h3 className="office-venue-head">
                      {venueName}
                      <small>
                        {rows.length} station{rows.length === 1 ? '' : 's'}
                        {rows.some((row) => row.printerIp) ? '' : ' · no printer yet'}
                      </small>
                    </h3>
                    {rows.map((profile) => (
              <div key={profile.id} className="office-card">
                <input defaultValue={profile.name} onBlur={(event) => event.currentTarget.value !== profile.name && void saveProfile({ ...profile, name: event.currentTarget.value })} className="office-input office-input-name" />
                {/* A station belongs to one venue, or every venue if left blank. */}
                <select
                  defaultValue={profile.venue ?? ''}
                  onChange={(event) => void saveProfile({ ...profile, venue: event.currentTarget.value })}
                  className="office-input"
                  title="Which venue this printer lives at"
                >
                  <option value="">All venues</option>
                  <option value="Alma Avalon">Alma Avalon</option>
                  <option value="St Alma">St Alma</option>
                  <option value="Functions / Pop-up">Functions / Pop-up</option>
                </select>
                <select defaultValue={profile.matchKind} onChange={(event) => void saveProfile({ ...profile, matchKind: event.currentTarget.value })} className="office-input">
                  <option value="FOOD">Food</option>
                  <option value="BEVERAGE">Beverage</option>
                  <option value="RECEIPT">Receipts (till)</option>
                </select>
                <input defaultValue={profile.categoriesCsv} placeholder="Categories (csv, overrides kind)" onBlur={(event) => event.currentTarget.value !== profile.categoriesCsv && void saveProfile({ ...profile, categoriesCsv: event.currentTarget.value })} className="office-input office-input-wide" />
                <input defaultValue={profile.printerIp ?? ''} placeholder="Printer IP (blank = KDS only)" onBlur={(event) => event.currentTarget.value !== (profile.printerIp ?? '') && void saveProfile({ ...profile, printerIp: event.currentTarget.value })} className="office-input" />
                <label className="office-toggle">
                  <input type="checkbox" defaultChecked={profile.active} onChange={(event) => void saveProfile({ ...profile, active: event.currentTarget.checked })} />
                  Active
                </label>
                <button
                  type="button"
                  className="office-delete"
                  onClick={() => {
                    void api(`/api/pos/printer-profiles/${profile.id}`, { method: 'DELETE' })
                      .then(() => {
                        setInfo('Profile removed.');
                        void refresh();
                      })
                      .catch((err) => setError(messageForError(err, 'Could not remove it.')));
                  }}
                >
                  ✕
                </button>
                {profile.printerIp ? (
                  <div className="office-poll-row">
                    <input
                      readOnly
                      className="office-input office-input-wide"
                      value={`https://api.almagroup.com.au/api/pos/print-poll/${profile.id}`}
                      onFocus={(event) => event.currentTarget.select()}
                      title="Paste this URL into the printer's Server Direct Print settings"
                    />
                    <button
                      type="button"
                      className="office-add"
                      onClick={() => {
                        void api(`/api/pos/printer-profiles/${profile.id}/test`, { method: 'POST' })
                          .then(() => setInfo('Test docket queued — the printer picks it up on its next poll.'))
                          .catch((err) => setError(messageForError(err, 'Could not queue the test.')));
                      }}
                    >
                      Test print
                    </button>
                  </div>
                ) : null}
              </div>
                    ))}
                  </div>
                ));
            })()}
            <button type="button" className="office-add" onClick={() => void saveProfile({ name: 'New station', matchKind: 'FOOD', categoriesCsv: '', sortOrder: profiles.length })}>
              ＋ Add a station
            </button>
          </section>
        ) : null}

        {tab === 'terminals' ? (
          <section>
            <p className="office-lead">
              Square Terminals take the card and the register settles the bill when Square says it went through. There's no IP
              to set — the terminal talks to Square over the internet, so it works on venue wifi or its own 4G.
            </p>
            <div className="office-row">
              <select value={terminalVenue} onChange={(event) => setTerminalVenue(event.currentTarget.value)}>
                {VENUES.map((venue) => (
                  <option key={venue} value={venue}>
                    {venue}
                  </option>
                ))}
              </select>
              <input
                placeholder="Name it (Handheld 1, Front stand…)"
                value={terminalName}
                onChange={(event) => setTerminalName(event.currentTarget.value)}
              />
              <button type="button" className="office-add" disabled={pairing} onClick={() => void pairTerminal()}>
                {pairing ? 'Asking Square…' : '＋ Pair a terminal'}
              </button>
            </div>

            {terminals.length === 0 ? (
              <p className="office-hint">No terminals paired for {terminalVenue} yet.</p>
            ) : (
              <ul className="office-list">
                {terminals.map((terminal) => (
                  <li key={terminal.id} className="office-list-row">
                    <div>
                      <strong>{terminal.name}</strong>
                      {terminal.status === 'PAIRED' ? (
                        <span className="office-pill is-on">Ready</span>
                      ) : terminal.status === 'EXPIRED' ? (
                        <span className="office-pill">Code expired — pair again</span>
                      ) : (
                        <span className="office-pill">Waiting for the code</span>
                      )}
                      {terminal.status === 'PAIRING' ? (
                        <p className="office-hint">
                          On the terminal: <strong>Sign in with a device code</strong>, then type{' '}
                          <code className="office-code">{terminal.code}</code>. This list refreshes on its own.
                        </p>
                      ) : (
                        <p className="office-hint">
                          {terminal.lastUsedAt
                            ? `Last charge ${new Date(terminal.lastUsedAt).toLocaleString('en-AU')}`
                            : 'Not used yet'}
                        </p>
                      )}
                    </div>
                    <button type="button" className="office-danger" onClick={() => void removeTerminal(terminal.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {tab === 'qr' ? (
          <section>
            <p className="office-lead">
              One ordering QR per table, print-ready — cut them out and drop them into the table stands. They come from the
              venue's table list, so adding a table on the floor plan is enough to get its code.
            </p>
            <QrSheet embedded />

            <div className="office-venue-head" style={{ marginTop: 28 }}>
              What guests can order <small>guest menu only</small>
            </div>
            <p className="office-lead">
              What a table can order unattended isn't the same list your staff sell from — a bottle that needs decanting, a
              set menu that needs explaining, anything you'd rather a person handled. Hiding here affects the QR menu only.
              Hiding on <strong>Menu visibility</strong> still hides it everywhere, guests included.
            </p>
            <p className="office-hint">Categories — tap to hide from guests or restore:</p>
            <div className="office-chiprow">
              {(fullMenu?.categories ?? []).map((category) => {
                const hidden = hides.find((hide) => hide.kind === 'QR_CATEGORY' && hide.key.toLowerCase() === category.name.toLowerCase());
                return (
                  <button
                    key={category.name}
                    type="button"
                    className={hidden ? 'is-off' : ''}
                    onClick={() => void toggleQrHide('QR_CATEGORY', category.name, hidden?.id)}
                  >
                    {category.name}
                    {hidden ? ' — hidden' : ''}
                  </button>
                );
              })}
            </div>
            <p className="office-hint">Single items — search, then tap to hide from guests:</p>
            <input
              className="office-input office-input-wide"
              placeholder="Search the menu…"
              value={qrItemSearch}
              onChange={(event) => setQrItemSearch(event.currentTarget.value)}
            />
            <div className="office-chiprow">
              {qrItemSearch.trim().length > 1
                ? (fullMenu?.categories ?? [])
                    .flatMap((category) => category.items)
                    .filter((item) => item.title.toLowerCase().includes(qrItemSearch.trim().toLowerCase()))
                    .slice(0, 40)
                    .map((item) => {
                      const hidden = hides.find((hide) => hide.kind === 'QR_ITEM' && hide.key === item.recipeId);
                      return (
                        <button
                          key={item.recipeId}
                          type="button"
                          className={hidden ? 'is-off' : ''}
                          onClick={() => void toggleQrHide('QR_ITEM', item.recipeId, hidden?.id, item.title)}
                        >
                          {item.title}
                          {hidden ? ' — hidden' : ''}
                        </button>
                      );
                    })
                : null}
            </div>
            {hides.filter((hide) => hide.kind === 'QR_ITEM').length > 0 ? (
              <>
                <p className="office-hint">Hidden from guests:</p>
                <div className="office-chiprow">
                  {hides
                    .filter((hide) => hide.kind === 'QR_ITEM')
                    .map((hide) => (
                      <button key={hide.id} type="button" onClick={() => void toggleQrHide('QR_ITEM', hide.key, hide.id)}>
                        {hide.hiddenBy ?? hide.key} — show
                      </button>
                    ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {tab === 'menu' ? (
          <section>
            <p className="office-lead">
              Hide whole categories or single items from every register and the QR menus. Hiding is curation ("we don't sell
              this here") — 86 stays the sold-out-today toggle on the register.
            </p>
            <p className="office-hint">Categories — tap to hide or restore:</p>
            <div className="office-chiprow">
              {(fullMenu?.categories ?? []).map((category) => (
                <button
                  key={category.name}
                  type="button"
                  className="office-chip"
                  onClick={() => {
                    void api('/api/pos/menu-hides', { method: 'POST', body: JSON.stringify({ kind: 'CATEGORY', key: category.name }) })
                      .then(() => {
                        setInfo(`${category.name} hidden from the POS.`);
                        void refresh();
                      })
                      .catch((err) => setError(messageForError(err, 'Could not hide it.')));
                  }}
                >
                  {category.name}
                </button>
              ))}
              {hides
                .filter((hide) => hide.kind === 'CATEGORY')
                .map((hide) => (
                  <button
                    key={hide.id}
                    type="button"
                    className="office-chip is-hidden"
                    onClick={() => {
                      void api(`/api/pos/menu-hides/${hide.id}`, { method: 'DELETE' })
                        .then(() => {
                          setInfo(`${hide.key} restored.`);
                          void refresh();
                        })
                        .catch((err) => setError(messageForError(err, 'Could not restore it.')));
                    }}
                  >
                    {hide.key} 🚫
                  </button>
                ))}
            </div>
            <p className="office-hint" style={{ marginTop: 14 }}>Items — search, then tap to hide:</p>
            <input className="office-input office-input-wide" placeholder="Search items…" value={hideSearch} onChange={(event) => setHideSearch(event.currentTarget.value)} />
            {hideSearch.trim() ? (
              <div className="office-chiprow">
                {(fullMenu?.categories ?? [])
                  .flatMap((category) => category.items)
                  .filter((item) => item.title.toLowerCase().includes(hideSearch.toLowerCase()))
                  .slice(0, 20)
                  .map((item) => (
                    <button
                      key={item.recipeId}
                      type="button"
                      className="office-chip"
                      onClick={() => {
                        void api('/api/pos/menu-hides', { method: 'POST', body: JSON.stringify({ kind: 'ITEM', key: item.recipeId, hiddenBy: item.title }) })
                          .then(() => {
                            setInfo(`${item.title} hidden from the POS.`);
                            setHideSearch('');
                            void refresh();
                          })
                          .catch((err) => setError(messageForError(err, 'Could not hide it.')));
                      }}
                    >
                      {item.title}
                    </button>
                  ))}
              </div>
            ) : null}
            {hides.filter((hide) => hide.kind === 'ITEM').length > 0 ? (
              <>
                <p className="office-hint" style={{ marginTop: 14 }}>Hidden items — tap to restore:</p>
                <div className="office-chiprow">
                  {hides
                    .filter((hide) => hide.kind === 'ITEM')
                    .map((hide) => (
                      <button
                        key={hide.id}
                        type="button"
                        className="office-chip is-hidden"
                        onClick={() => {
                          void api(`/api/pos/menu-hides/${hide.id}`, { method: 'DELETE' })
                            .then(() => {
                              setInfo('Item restored.');
                              void refresh();
                            })
                            .catch((err) => setError(messageForError(err, 'Could not restore it.')));
                        }}
                      >
                        {(hide as MenuHide & { hiddenBy?: string | null }).hiddenBy ?? `${hide.key.slice(0, 10)}…`} 🚫
                      </button>
                    ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {tab === 'modifiers' ? (
          <section>
            <p className="office-lead">
              Modifier groups attach to menu categories — tapping an item in those categories opens its choices. Prices are
              deltas on top of the item.
            </p>
            {groups.map((group) => (
              <div key={group.id} className="office-card office-card-col">
                <div className="office-row">
                  <strong>{group.name}</strong>
                  <span className="office-hint">
                    {group.required ? 'required' : 'optional'} · up to {group.maxSelect} · categories: {group.categories.join(', ') || '—'}
                  </span>
                  <button
                    type="button"
                    className="office-add"
                    style={{ marginLeft: 'auto' }}
                    onClick={() =>
                      setEditGroup({
                        id: group.id,
                        name: group.name,
                        required: group.required,
                        maxSelect: group.maxSelect,
                        categoriesCsv: group.categories.join(', '),
                        options: group.options.map((option) => ({ name: option.name, price: option.priceCents ? (option.priceCents / 100).toFixed(2) : '' }))
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="office-delete"
                    onClick={() => {
                      void api(`/api/pos/modifier-groups/${group.id}`, { method: 'DELETE' })
                        .then(() => {
                          setInfo('Group removed.');
                          void refresh();
                        })
                        .catch((err) => setError(messageForError(err, 'Could not remove it.')));
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="office-hint">
                  {group.options.map((option) => `${option.name}${option.priceCents ? ` +$${(option.priceCents / 100).toFixed(2)}` : ''}`).join(' · ')}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="office-add"
              onClick={() => setEditGroup({ name: 'New group', required: false, maxSelect: 3, categoriesCsv: '', options: [{ name: '', price: '' }] })}
            >
              ＋ New modifier group
            </button>

            {editGroup ? (
              <div className="office-card office-card-col office-editor">
                <div className="office-row">
                  <input
                    className="office-input office-input-name"
                    value={editGroup.name}
                    placeholder="Group name (e.g. Taco mods)"
                    onChange={(event) => setEditGroup({ ...editGroup, name: event.currentTarget.value })}
                  />
                  <label className="office-toggle">
                    <input type="checkbox" checked={editGroup.required} onChange={(event) => setEditGroup({ ...editGroup, required: event.currentTarget.checked })} />
                    Required
                  </label>
                  <label className="office-toggle">
                    up to
                    <input
                      className="office-input"
                      style={{ width: 48 }}
                      inputMode="numeric"
                      value={String(editGroup.maxSelect)}
                      onChange={(event) => setEditGroup({ ...editGroup, maxSelect: Math.max(1, Number(event.currentTarget.value) || 1) })}
                    />
                    choices
                  </label>
                </div>
                <input
                  className="office-input office-input-wide"
                  value={editGroup.categoriesCsv}
                  placeholder="Categories it applies to (csv, e.g. Tacos, Burritos)"
                  onChange={(event) => setEditGroup({ ...editGroup, categoriesCsv: event.currentTarget.value })}
                />
                {editGroup.options.map((option, index) => (
                  <div key={index} className="office-row">
                    <input
                      className="office-input office-input-wide"
                      value={option.name}
                      placeholder="Option (e.g. Extra cheese)"
                      onChange={(event) =>
                        setEditGroup({ ...editGroup, options: editGroup.options.map((candidate, i) => (i === index ? { ...candidate, name: event.currentTarget.value } : candidate)) })
                      }
                    />
                    <input
                      className="office-input"
                      style={{ width: 90 }}
                      inputMode="decimal"
                      value={option.price}
                      placeholder="+$"
                      onChange={(event) =>
                        setEditGroup({ ...editGroup, options: editGroup.options.map((candidate, i) => (i === index ? { ...candidate, price: event.currentTarget.value } : candidate)) })
                      }
                    />
                    <button type="button" className="office-delete" onClick={() => setEditGroup({ ...editGroup, options: editGroup.options.filter((_, i) => i !== index) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <div className="office-row">
                  <button type="button" className="office-add" onClick={() => setEditGroup({ ...editGroup, options: [...editGroup.options, { name: '', price: '' }] })}>
                    ＋ Option
                  </button>
                  <button
                    type="button"
                    className="office-save"
                    onClick={() => {
                      void api('/api/pos/modifier-groups', {
                        method: 'POST',
                        body: JSON.stringify({
                          id: editGroup.id,
                          name: editGroup.name,
                          required: editGroup.required,
                          maxSelect: editGroup.maxSelect,
                          categoriesCsv: editGroup.categoriesCsv,
                          options: editGroup.options.filter((option) => option.name.trim()).map((option) => ({ name: option.name.trim(), priceCents: Math.round(Number(option.price || '0') * 100) }))
                        })
                      })
                        .then(() => {
                          setInfo('Modifier group saved.');
                          setEditGroup(null);
                          void refresh();
                        })
                        .catch((err) => setError(messageForError(err, 'Could not save the group.')));
                    }}
                  >
                    Save group
                  </button>
                  <button type="button" className="office-add" onClick={() => setEditGroup(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'variants' ? (
          <section>
            <p className="office-lead">
              One tile on the register, several pours: a 150ml glass is a fraction of the same bottle, so selling either
              draws down the same stock and the costs stay true. Pick a product, label its pours, done.
            </p>

            {variantGroups.map((group) => (
              <div key={group.parentRecipeId} className="office-card">
                <strong className="office-variant-title">{group.parentTitle}</strong>
                <span className="office-variant-opts">
                  {group.options.map((option) => `${option.label} $${(option.priceCents / 100).toFixed(2)}`).join(' · ')}
                </span>
                <button
                  type="button"
                  className="office-add"
                  onClick={() => {
                    setVariantEdit(JSON.parse(JSON.stringify(group)) as VariantGroup);
                    setOptionSearch('');
                  }}
                >
                  Edit
                </button>
              </div>
            ))}

            {!variantEdit ? (
              <>
                <h3 className="office-subhead">Start a variant group</h3>
                <input
                  className="office-input office-input-wide"
                  placeholder="Search the menu for the parent item (e.g. the bottle)…"
                  value={variantSearch}
                  onChange={(event) => setVariantSearch(event.currentTarget.value)}
                />
                {variantSearch.trim().length >= 2
                  ? (fullMenu?.categories ?? [])
                      .flatMap((category) => category.items)
                      .filter((item) => item.title.toLowerCase().includes(variantSearch.trim().toLowerCase()))
                      .slice(0, 8)
                      .map((item) => (
                        <button
                          key={item.recipeId}
                          type="button"
                          className="office-row-btn"
                          onClick={() => {
                            const existing = variantGroups.find((group) => group.parentRecipeId === item.recipeId);
                            setVariantEdit(
                              existing
                                ? (JSON.parse(JSON.stringify(existing)) as VariantGroup)
                                : {
                                    parentRecipeId: item.recipeId,
                                    parentTitle: item.title,
                                    options: [{ recipeId: item.recipeId, label: 'Bottle', title: item.title, priceCents: item.priceCents, self: true }]
                                  }
                            );
                            setVariantSearch('');
                            setOptionSearch('');
                          }}
                        >
                          {item.title} <small>${(item.priceCents / 100).toFixed(2)}</small>
                        </button>
                      ))
                  : null}
              </>
            ) : (
              <div className="office-variant-editor">
                <h3 className="office-subhead">📦 {variantEdit.parentTitle}</h3>
                {variantEdit.options.map((option, index) => (
                  <div key={option.recipeId} className="office-card">
                    <input
                      className="office-input"
                      placeholder="Label (e.g. Glass 150ml)"
                      value={option.label}
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        setVariantEdit((current) =>
                          current ? { ...current, options: current.options.map((o, i) => (i === index ? { ...o, label } : o)) } : current
                        );
                      }}
                    />
                    <span className="office-variant-opts">
                      {option.title} · ${(option.priceCents / 100).toFixed(2)}
                      {option.self ? ' · the tile itself' : ''}
                    </span>
                    <button
                      type="button"
                      className="office-delete"
                      onClick={() =>
                        setVariantEdit((current) => (current ? { ...current, options: current.options.filter((_, i) => i !== index) } : current))
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <p className="office-lead">Add an existing menu item as a pour:</p>
                <input
                  className="office-input office-input-wide"
                  placeholder="Search items…"
                  value={optionSearch}
                  onChange={(event) => setOptionSearch(event.currentTarget.value)}
                />
                {optionSearch.trim().length >= 2
                  ? (fullMenu?.categories ?? [])
                      .flatMap((category) => category.items)
                      .filter(
                        (item) =>
                          item.title.toLowerCase().includes(optionSearch.trim().toLowerCase()) &&
                          !variantEdit.options.some((option) => option.recipeId === item.recipeId)
                      )
                      .slice(0, 6)
                      .map((item) => (
                        <button
                          key={item.recipeId}
                          type="button"
                          className="office-row-btn"
                          onClick={() => {
                            setVariantEdit((current) =>
                              current
                                ? {
                                    ...current,
                                    options: [...current.options, { recipeId: item.recipeId, label: '', title: item.title, priceCents: item.priceCents, self: false }]
                                  }
                                : current
                            );
                            setOptionSearch('');
                          }}
                        >
                          {item.title} <small>${(item.priceCents / 100).toFixed(2)}</small>
                        </button>
                      ))
                  : null}

                <p className="office-lead">…or create a new pour from the same bottle:</p>
                <div className="office-card">
                  <input className="office-input" placeholder="Label" value={pour.label} onChange={(event) => setPour({ ...pour, label: event.currentTarget.value })} />
                  <input className="office-input office-input-num" placeholder="Pour ml" inputMode="numeric" value={pour.ml} onChange={(event) => setPour({ ...pour, ml: event.currentTarget.value })} />
                  <input className="office-input office-input-num" placeholder="Bottle ml" inputMode="numeric" value={pour.parentMl} onChange={(event) => setPour({ ...pour, parentMl: event.currentTarget.value })} />
                  <input className="office-input office-input-num" placeholder="Price $" inputMode="decimal" value={pour.price} onChange={(event) => setPour({ ...pour, price: event.currentTarget.value })} />
                  <button
                    type="button"
                    className="office-add"
                    onClick={() => {
                      const priceCents = Math.round(Number(pour.price) * 100);
                      void (async () => {
                        try {
                          await api(`/api/pos/variants/${variantEdit.parentRecipeId}`, {
                            method: 'PUT',
                            body: JSON.stringify({ options: variantEdit.options.filter((option) => option.label.trim()).map((option) => ({ recipeId: option.recipeId, label: option.label.trim() })) })
                          });
                          await api(`/api/pos/variants/${variantEdit.parentRecipeId}/pour`, {
                            method: 'POST',
                            body: JSON.stringify({ label: pour.label.trim() || 'Glass', ml: Number(pour.ml), parentMl: Number(pour.parentMl), priceCents })
                          });
                          const fresh = await api<VariantGroup[]>('/api/pos/variants');
                          setVariantGroups(fresh);
                          const mine = fresh.find((group) => group.parentRecipeId === variantEdit.parentRecipeId);
                          if (mine) setVariantEdit(JSON.parse(JSON.stringify(mine)) as VariantGroup);
                          setPour({ label: 'Glass 150ml', ml: '150', parentMl: pour.parentMl, price: '' });
                          setInfo('Pour created — it draws down the same bottle.');
                        } catch (err) {
                          setError(messageForError(err, 'Could not create the pour.'));
                        }
                      })();
                    }}
                  >
                    Create pour
                  </button>
                </div>

                <div className="office-variant-actions">
                  <button
                    type="button"
                    className="office-add"
                    onClick={() => {
                      const options = variantEdit.options.filter((option) => option.label.trim());
                      if (options.length !== variantEdit.options.length) {
                        setError('Give every option a label first.');
                        return;
                      }
                      void api(`/api/pos/variants/${variantEdit.parentRecipeId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ options: options.map((option) => ({ recipeId: option.recipeId, label: option.label.trim() })) })
                      })
                        .then(() => {
                          setInfo('Variant group saved.');
                          setVariantEdit(null);
                          void refresh();
                        })
                        .catch((err) => setError(messageForError(err, 'Could not save the group.')));
                    }}
                  >
                    Save group
                  </button>
                  <button
                    type="button"
                    className="office-delete"
                    onClick={() => {
                      void api(`/api/pos/variants/${variantEdit.parentRecipeId}`, { method: 'DELETE' })
                        .then(() => {
                          setInfo('Variant group removed (the items stay on the menu).');
                          setVariantEdit(null);
                          void refresh();
                        })
                        .catch((err) => setError(messageForError(err, 'Could not remove it.')));
                    }}
                  >
                    Delete group
                  </button>
                  <button type="button" className="office-back" onClick={() => setVariantEdit(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {tab === 'specials' ? (
          <section>
            <p className="office-lead">
              Tonight's food and drink specials — they appear on every register under Food Specials / Drink Specials the
              moment you add them, route to the right printer, and retire with one tap when they sell out for good.
            </p>
            <div className="office-card">
              <input
                className="office-input office-input-wide"
                placeholder="Special (e.g. Market Fish Tostada)"
                value={specialDraft.name}
                onChange={(event) => setSpecialDraft({ ...specialDraft, name: event.currentTarget.value })}
              />
              <input
                className="office-input office-input-num"
                placeholder="Price $"
                inputMode="decimal"
                value={specialDraft.price}
                onChange={(event) => setSpecialDraft({ ...specialDraft, price: event.currentTarget.value })}
              />
              <select
                className="office-input"
                value={specialDraft.kind}
                onChange={(event) => setSpecialDraft({ ...specialDraft, kind: event.currentTarget.value })}
              >
                <option value="FOOD">Food special</option>
                <option value="BEVERAGE">Drink special</option>
              </select>
              <select
                className="office-input"
                value={specialDraft.venue}
                onChange={(event) => setSpecialDraft({ ...specialDraft, venue: event.currentTarget.value })}
              >
                <option value="">Both venues</option>
                {VENUES.map((venueName) => (
                  <option key={venueName} value={venueName}>
                    {venueName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="office-add"
                disabled={!specialDraft.name.trim() || !Number(specialDraft.price)}
                onClick={() => {
                  void api('/api/pos/specials', {
                    method: 'POST',
                    body: JSON.stringify({
                      name: specialDraft.name.trim(),
                      priceCents: Math.round(Number(specialDraft.price) * 100),
                      kind: specialDraft.kind,
                      venue: specialDraft.venue
                    })
                  })
                    .then(() => {
                      setSpecialDraft({ name: '', price: '', kind: specialDraft.kind, venue: specialDraft.venue });
                      setInfo('Special is live on the registers.');
                      void refresh();
                    })
                    .catch((err) => setError(messageForError(err, 'Could not add the special.')));
                }}
              >
                ＋ Add special
              </button>
            </div>
            {specials.map((special) => (
              <div key={special.id} className="office-card">
                <strong className="office-variant-title">{special.title}</strong>
                <span className="office-variant-opts">
                  {special.category} · ${(special.salePriceCents / 100).toFixed(2)} · {special.venue ?? 'both venues'}
                </span>
                <button
                  type="button"
                  className="office-delete"
                  title="Retire the special"
                  onClick={() => {
                    void api(`/api/pos/specials/${special.id}`, { method: 'DELETE' })
                      .then(() => {
                        setInfo('Special retired.');
                        void refresh();
                      })
                      .catch((err) => setError(messageForError(err, 'Could not retire it.')));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {specials.length === 0 ? <p className="office-lead">No specials running.</p> : null}
          </section>
        ) : null}

        {tab === 'rules' ? (
          <section>
            <p className="office-lead">
              Automatic percentage rules the register applies to every bill: weekend or public-holiday surcharges, standing
              discounts. Holiday rules replace weekday rules — never stack.
            </p>
            {rules.map((rule) => (
              <div key={rule.id} className="office-card">
                <input defaultValue={rule.label} onBlur={(event) => event.currentTarget.value !== rule.label && void saveRule({ ...rule, label: event.currentTarget.value })} className="office-input office-input-name" />
                <select defaultValue={rule.kind} onChange={(event) => void saveRule({ ...rule, kind: event.currentTarget.value })} className="office-input">
                  <option value="SURCHARGE">Surcharge</option>
                  <option value="DISCOUNT">Discount</option>
                </select>
                <input defaultValue={String(rule.percent)} inputMode="decimal" style={{ width: 64 }} onBlur={(event) => Number(event.currentTarget.value) !== rule.percent && void saveRule({ ...rule, percent: Number(event.currentTarget.value) })} className="office-input" />
                <span className="office-hint">%</span>
                <span className="office-days">
                  {WEEKDAYS.map((day, index) => {
                    const on = rule.weekdays.split(',').includes(String(index));
                    return (
                      <button
                        key={day}
                        type="button"
                        className={on ? 'is-on' : ''}
                        onClick={() => {
                          const set = new Set(rule.weekdays.split(',').filter(Boolean));
                          if (on) set.delete(String(index));
                          else set.add(String(index));
                          void saveRule({ ...rule, weekdays: [...set].join(',') });
                        }}
                      >
                        {day}
                      </button>
                    );
                  })}
                </span>
                <label className="office-toggle">
                  <input type="checkbox" defaultChecked={rule.holidays} onChange={(event) => void saveRule({ ...rule, holidays: event.currentTarget.checked })} />
                  Public holidays
                </label>
                <span className="office-hint">{minuteLabel(rule.startMinute)}–{minuteLabel(rule.endMinute)}</span>
                <label className="office-toggle">
                  <input type="checkbox" defaultChecked={rule.active} onChange={(event) => void saveRule({ ...rule, active: event.currentTarget.checked })} />
                  Active
                </label>
                <button
                  type="button"
                  className="office-delete"
                  onClick={() => {
                    void api(`/api/pos/rules/${rule.id}`, { method: 'DELETE' })
                      .then(() => {
                        setInfo('Rule removed.');
                        void refresh();
                      })
                      .catch((err) => setError(messageForError(err, 'Could not remove it.')));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="office-add" onClick={() => void saveRule({ label: 'New rule', kind: 'SURCHARGE', percent: 10, weekdays: '', holidays: false })}>
              ＋ Add a rule
            </button>
          </section>
        ) : null}

        {tab === 'identity' ? (
          <section>
            <p className="office-lead">
              St Alma and Alma Avalon are separate companies — each venue's receipts carry its own name and ABN, and payments
              can settle to its own Stripe account.
            </p>
            {identities.map((identity) => (
              <div key={identity.venue} className="office-card office-card-col">
                <strong>{identity.venue}</strong>
                <div className="office-row">
                  <input
                    defaultValue={identity.businessName}
                    placeholder="Business name on receipts"
                    className="office-input office-input-wide"
                    onBlur={(event) => {
                      const businessName = event.currentTarget.value.trim();
                      if (!businessName || businessName === identity.businessName) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, businessName }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                  <input
                    defaultValue={identity.abn ?? ''}
                    placeholder="ABN"
                    className="office-input"
                    onBlur={(event) => {
                      const abn = event.currentTarget.value.trim();
                      if (abn === (identity.abn ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, abn }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                </div>
                <div className="office-row">
                  <input
                    defaultValue={identity.address ?? ''}
                    placeholder="Street address"
                    className="office-input office-input-wide"
                    onBlur={(event) => {
                      const address = event.currentTarget.value.trim();
                      if (address === (identity.address ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, address }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                  <input
                    defaultValue={identity.phone ?? ''}
                    placeholder="Phone"
                    className="office-input"
                    onBlur={(event) => {
                      const phone = event.currentTarget.value.trim();
                      if (phone === (identity.phone ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, phone }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                  <input
                    defaultValue={identity.email ?? ''}
                    placeholder="Email"
                    className="office-input"
                    onBlur={(event) => {
                      const email = event.currentTarget.value.trim();
                      if (email === (identity.email ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, email }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                  <input
                    defaultValue={identity.website ?? ''}
                    placeholder="Website"
                    className="office-input"
                    onBlur={(event) => {
                      const website = event.currentTarget.value.trim();
                      if (website === (identity.website ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, website }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                </div>
                <div className="office-row">
                  <select
                    className="office-input office-input-wide"
                    defaultValue={identity.xeroTenantId ?? ''}
                    onChange={(event) => {
                      void api('/api/pos/venue-settings', {
                        method: 'PUT',
                        body: JSON.stringify({ venue: identity.venue, xeroTenantId: event.currentTarget.value })
                      })
                        .then(() => setInfo('Xero organisation saved — this venue posts its own daily sales.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  >
                    <option value="">Xero: don't post this venue</option>
                    {xeroTenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name ?? tenant.id}
                      </option>
                    ))}
                  </select>
                  <input
                    defaultValue={identity.xeroSalesAccount ?? ''}
                    placeholder="Sales account (200)"
                    className="office-input"
                    onBlur={(event) => {
                      const xeroSalesAccount = event.currentTarget.value.trim();
                      if (xeroSalesAccount === (identity.xeroSalesAccount ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, xeroSalesAccount }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                  <input
                    defaultValue={identity.xeroTipsAccount ?? ''}
                    placeholder="Tips account (blank = skip)"
                    className="office-input"
                    onBlur={(event) => {
                      const xeroTipsAccount = event.currentTarget.value.trim();
                      if (xeroTipsAccount === (identity.xeroTipsAccount ?? '')) return;
                      void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, xeroTipsAccount }) })
                        .then(() => setInfo('Saved.'))
                        .catch((err) => setError(messageForError(err, 'Could not save.')));
                    }}
                  />
                </div>
                <div className="office-row office-logo-row">
                  {identity.receiptLogo ? (
                    <img src={identity.receiptLogo} alt="" className="office-logo-thumb" />
                  ) : (
                    <span className="office-variant-opts">No receipt logo yet</span>
                  )}
                  <label className="office-add office-upload">
                    Upload logo
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void uploadLogo(identity.venue, file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {identity.receiptLogo ? (
                    <button
                      type="button"
                      className="office-delete"
                      onClick={() => {
                        void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, receiptLogo: '' }) })
                          .then(() => {
                            setInfo('Logo removed.');
                            void refresh();
                          })
                          .catch((err) => setError(messageForError(err, 'Could not remove it.')));
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
                <div className="office-row">
                  <label className="office-toggle">
                    <input
                      type="checkbox"
                      defaultChecked={identity.postToReports}
                      onChange={(event) => {
                        void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue: identity.venue, postToReports: event.currentTarget.checked }) })
                          .then(() => setInfo('Saved.'))
                          .catch((err) => setError(messageForError(err, 'Could not save.')));
                      }}
                    />
                    This POS is the till (posts to Reports)
                  </label>
                </div>
              </div>
            ))}
            <p className="office-hint">
              Separate Stripe accounts: add STRIPE_SECRET_KEY__ST_ALMA / STRIPE_SECRET_KEY__ALMA_AVALON on the server and each
              venue's card payments settle to its own company.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
