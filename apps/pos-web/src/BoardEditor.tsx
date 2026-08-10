import React, { useMemo, useState } from 'react';
import {
  BRIGHT_PALETTE,
  HOME_TAB,
  HUE_DOTS,
  MGMT_KEYS,
  MGMT_LABELS,
  ICON_KEYS,
  ICON_STYLES,
  hueClass,
  hueStyle,
  iconKeyFor,
  iconSvg,
  moveInArray,
  movePinToPage,
  paginatePins,
  pinDisplay,
  visibleTabTokens,
  type HomeConfig,
  type IconStyle,
  type MenuCategory,
  type MenuItem,
  type Pin,
  type TabsConfig
} from './board';

// The board editor: arranging the register is a desk job, not a gesture.
// Every action here is a button press — reorder, repage, resize, recolour,
// file into a folder — so it works the same on an iPad mid-service as it
// does on a laptop. The drag on the board itself stays; this is the path
// that always works.
type Props = {
  home: HomeConfig;
  menu: MenuCategory[];
  topSellers: string[];
  boardSlots: number;
  boardCols: number;
  operatorName: string;
  iconStyle: IconStyle;
  onIconStyle: (next: IconStyle) => void;
  onChange: (next: HomeConfig) => void;
  onClose: () => void;
};

const SIZES: Array<{ key: undefined | 'w' | 'b'; label: string; hint: string }> = [
  { key: undefined, label: 'Normal', hint: '1 slot' },
  { key: 'w', label: 'Wide', hint: '2 slots' },
  { key: 'b', label: 'Big', hint: '4 slots' }
];

const LABEL_STYLES: Array<{ key: undefined | 'sh' | 'hs' | 'big'; tag: string; label: string }> = [
  { key: undefined, tag: 'Aa', label: 'Standard' },
  { key: 'sh', tag: 'AB', label: 'Short' },
  { key: 'hs', tag: 'A a', label: 'Heading + sub' },
  { key: 'big', tag: 'A', label: 'Big title' }
];

export function BoardEditor({
  home,
  menu,
  topSellers,
  boardSlots,
  boardCols,
  operatorName,
  iconStyle,
  onIconStyle,
  onChange,
  onClose
}: Props) {
  const [tab, setTab] = useState<'board' | 'nav'>('board');
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [folderSearch, setFolderSearch] = useState('');
  const [navSelected, setNavSelected] = useState<string | null>(null);
  // "Place mode": tap a tile to pick it up, then tap a gap to drop it in.
  // A two-tap move beats holding ▲ fourteen times, and needs no gesture.
  const [placing, setPlacing] = useState<number | null>(null);
  const [listFilter, setListFilter] = useState('');
  // One step back, for the fat-finger moment.
  const [undo, setUndo] = useState<HomeConfig | null>(null);

  const pins = home.pins;
  const tabsConfig: TabsConfig = home.categories ?? { order: [], hidden: [], groups: [] };
  const iconOverrides = tabsConfig.icons ?? {};
  function setIcon(name: string, key: string | null) {
    const icons = { ...iconOverrides };
    // null = back to the automatic match; '' = deliberately no mark.
    if (key === null) delete icons[name];
    else icons[name] = key;
    commitTabs({ ...tabsConfig, icons });
  }

  const allItems = useMemo(() => menu.flatMap((category) => category.items), [menu]);
  const categoryOfRecipe = useMemo(() => {
    const map = new Map<string, string>();
    menu.forEach((category) => category.items.forEach((item) => map.set(item.recipeId, category.name)));
    return map;
  }, [menu]);
  const itemById = useMemo(() => {
    const map = new Map<string, MenuItem>();
    allItems.forEach((item) => map.set(item.recipeId, item));
    return map;
  }, [allItems]);

  // The register reserves one slot on every page for its own "Edit this
  // page" tile — page breaks here must account for it or the preview lies.
  const capacity = Math.max(2, boardSlots - 1);
  const pages = useMemo(() => paginatePins(pins, capacity), [pins, capacity]);
  const pageSafe = Math.min(page, pages.length - 1);
  const tokens = useMemo(() => visibleTabTokens(menu.map((category) => category.name), tabsConfig), [menu, tabsConfig]);

  function commitPins(next: Pin[]) {
    setUndo(home);
    onChange({ ...home, pins: next });
  }
  function commitTabs(next: TabsConfig) {
    setUndo(home);
    onChange({ ...home, categories: next });
  }
  function undoLast() {
    if (!undo) return;
    onChange(undo);
    setUndo(null);
    setSelected(null);
    setPlacing(null);
  }

  // Lift a tile out and drop it back at `at` (an index in the list WITHOUT
  // it), so a move across pages is two taps instead of a run of ▲.
  function placeAt(from: number, at: number) {
    const pin = pins[from];
    if (!pin) return;
    const rest = pins.filter((_, i) => i !== from);
    const next = [...rest.slice(0, at), pin, ...rest.slice(at)];
    commitPins(next);
    setPlacing(null);
    setSelected(at);
    setPage(Math.max(0, paginatePins(next, capacity).findIndex((entries) => entries.some((entry) => entry.index === at))));
  }
  function patchPin(index: number, patch: Partial<PinPatch>) {
    commitPins(pins.map((pin, i) => (i === index ? ({ ...pin, ...patch } as Pin) : pin)));
  }

  function pinLabel(pin: Pin): string {
    if (pin.t === 'f') return pin.name;
    if (pin.t === 'm') return MGMT_LABELS[pin.key] ?? pin.key;
    return itemById.get(pin.id)?.title ?? 'Item no longer on the menu';
  }
  function pinKind(pin: Pin): string {
    return pin.t === 'f' ? `Folder · ${pin.items.length} items` : pin.t === 'm' ? 'Management' : money(itemById.get(pin.id)?.priceCents);
  }
  function pageOf(index: number) {
    return pages.findIndex((entries) => entries.some((entry) => entry.index === index));
  }

  function movePin(index: number, delta: number) {
    const next = moveInArray(pins, index, delta);
    if (next === pins) return;
    commitPins(next);
    setSelected(index + delta);
    setPage(Math.max(0, paginatePins(next, capacity).findIndex((entries) => entries.some((entry) => entry.index === index + delta))));
  }

  function sendToPage(index: number, target: number) {
    const pin = pins[index];
    if (!pin) return;
    const next = movePinToPage(pins, index, target, capacity);
    commitPins(next);
    const moved = next.indexOf(pin);
    setSelected(moved === -1 ? null : moved);
    setPage(target);
  }

  function removePin(index: number) {
    commitPins(pins.filter((_, i) => i !== index));
    setSelected(null);
  }

  // Filing an item into a folder takes it OFF the board — the inverse of
  // the folder screen's ★, which copies onto the board and keeps it inside.
  function fileIntoFolder(index: number, folderIndex: number) {
    const pin = pins[index];
    const folder = pins[folderIndex];
    if (!pin || pin.t !== 'i' || !folder || folder.t !== 'f') return;
    const next = pins
      .map((candidate, i) =>
        i === folderIndex && candidate.t === 'f'
          ? { ...candidate, items: candidate.items.includes(pin.id) ? candidate.items : [...candidate.items, pin.id] }
          : candidate
      )
      .filter((_, i) => i !== index);
    commitPins(next);
    setSelected(null);
  }

  function addPin(pin: Pin) {
    commitPins([...pins, pin]);
    setSelected(pins.length);
    setPage(Math.max(0, paginatePins([...pins, pin], capacity).length - 1));
  }

  // ── Folder contents ───────────────────────────────────────────────────
  function folderItems(index: number, mutate: (items: string[]) => string[]) {
    const folder = pins[index];
    if (!folder || folder.t !== 'f') return;
    commitPins(pins.map((pin, i) => (i === index && pin.t === 'f' ? { ...pin, items: mutate(pin.items) } : pin)));
  }

  // ── Left nav ──────────────────────────────────────────────────────────
  function moveToken(token: string, delta: number) {
    const at = tokens.indexOf(token);
    const order = moveInArray(tokens, at, delta);
    if (order === tokens) return;
    commitTabs({ ...tabsConfig, order });
  }
  function toggleHidden(name: string) {
    commitTabs({
      ...tabsConfig,
      hidden: tabsConfig.hidden.includes(name) ? tabsConfig.hidden.filter((candidate) => candidate !== name) : [...tabsConfig.hidden, name],
      // Keep the current order so an unhidden category comes back in place.
      order: tokens
    });
  }
  function fileIntoNavFolder(cat: string, groupName: string) {
    commitTabs({
      ...tabsConfig,
      order: tokens.filter((token) => token !== cat),
      groups: tabsConfig.groups.map((group) =>
        group.name === groupName ? { ...group, cats: group.cats.includes(cat) ? group.cats : [...group.cats, cat] } : group
      )
    });
    setNavSelected(`g:${groupName}`);
  }
  function releaseFromNavFolder(groupName: string, cat: string) {
    const base = tokens.filter((token) => token !== cat);
    const at = base.indexOf(`g:${groupName}`);
    commitTabs({
      ...tabsConfig,
      order: at === -1 ? [...base, cat] : [...base.slice(0, at + 1), cat, ...base.slice(at + 1)],
      groups: tabsConfig.groups.map((group) => (group.name === groupName ? { ...group, cats: group.cats.filter((c) => c !== cat) } : group))
    });
  }
  function moveWithinNavFolder(groupName: string, at: number, delta: number) {
    commitTabs({
      ...tabsConfig,
      groups: tabsConfig.groups.map((group) => (group.name === groupName ? { ...group, cats: moveInArray(group.cats, at, delta) } : group))
    });
  }
  function renameNavFolder(oldName: string, raw: string) {
    const value = raw.trim().slice(0, 30);
    if (!value || value === oldName) return;
    if (tabsConfig.groups.some((group) => group.name === value)) return;
    commitTabs({
      ...tabsConfig,
      order: (tabsConfig.order.length ? tabsConfig.order : tokens).map((token) => (token === `g:${oldName}` ? `g:${value}` : token)),
      groups: tabsConfig.groups.map((group) => (group.name === oldName ? { ...group, name: value } : group))
    });
    setNavSelected(`g:${value}`);
  }
  // Removing the folder keeps its categories — they return to the nav in place.
  function dissolveNavFolder(name: string) {
    const cats = tabsConfig.groups.find((group) => group.name === name)?.cats ?? [];
    const base = tabsConfig.order.length ? tabsConfig.order : tokens;
    commitTabs({
      ...tabsConfig,
      order: base.flatMap((token) => (token === `g:${name}` ? cats : [token])),
      groups: tabsConfig.groups.filter((group) => group.name !== name)
    });
    setNavSelected(null);
  }
  function newNavFolder() {
    let name = 'New folder';
    let n = 2;
    while (tabsConfig.groups.some((group) => group.name === name)) name = `New folder ${n++}`;
    commitTabs({ ...tabsConfig, order: [...tokens, `g:${name}`], groups: [...tabsConfig.groups, { name, cats: [] }] });
    setNavSelected(`g:${name}`);
  }

  // Same drawn marks as the register, so the preview tells the truth.
  function Mark({ name, fallback, folder, mgmt, className }: { name: string; fallback?: string; folder?: boolean; mgmt?: boolean; className?: string }) {
    const cls = className ?? 'pos-nav-icon';
    if (mgmt) return <i className={`${cls} pos-nav-folder`}>⚙</i>;
    const key = iconStyle !== 'off' ? iconKeyFor(name, iconOverrides) || iconKeyFor(fallback ?? '', iconOverrides) : '';
    if (!key) return folder ? <i className={`${cls} pos-nav-folder`}>▤</i> : null;
    return <i className={cls} dangerouslySetInnerHTML={{ __html: iconSvg(key, iconStyle) }} />;
  }

  const selectedPin = selected === null ? null : pins[selected] ?? null;
  const folders = pins.map((pin, index) => ({ pin, index })).filter((entry) => entry.pin.t === 'f');
  const pinnedIds = new Set(pins.filter((pin) => pin.t === 'i').map((pin) => (pin as { id: string }).id));

  return (
    <div className="pos-boardedit">
      <header className="pos-be-head">
        <div className="pos-be-tabs">
          <button type="button" className={tab === 'board' ? 'is-on' : ''} onClick={() => setTab('board')}>
            Home board
          </button>
          <button type="button" className={tab === 'nav' ? 'is-on' : ''} onClick={() => setTab('nav')}>
            Menu nav
          </button>
        </div>
        <span className="pos-be-who">{operatorName ? `${operatorName}'s layout` : 'This layout'} · saves as you go</span>
        <span className="pos-be-iconpick" title="Food-group marks on the nav and the board">
          {ICON_STYLES.map((option) => (
            <button
              key={option.key}
              type="button"
              className={iconStyle === option.key ? 'is-on' : ''}
              title={option.hint}
              onClick={() => onIconStyle(option.key)}
            >
              {option.key === 'off' ? (
                'None'
              ) : (
                <i dangerouslySetInnerHTML={{ __html: iconSvg('cocktail', option.key) }} />
              )}
              {option.key === 'off' ? '' : option.label}
            </button>
          ))}
        </span>
        <button type="button" className="pos-be-add" disabled={!undo} onClick={undoLast}>
          ↶ Undo
        </button>
        <button type="button" className="pos-be-done" onClick={onClose}>
          ✓ Done
        </button>
      </header>

      <div className="pos-be-body">
        {tab === 'board' ? (
          <>
            <section className="pos-be-list">
              <div className="pos-be-listhead">
                <strong>On the board</strong>
                <button type="button" className={adding ? 'pos-be-add is-on' : 'pos-be-add'} onClick={() => setAdding(!adding)}>
                  {adding ? '✕ Close' : '＋ Add'}
                </button>
              </div>

              {adding ? (
                <div className="pos-be-addpanel">
                  <input
                    className="pos-be-search"
                    placeholder="Search the menu…"
                    value={addSearch}
                    onChange={(event) => setAddSearch(event.currentTarget.value)}
                  />
                  {addSearch.trim() ? (
                    <div className="pos-be-chips">
                      {allItems
                        .filter((item) => !item.variantOf)
                        .filter((item) => item.title.toLowerCase().includes(addSearch.trim().toLowerCase()))
                        .filter((item) => !pinnedIds.has(item.recipeId))
                        .slice(0, 30)
                        .map((item) => (
                          <button key={item.recipeId} type="button" onClick={() => addPin({ t: 'i', id: item.recipeId })}>
                            ＋ {item.title}
                          </button>
                        ))}
                    </div>
                  ) : (
                    <>
                      <p className="pos-be-hint">Best sellers here</p>
                      <div className="pos-be-chips">
                        {topSellers
                          .filter((recipeId) => !pinnedIds.has(recipeId))
                          .map((recipeId) => itemById.get(recipeId))
                          .filter((item): item is MenuItem => Boolean(item))
                          .slice(0, 12)
                          .map((item) => (
                            <button key={item.recipeId} type="button" onClick={() => addPin({ t: 'i', id: item.recipeId })}>
                              ＋ {item.title}
                            </button>
                          ))}
                        {topSellers.length === 0 ? <span className="pos-be-hint">No sales history yet.</span> : null}
                      </div>
                    </>
                  )}
                  <p className="pos-be-hint">Folders</p>
                  <div className="pos-be-chips">
                    <button type="button" onClick={() => addPin({ t: 'f', name: 'New folder', items: [] })}>
                      ＋ Empty folder
                    </button>
                    {menu
                      .filter((category) => !pins.some((pin) => pin.t === 'f' && pin.name === category.name))
                      .map((category) => (
                        <button
                          key={category.name}
                          type="button"
                          onClick={() =>
                            addPin({
                              t: 'f',
                              name: category.name,
                              items: category.items.filter((item) => !item.variantOf).map((item) => item.recipeId).slice(0, 40)
                            })
                          }
                        >
                          📁 {category.name} ({category.items.length})
                        </button>
                      ))}
                  </div>
                  <p className="pos-be-hint">Management</p>
                  <div className="pos-be-chips">
                    {MGMT_KEYS.filter((key) => !pins.some((pin) => pin.t === 'm' && pin.key === key)).map((key) => (
                      <button key={key} type="button" onClick={() => addPin({ t: 'm', key })}>
                        ⚙ {MGMT_LABELS[key]}
                      </button>
                    ))}
                    {MGMT_KEYS.every((key) => pins.some((pin) => pin.t === 'm' && pin.key === key)) ? (
                      <span className="pos-be-hint">All on the board.</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {pins.length > 8 && !adding ? (
                <input
                  className="pos-be-search pos-be-filter"
                  placeholder="Find a tile on the board…"
                  value={listFilter}
                  onChange={(event) => setListFilter(event.currentTarget.value)}
                />
              ) : null}

              {placing !== null ? (
                <p className="pos-be-placing">
                  Moving <strong>{pinLabel(pins[placing]!)}</strong> — tap a gap to drop it.
                  <button type="button" onClick={() => setPlacing(null)}>
                    Cancel
                  </button>
                </p>
              ) : null}

              <ol className="pos-be-rows">
                {pages.map((entries, pageIndex) => (
                  <React.Fragment key={pageIndex}>
                    <li className="pos-be-pagerow">
                      <span>Page {pageIndex + 1}</span>
                      <em>
                        {entries.length} tile{entries.length === 1 ? '' : 's'}
                      </em>
                    </li>
                    {entries.map(({ pin, index }) => {
                      const term = listFilter.trim().toLowerCase();
                      const hidden = term ? !pinLabel(pin).toLowerCase().includes(term) : false;
                      if (hidden && placing === null) return null;
                      // In place mode every row gets a gap above it; the index
                      // is measured on the list WITHOUT the travelling tile.
                      const gapAt = index > placing! ? index - 1 : index;
                      return (
                        <React.Fragment key={index}>
                          {/* The gap straight after the lifted tile would put
                              it back where it started — don't offer it. */}
                          {placing !== null && placing !== index && index !== placing + 1 ? (
                            <li className="pos-be-gap">
                              <button type="button" onClick={() => placeAt(placing, gapAt)}>
                                ↳ drop here
                              </button>
                            </li>
                          ) : null}
                          <li
                            className={`pos-be-row ${selected === index ? 'is-on' : ''} ${placing === index ? 'is-lifted' : ''} ${
                              hidden ? 'is-dimmed' : ''
                            }`}
                          >
                            <span className="pos-be-move">
                              <button type="button" title="Move up" disabled={index === 0} onClick={() => movePin(index, -1)}>
                                ▲
                              </button>
                              <button type="button" title="Move down" disabled={index === pins.length - 1} onClick={() => movePin(index, 1)}>
                                ▼
                              </button>
                            </span>
                            <button type="button" className="pos-be-rowbody" onClick={() => setSelected(index)}>
                              <i className="pos-be-dot" style={pin.c ? { background: HUE_DOTS[pin.c] ?? pin.c } : undefined} />
                              <span className="pos-be-rowname">
                                <Mark
                                  name={pin.t === 'f' ? pin.name : pinLabel(pin)}
                                  fallback={pin.t === 'i' ? categoryOfRecipe.get(pin.id) : undefined}
                                  folder={pin.t === 'f'}
                                  mgmt={pin.t === 'm'}
                                />
                                {pinLabel(pin)}
                              </span>
                              <em>{pinKind(pin)}</em>
                              {pin.s ? <b className="pos-be-size">{pin.s === 'w' ? 'Wide' : 'Big'}</b> : null}
                            </button>
                            <button
                              type="button"
                              className="pos-be-x"
                              title="Move this tile somewhere else"
                              onClick={() => setPlacing(placing === index ? null : index)}
                            >
                              ⇅
                            </button>
                          </li>
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                ))}
                {placing !== null ? (
                  <li className="pos-be-gap">
                    <button type="button" onClick={() => placeAt(placing, pins.length - 1)}>
                      ↳ drop at the end
                    </button>
                  </li>
                ) : null}
                {pins.length === 0 ? <li className="pos-be-empty">Nothing on the board yet — add pins above.</li> : null}
              </ol>
            </section>

            <section className="pos-be-right">
              <div className="pos-be-preview">
                <div className="pos-be-previewhead">
                  <span>Preview — page {pageSafe + 1} of {pages.length}</span>
                  <span className="pos-be-pagebtns">
                    {pages.map((_, pageIndex) => (
                      <button
                        key={pageIndex}
                        type="button"
                        className={pageIndex === pageSafe ? 'is-on' : ''}
                        onClick={() => setPage(pageIndex)}
                      >
                        {pageIndex + 1}
                      </button>
                    ))}
                  </span>
                </div>
                <div
                  className="pos-grid pos-grid-home pos-be-board"
                  style={{ gridTemplateColumns: `repeat(${Math.max(2, boardCols)}, minmax(0, 1fr))` }}
                >
                  {(pages[pageSafe] ?? []).map(({ pin, index }) => {
                    const base = pinLabel(pin);
                    const display = pinDisplay(pin, base);
                    return (
                      <button
                        key={index}
                        type="button"
                        className={`pos-item pos-item-pin ${hueClass(pin.c)} ${pin.s === 'w' ? 'pos-size-w' : pin.s === 'b' ? 'pos-size-b' : ''} ${
                          selected === index ? 'is-be-selected' : ''
                        }`}
                        style={hueStyle(pin.c)}
                        onClick={() => setSelected(index)}
                      >
                        <span className={display.cls}>
                          <Mark
                            name={base}
                            fallback={pin.t === 'i' ? categoryOfRecipe.get(pin.id) : undefined}
                            folder={pin.t === 'f'}
                            className="pos-tile-icon"
                          />
                          {display.main}
                        </span>
                        {pin.d === 'big' ? null : <small>{pin.t === 'f' ? `${pin.items.length} items` : pinKind(pin)}</small>}
                      </button>
                    );
                  })}
                  <span className="pos-item pos-item-edit pos-be-ghost">
                    <span>✎ Edit this page</span>
                    <small>always on the board</small>
                  </span>
                </div>
              </div>

              <div className="pos-be-inspector">
                {selectedPin ? (
                  <>
                    <div className="pos-be-inspecthead">
                      <strong>
                        {selectedPin.t === 'f' ? '📁 ' : selectedPin.t === 'm' ? '⚙ ' : ''}
                        {pinLabel(selectedPin)}
                      </strong>
                      <button type="button" className="pos-be-remove" onClick={() => removePin(selected!)}>
                        Remove
                      </button>
                    </div>

                    <label className="pos-be-field">
                      <span>{selectedPin.t === 'f' ? 'Folder name' : 'Shown on the tile'}</span>
                      <input
                        className="pos-be-search"
                        value={selectedPin.t === 'f' ? selectedPin.name : selectedPin.label ?? ''}
                        placeholder={selectedPin.t === 'f' ? 'Folder name' : pinLabel(selectedPin)}
                        onChange={(event) => {
                          // Empty is allowed WHILE typing (so the field can be
                          // cleared and retyped); a blank folder is named on blur.
                          const value = event.currentTarget.value.slice(0, 40);
                          if (selectedPin.t === 'f') patchPin(selected!, { name: value });
                          else patchPin(selected!, { label: value || undefined });
                        }}
                        onBlur={(event) => {
                          if (selectedPin.t === 'f' && !event.currentTarget.value.trim()) patchPin(selected!, { name: 'Folder' });
                        }}
                      />
                    </label>
                    {selectedPin.t !== 'f' ? (
                      <p className="pos-be-hint">The kitchen keeps the real name — this only changes the tile.</p>
                    ) : null}

                    <div className="pos-be-field">
                      <span>Size</span>
                      <div className="pos-be-seg">
                        {SIZES.map((size) => (
                          <button
                            key={size.label}
                            type="button"
                            className={(selectedPin.s ?? undefined) === size.key ? 'is-on' : ''}
                            onClick={() => patchPin(selected!, { s: size.key })}
                          >
                            {size.label}
                            <em>{size.hint}</em>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pos-be-field">
                      <span>Colour</span>
                      <div className="pos-be-swatches">
                        {BRIGHT_PALETTE.map((colour) => (
                          <button
                            key={colour || 'none'}
                            type="button"
                            className={(selectedPin.c ?? '') === colour ? 'is-on' : ''}
                            style={colour ? { background: HUE_DOTS[colour] ?? colour } : undefined}
                            title={colour || 'No colour'}
                            onClick={() => patchPin(selected!, { c: colour || undefined })}
                          >
                            {colour ? '' : '∅'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pos-be-field">
                      <span>Label style</span>
                      <div className="pos-be-seg">
                        {LABEL_STYLES.map((style) => (
                          <button
                            key={style.label}
                            type="button"
                            className={(selectedPin.d ?? undefined) === style.key ? 'is-on' : ''}
                            title={style.label}
                            onClick={() => patchPin(selected!, { d: style.key })}
                          >
                            {style.tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pos-be-field">
                      <span>Move to page</span>
                      <div className="pos-be-seg pos-be-pages">
                        {Array.from({ length: Math.max(pages.length, pageOf(selected!) + 1) }, (_, pageIndex) => (
                          <button
                            key={pageIndex}
                            type="button"
                            className={pageOf(selected!) === pageIndex ? 'is-on' : ''}
                            onClick={() => sendToPage(selected!, pageIndex)}
                          >
                            {pageIndex + 1}
                          </button>
                        ))}
                        <button type="button" onClick={() => sendToPage(selected!, pages.length)}>
                          ＋ New page
                        </button>
                      </div>
                    </div>

                    <div className="pos-be-field">
                      <span>Move within the board</span>
                      <div className="pos-be-seg">
                        <button type="button" disabled={selected === 0} onClick={() => placeAt(selected!, 0)}>
                          ⤒ To the front
                        </button>
                        <button type="button" disabled={selected === pins.length - 1} onClick={() => placeAt(selected!, pins.length - 1)}>
                          ⤓ To the end
                        </button>
                        <button type="button" className={placing === selected ? 'is-on' : ''} onClick={() => setPlacing(placing === selected ? null : selected)}>
                          ⇅ Move to…
                        </button>
                      </div>
                    </div>

                    {selectedPin.t === 'i' && folders.length > 0 ? (
                      <div className="pos-be-field">
                        <span>Put into folder</span>
                        <div className="pos-be-chips">
                          {folders.map((entry) => (
                            <button key={entry.index} type="button" onClick={() => fileIntoFolder(selected!, entry.index)}>
                              📁 {(entry.pin as { name: string }).name}
                            </button>
                          ))}
                        </div>
                        <p className="pos-be-hint">Moves it off the board and into that folder.</p>
                      </div>
                    ) : null}

                    {selectedPin.t === 'f' ? (
                      <div className="pos-be-field">
                        <span>In this folder ({selectedPin.items.length})</span>
                        <ol className="pos-be-folderitems">
                          {selectedPin.items.map((recipeId, itemIndex) => (
                            <li key={`${recipeId}-${itemIndex}`}>
                              <span className="pos-be-move">
                                <button
                                  type="button"
                                  disabled={itemIndex === 0}
                                  onClick={() => folderItems(selected!, (items) => moveInArray(items, itemIndex, -1))}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  disabled={itemIndex === selectedPin.items.length - 1}
                                  onClick={() => folderItems(selected!, (items) => moveInArray(items, itemIndex, 1))}
                                >
                                  ▼
                                </button>
                              </span>
                              <em>{itemById.get(recipeId)?.title ?? 'Item no longer on the menu'}</em>
                              <button
                                type="button"
                                className="pos-be-x"
                                title="Take out of the folder"
                                onClick={() => folderItems(selected!, (items) => items.filter((_, i) => i !== itemIndex))}
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                          {selectedPin.items.length === 0 ? <li className="pos-be-empty">Empty — add items below.</li> : null}
                        </ol>
                        <input
                          className="pos-be-search"
                          placeholder="Add an item to this folder…"
                          value={folderSearch}
                          onChange={(event) => setFolderSearch(event.currentTarget.value)}
                        />
                        {folderSearch.trim() ? (
                          <div className="pos-be-chips">
                            {allItems
                              .filter((item) => !item.variantOf)
                              .filter((item) => item.title.toLowerCase().includes(folderSearch.trim().toLowerCase()))
                              .filter((item) => !selectedPin.items.includes(item.recipeId))
                              .slice(0, 20)
                              .map((item) => (
                                <button
                                  key={item.recipeId}
                                  type="button"
                                  onClick={() => folderItems(selected!, (items) => [...items, item.recipeId])}
                                >
                                  ＋ {item.title}
                                </button>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="pos-be-hint pos-be-nosel">
                    Pick a tile on the left (or in the preview) to rename it, resize it, colour it or move it to another page.
                  </p>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="pos-be-list">
              <div className="pos-be-listhead">
                <strong>Menu nav</strong>
                <button type="button" className="pos-be-add" onClick={newNavFolder}>
                  ＋ Folder
                </button>
              </div>
              <p className="pos-be-hint">
                One list drives all three views — the sidebar, the tab bar and the Full menu.
              </p>
              <ol className="pos-be-rows">
                {tokens.map((token, at) => {
                  const isGroup = token.startsWith('g:');
                  const groupName = isGroup ? token.slice(2) : null;
                  const group = isGroup ? tabsConfig.groups.find((candidate) => candidate.name === groupName) : null;
                  const count = isGroup ? null : menu.find((category) => category.name === token)?.items.length ?? 0;
                  return (
                    <React.Fragment key={token}>
                      <li className={navSelected === token ? 'pos-be-row is-on' : 'pos-be-row'}>
                        <span className="pos-be-move">
                          <button type="button" title="Move up" disabled={at === 0} onClick={() => moveToken(token, -1)}>
                            ▲
                          </button>
                          <button type="button" title="Move down" disabled={at === tokens.length - 1} onClick={() => moveToken(token, 1)}>
                            ▼
                          </button>
                        </span>
                        <button type="button" className="pos-be-rowbody" onClick={() => setNavSelected(navSelected === token ? null : token)}>
                          <span className="pos-be-rowname">
                            <Mark name={isGroup ? groupName! : token} folder={isGroup} />
                            {isGroup ? groupName : token}
                          </span>
                          <em>{isGroup ? `${group?.cats.length ?? 0} categories` : `${count} items`}</em>
                        </button>
                        {!isGroup ? (
                          <button type="button" className="pos-be-x" title="Hide from the nav" onClick={() => toggleHidden(token)}>
                            Hide
                          </button>
                        ) : (
                          <button type="button" className="pos-be-x" title="Remove the folder, keep its categories" onClick={() => dissolveNavFolder(groupName!)}>
                            Ungroup
                          </button>
                        )}
                      </li>
                      {isGroup && navSelected === token ? (
                        <li className="pos-be-subrows">
                          <input
                            className="pos-be-search"
                            defaultValue={groupName ?? ''}
                            placeholder="Folder name"
                            onBlur={(event) => renameNavFolder(groupName!, event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') renameNavFolder(groupName!, event.currentTarget.value);
                            }}
                          />
                          <ol>
                            {(group?.cats ?? []).map((cat, catIndex) => (
                              <li key={cat}>
                                <span className="pos-be-move">
                                  <button
                                    type="button"
                                    disabled={catIndex === 0}
                                    onClick={() => moveWithinNavFolder(groupName!, catIndex, -1)}
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    disabled={catIndex === (group?.cats.length ?? 0) - 1}
                                    onClick={() => moveWithinNavFolder(groupName!, catIndex, 1)}
                                  >
                                    ▼
                                  </button>
                                </span>
                                <em>{cat}</em>
                                <button type="button" className="pos-be-x" title="Take out of the folder" onClick={() => releaseFromNavFolder(groupName!, cat)}>
                                  ⤴
                                </button>
                              </li>
                            ))}
                            {(group?.cats.length ?? 0) === 0 ? <li className="pos-be-empty">Empty — file categories in below.</li> : null}
                          </ol>
                        </li>
                      ) : null}
                      {navSelected === token ? (
                        <li className="pos-be-subrows">
                          <span className="pos-be-hint">Mark</span>
                          <div className="pos-be-markpick">
                            <button
                              type="button"
                              className={!(token in iconOverrides) ? 'is-on' : ''}
                              title="Match it automatically"
                              onClick={() => setIcon(token, null)}
                            >
                              Auto
                            </button>
                            <button
                              type="button"
                              className={iconOverrides[token] === '' ? 'is-on' : ''}
                              title="No mark on this one"
                              onClick={() => setIcon(token, '')}
                            >
                              None
                            </button>
                            {ICON_KEYS.map((key) => (
                              <button
                                key={key}
                                type="button"
                                className={iconOverrides[token] === key ? 'is-on' : ''}
                                title={key}
                                onClick={() => setIcon(token, key)}
                                dangerouslySetInnerHTML={{ __html: iconSvg(key, iconStyle === 'off' ? 'line' : iconStyle) }}
                              />
                            ))}
                          </div>
                        </li>
                      ) : null}
                      {!isGroup && navSelected === token && tabsConfig.groups.length > 0 ? (
                        <li className="pos-be-subrows">
                          <span className="pos-be-hint">Put into folder</span>
                          <div className="pos-be-chips">
                            {tabsConfig.groups.map((candidate) => (
                              <button key={candidate.name} type="button" onClick={() => fileIntoNavFolder(token, candidate.name)}>
                                📁 {candidate.name}
                              </button>
                            ))}
                          </div>
                        </li>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </ol>

              {tabsConfig.hidden.filter((name) => menu.some((category) => category.name === name)).length > 0 ? (
                <>
                  <div className="pos-be-listhead">
                    <strong>Hidden</strong>
                  </div>
                  <div className="pos-be-chips">
                    {tabsConfig.hidden
                      .filter((name) => menu.some((category) => category.name === name))
                      .map((name) => (
                        <button key={name} type="button" onClick={() => toggleHidden(name)}>
                          {name} — show
                        </button>
                      ))}
                  </div>
                </>
              ) : null}
            </section>

            <section className="pos-be-right">
              <div className="pos-be-preview">
                <div className="pos-be-previewhead">
                  <span>Preview — sidebar</span>
                </div>
                <div className="pos-be-rail">
                  <div className="pos-be-raileyebrow">Menu</div>
                  <div className="pos-be-railitem is-on">★ Home</div>
                  <div className="pos-be-railitem">Full menu</div>
                  {tokens.map((token) => (
                    <div key={token} className={navSelected === token ? 'pos-be-railitem is-sel' : 'pos-be-railitem'}>
                      <Mark name={token.startsWith('g:') ? token.slice(2) : token} folder={token.startsWith('g:')} />
                      {token.startsWith('g:') ? token.slice(2) : token}
                    </div>
                  ))}
                </div>
              </div>
              <div className="pos-be-preview">
                <div className="pos-be-previewhead">
                  <span>Preview — tab bar</span>
                </div>
                <div className="pos-be-tabbar">
                  <span className="is-on">{HOME_TAB}</span>
                  <span>Full menu</span>
                  {tokens.map((token) => (
                    <span key={token} className={navSelected === token ? 'is-sel' : ''}>
                      <Mark name={token.startsWith('g:') ? token.slice(2) : token} folder={token.startsWith('g:')} />
                      {token.startsWith('g:') ? token.slice(2) : token}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

type PinPatch = { c?: string; label?: string; s?: 'w' | 'b'; d?: 'sh' | 'hs' | 'big'; name?: string };

function money(cents?: number) {
  return cents === undefined ? '' : `$${(cents / 100).toFixed(2)}`;
}
