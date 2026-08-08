import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { loadStripeTerminal, type Terminal, type Reader } from '@stripe/terminal-js';
import { api, consumeSuiteHandoffToken, messageForError } from './api';

// ── ALMA POS v2 ─────────────────────────────────────────────────────────────
// Home screen (open tables/tabs + quick sale + day glance) → order screen
// (menu grid, coursed cart) → charge (tips, cash/card, SPLIT bills). Orders
// are server-backed from the moment a table opens; totals — including the
// automatic weekend/public-holiday surcharge and any timed discounts — are
// computed server-side on every cart change.

type MenuItem = { recipeId: string; title: string; priceCents: number; venue: string | null; variantOf?: string | null; variants?: Array<{ recipeId: string; title: string; priceCents: number; venue: string | null; label: string }> | null };
type MenuCategory = { name: string; kind: string; items: MenuItem[] };
type OrderLine = {
  id?: string;
  recipeId: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
  course?: string | null;
  seat?: number | null;
  modifiers?: Array<{ name: string; priceCents: number }> | null;
  notes?: string | null;
  sentAt?: string | null;
};
type Payment = { method: string; amountCents: number; tipCents: number; createdAt?: string };
type OrderGuest = {
  id: string;
  firstName: string;
  lastName: string;
  totalVisits: number;
  totalSpendCents: number;
  tags: string[];
  allergyNotes: string | null;
  dietaryNotes: string | null;
};
type GuestProfile = OrderGuest & {
  lastVisitAt: string | null;
  visitNotes: string | null;
  favourites: Array<{ name: string; quantity: number; totalCents: number }>;
};
type PinExtras = { c?: string; label?: string; s?: 'w' | 'b'; d?: 'sh' | 'hs' | 'big' };
type Pin = ({ t: 'i'; id: string } & PinExtras) | ({ t: 'f'; name: string; items: string[] } & PinExtras);
type TabsConfig = { order: string[]; hidden: string[]; groups: Array<{ name: string; cats: string[]; c?: string }> };
type ModifierOption = { id: string; name: string; priceCents: number };
type ModifierGroup = { id: string; name: string; required: boolean; maxSelect: number; categories: string[]; options: ModifierOption[] };
type Order = {
  id: string;
  orderNumber: number;
  guest?: OrderGuest | null;
  venue: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  tableLabel: string | null;
  covers: number | null;
  subtotalCents: number;
  discountCents: number;
  discountLabel: string | null;
  surchargeCents: number;
  surchargeLabel: string | null;
  totalCents: number;
  gstCents: number;
  tipCents: number;
  createdAt: string;
  lines: OrderLine[];
  payments: Payment[];
  changeCents?: number | null;
  balanceCents?: number;
};
type FloorTable = {
  id: string;
  label: string;
  area: string;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
  rotation: number;
  shape: string;
  seats: number | null;
  maxCovers: number;
};
type FloorReservation = {
  id: string;
  name: string;
  covers: number;
  startsAt: string;
  status: string;
  area: string | null;
  tableLabel: string | null;
};
type Docket = {
  profile: string;
  printerIp: string | null;
  tableLabel: string | null;
  orderNumber: number;
  covers: number | null;
  openedByName: string | null;
  lines: Array<{ id: string; name: string; quantity: number; course: string | null; notes: string | null }>;
};
type DrawerInfo = {
  drawer: null | {
    id: string;
    openingFloatCents: number;
    openedAt: string;
    openedByName: string | null;
  };
  expectedCents: number | null;
};
type CloseGate = { openBills: number; drawerOpen: boolean; alreadyClosed: boolean; ready: boolean };
type DaySummary = {
  serviceDate: string;
  orderCount: number;
  totalCents: number;
  gstCents: number;
  tipCents: number;
  methods: Record<string, { count: number; amountCents: number; tipCents: number }>;
  topItems: Array<{ name: string; quantity: number; totalCents: number }>;
};

const VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];
const HOME_TAB = '\u2605 Home';
// Fire progress of an order: 'waiting' = lines not yet called away,
// 'away' = everything fired, 'empty' = no lines.
function fireState(lines: Array<{ sentAt?: string | null }>): 'waiting' | 'away' | 'empty' {
  if (lines.length === 0) return 'empty';
  return lines.some((line) => !line.sentAt) ? 'waiting' : 'away';
}
// Australian cash rounding — physical cash rounds to the nearest 5c.
const roundCash5 = (cents: number) => Math.round(cents / 5) * 5;
const BRIGHT_PALETTE = ['', 'terra', 'amber', 'moss', 'slate', 'shell', 'cocoa'];
const HUE_NAMES = ['terra', 'amber', 'moss', 'slate', 'shell', 'cocoa'];
// Swatch dot colours for the customise sheet (light-theme tile inks).
const HUE_DOTS: Record<string, string> = { terra: '#9a3a2e', amber: '#b5772f', moss: '#4f6b47', slate: '#4d5e7a', shell: '#a8613f', cocoa: '#684a4a' };
function hueClass(c?: string) {
  return c && HUE_NAMES.includes(c) ? `pos-hue-${c}` : '';
}
function hueStyle(c?: string): React.CSSProperties | undefined {
  return c && !HUE_NAMES.includes(c) ? { borderColor: c, background: `${c}26` } : undefined;
}
// Menu tiles take a calm hue from their category so every grid reads warm.
function hueForCategory(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUE_NAMES[h % HUE_NAMES.length];
}

// ── Offline layer ───────────────────────────────────────────────────────────
// The shell + menu are cached; QUICK SALES keep working through an outage —
// they queue locally and sync when the API returns. Table operations need
// the server and wait behind the banner.
type QueuedSale = {
  localId: string;
  venue: string;
  training?: boolean;
  openedByName?: string;
  lines: OrderLine[];
  payment: { method: string; tipCents: number; tenderedCents?: number };
  totalCents: number;
  createdAt: string;
};

function loadQueue(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem('alma.pos.queue') ?? '[]') as QueuedSale[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedSale[]) {
  localStorage.setItem('alma.pos.queue', JSON.stringify(queue));
}

function isNetworkError(err: unknown) {
  return err instanceof TypeError || (err instanceof Error && /network|fetch|load failed/i.test(err.message));
}

// Weekend surcharge computed locally from cached rules during an outage.
function offlineSurcharge(subtotalCents: number, rules: Array<{ kind: string; percent: number; weekdays: string }>): { cents: number; label: string | null } {
  const weekday = new Date().getDay();
  const rule = rules.find(
    (candidate) => candidate.kind === 'SURCHARGE' && candidate.weekdays.split(',').filter(Boolean).map(Number).includes(weekday)
  );
  return rule ? { cents: Math.round((subtotalCents * rule.percent) / 100), label: `Weekend surcharge ${rule.percent}%` } : { cents: 0, label: null };
}
const FALLBACK_COURSES = ['NOW', 'Course 1', 'Course 2', 'Course 3', 'Course 4', 'Course 5', 'Course 6'];
// AU cash denominations, cents.
const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];

// How a pinned tile shows its name: default heading+sub, 'sh' abbreviated
// (initials or first four letters), 'hs' larger heading with the sub line,
// 'big' one large title only. Kitchen-facing names never change.
function pinDisplay(pin: Pin, baseName: string): { main: string; cls: string } {
  const name = (pin.label ?? baseName).trim() || baseName;
  if (pin.d === 'sh') {
    const words = name.split(/\s+/).filter(Boolean);
    const short = words.length >= 2 ? words.map((word) => word[0]).join('').toUpperCase() : name.slice(0, 4).toUpperCase();
    return { main: short, cls: 'pos-label-short' };
  }
  if (pin.d === 'big') return { main: name, cls: 'pos-label-big' };
  if (pin.d === 'hs') return { main: name, cls: 'pos-label-hs' };
  return { main: name, cls: '' };
}

function money(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function paidCents(order: Order) {
  return order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

function defaultCourse(_kind: string) {
  return 'NOW';
}

function ageMinutes(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

type StaffOption = { id: string; name: string; roleTitle: string; hasPin: boolean };
type AuthShape =
  | 'loading'
  | null
  | { kind: 'staff'; name: string }
  | { kind: 'device'; staffName: string | null; staffList: StaffOption[] };

export function App() {
  const [me, setMe] = useState<AuthShape>('loading');
  const [bill, setBill] = useState<Order | null>(null);
  const [venue, setVenue] = useState<string>(() => localStorage.getItem('alma.pos.venue') ?? VENUES[0]!);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [kindByRecipe, setKindByRecipe] = useState<Map<string, string>>(new Map());
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [floorTables, setFloorTables] = useState<FloorTable[]>([]);
  const [floorArea, setFloorArea] = useState('');
  const [homeView, setHomeView] = useState<'floor' | 'list'>(() => (localStorage.getItem('alma.pos.view') as 'floor' | 'list') ?? 'floor');
  const [order, setOrder] = useState<Order | null>(null);
  // Register-first: the app opens on menu + bill; Tables is a secondary view.
  const [view, setView] = useState<'register' | 'tables'>('register');
  const [bills, setBills] = useState<Order[] | null>(null);
  const [refunding, setRefunding] = useState<null | { order: Order; amount: string; reason: string; method: 'REFUND' | 'CASH' }>(null);
  const [merging, setMerging] = useState<Order[] | null>(null);
  const [editLayout, setEditLayout] = useState(false);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [newTable, setNewTable] = useState<null | { label: string; covers: string }>(null);
  const [charge, setCharge] = useState<null | { stage: 'tip' | 'method' | 'cash' | 'split' | 'gift'; tipCents: number; amountCents: number | null }>(null);
  const [gift, setGift] = useState<{ code: string; balanceCents: number | null; checking: boolean }>({ code: '', balanceCents: null, checking: false });
  const [info, setInfo] = useState<string | null>(null);
  const [tendered, setTendered] = useState('');
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [tillFlag, setTillFlag] = useState<boolean | null>(null);
  const [shift, setShift] = useState<null | {
    staffName: string;
    orderCount: number;
    itemCount: number;
    totalCents: number;
    tipCents: number;
    methods: Record<string, { count: number; amountCents: number; tipCents: number }>;
    adjustments: Array<{ kind: string; reason: string; itemName: string | null; amountCents: number }>;
  }>(null);
  const [receiptEmail, setReceiptEmail] = useState('');
  const [receiptEmailStatus, setReceiptEmailStatus] = useState<string | null>(null);
  const [courses, setCourses] = useState<string[]>(FALLBACK_COURSES);
  // Course the next tapped item lands in (null = automatic food/drinks pick).
  const [targetCourse, setTargetCourse] = useState<string | null>(null);
  const [training, setTraining] = useState(() => localStorage.getItem('alma.pos.training') === '1');
  const [managerGate, setManagerGate] = useState<null | { message: string; pin: string; retry: (pin: string) => void }>(null);
  const [pinSearch, setPinSearch] = useState('');
  const [deviceLanding, setDeviceLanding] = useState(() => localStorage.getItem('alma.pos.deviceLanding') ?? '');
  // Phone layout: the bill lives in a bottom sheet behind a summary bar.
  const [cartOpen, setCartOpen] = useState(false);
  const [billCollapsed, setBillCollapsed] = useState(() => localStorage.getItem('alma.pos.billCollapsed') === '1');

  useEffect(() => {
    localStorage.setItem('alma.pos.billCollapsed', billCollapsed ? '1' : '0');
  }, [billCollapsed]);
  const [darkTheme, setDarkTheme] = useState(() => localStorage.getItem('alma.pos.theme') === 'dark');
  // Two full designs: 'classic' tiles (v1) and the 'rail' sidebar-list (v2).
  const [design, setDesign] = useState<'classic' | 'rail'>(() => (localStorage.getItem('alma.pos.design') === 'rail' ? 'rail' : 'classic'));

  useEffect(() => {
    document.body.classList.toggle('pos-v2', design === 'rail');
    localStorage.setItem('alma.pos.design', design);
  }, [design]);
  // St Alma and Alma Avalon are separate companies — receipts and the header
  // carry the selected venue's own identity.
  const [venueIdentity, setVenueIdentity] = useState<{ businessName: string; abn: string | null }>({ businessName: 'ALMA', abn: null });

  useEffect(() => {
    if (me === 'loading' || !me) return;
    void api<{ businessName: string; abn: string | null }>(`/api/pos/venue-settings?venue=${encodeURIComponent(venue)}`)
      .then((setting) => setVenueIdentity({ businessName: setting.businessName || venue, abn: setting.abn ?? null }))
      .catch(() => setVenueIdentity({ businessName: venue, abn: null }));
  }, [venue, me]);

  useEffect(() => {
    document.body.classList.toggle('pos-dark', darkTheme);
    localStorage.setItem('alma.pos.theme', darkTheme ? 'dark' : 'light');
  }, [darkTheme]);
  // Home board inline editing: drag to reorder, tap to recolour, ✕ removes.
  const [boardEdit, setBoardEdit] = useState(false);
  const dragPinIndex = useRef<number | null>(null);
  const dragMoved = useRef(false);
  // Home pages: the board never scrolls — pins flow onto pages left/right.
  const [boardPage, setBoardPage] = useState(0);
  const [boardSlots, setBoardSlots] = useState(24);
  const boardPagerRef = useRef<HTMLDivElement | null>(null);
  const pinPageCountRef = useRef(1);
  const pageFlipStamp = useRef(0);
  const boardSwiped = useRef(false);

  // Drag runs on document-level NATIVE listeners registered at drag start —
  // React's synthetic move events are unreliable under pointer capture.
  function boardPinPointerDown(event: React.PointerEvent, index: number) {
    if (!boardEdit) return;
    event.preventDefault();
    dragPinIndex.current = index;
    dragMoved.current = false;
    // Fast drags outrun React renders, so hover decisions read the DOM's own
    // data attributes (always in sync with what's on screen) and the drop is
    // resolved by STABLE keys, never indices.
    const draggedPinAtStart = homeRef.current.pins[index];
    const dragKey = draggedPinAtStart?.t === 'i' ? draggedPinAtStart.id : null;
    const dropFolder = { name: null as string | null };
    const onMove = (nativeEvent: PointerEvent) => {
      if (dragPinIndex.current === null) return;
      const pager = boardPagerRef.current;
      if (pager) {
        const rect = pager.getBoundingClientRect();
        const now = Date.now();
        if (now - pageFlipStamp.current > 600) {
          if (nativeEvent.clientX > rect.right - 40) {
            setBoardPage((current) => Math.min(current + 1, pinPageCountRef.current - 1));
            pageFlipStamp.current = now;
          } else if (nativeEvent.clientX < rect.left + 40) {
            setBoardPage((current) => Math.max(current - 1, 0));
            pageFlipStamp.current = now;
          }
        }
      }
      const target = document.elementFromPoint(nativeEvent.clientX, nativeEvent.clientY)?.closest('[data-pin-index]');
      if (!target) return;
      // Hovering a folder with an item: computer-style — drop puts it INSIDE.
      if (dragKey && target.getAttribute('data-pin-folder')) {
        dropFolder.name = target.getAttribute('data-pin-folder');
        document.querySelectorAll('.pos-item-pin.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
        target.classList.add('is-drop-target');
        return;
      }
      dropFolder.name = null;
      document.querySelectorAll('.pos-item-pin.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      const over = Number(target.getAttribute('data-pin-index'));
      if (Number.isNaN(over) || over === dragPinIndex.current) return;
      dragMoved.current = true;
      setHome((current) => {
        const from = dragPinIndex.current;
        if (from === null || from >= current.pins.length || over >= current.pins.length) return current;
        // SWAP places — the dragged tile and the one under it trade spots.
        const pins = [...current.pins];
        const held = pins[from]!;
        pins[from] = pins[over]!;
        pins[over] = held;
        return { ...current, pins };
      });
      dragPinIndex.current = over;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.querySelectorAll('.pos-item-pin.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      if (dragKey && dropFolder.name !== null) {
        const folderName = dropFolder.name;
        dragMoved.current = true;
        setHome((current) => {
          if (!current.pins.some((pin) => pin.t === 'f' && pin.name === folderName)) return current;
          const pins = current.pins
            .filter((pin) => !(pin.t === 'i' && pin.id === dragKey))
            .map((pin) => (pin.t === 'f' && pin.name === folderName ? { ...pin, items: [...pin.items, dragKey] } : pin));
          const next = { ...current, pins };
          setTimeout(() => saveBoard(next), 0);
          return next;
        });
        dragPinIndex.current = null;
        return;
      }
      if (dragPinIndex.current !== null && dragMoved.current) saveBoard(homeRef.current);
      dragPinIndex.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function folderItemPointerDown(event: React.PointerEvent, folderIndex: number, itemIndex: number) {
    if (!boardEdit) return;
    event.preventDefault();
    let from = itemIndex;
    let moved = false;
    const onMove = (nativeEvent: PointerEvent) => {
      const target = document.elementFromPoint(nativeEvent.clientX, nativeEvent.clientY)?.closest('[data-fitem-index]');
      if (!target) return;
      const over = Number(target.getAttribute('data-fitem-index'));
      if (Number.isNaN(over) || over === from) return;
      moved = true;
      setHome((current) => {
        const pins = current.pins.map((pin, i) => {
          if (i !== folderIndex || pin.t !== 'f') return pin;
          const items = [...pin.items];
          const [dragged] = items.splice(from, 1);
          items.splice(over, 0, dragged!);
          return { ...pin, items };
        });
        return { ...current, pins };
      });
      from = over;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (moved) {
        dragMoved.current = true;
        saveBoard(homeRef.current);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function saveBoard(next?: typeof home) {
    const board = next ?? homeRef.current;
    void api('/api/pos/homescreen', {
      method: 'PUT',
      body: JSON.stringify({ userKey, buttons: board.buttons, pins: board.pins, categories: board.categories ?? undefined, landingCategory: board.landingCategory ?? '', updatedBy: operatorName })
    }).catch((err) => setError(messageForError(err, 'Could not save the board.')));
  }
  const [dockets, setDockets] = useState<Docket[] | null>(null);
  // Call-aways print WITHOUT a confirm tap: the docket sheet fires straight
  // into the print flow and closes itself after. (For fully silent printing,
  // run the register browser in kiosk-printing mode.)
  const [autoPrint, setAutoPrint] = useState(false);
  const [reservations, setReservations] = useState<FloorReservation[]>([]);
  const [reasons, setReasons] = useState<Record<string, string[]>>({});
  const [home, setHome] = useState<{ buttons: string[]; pins: Pin[]; landingCategory?: string | null; categories?: TabsConfig | null }>({ buttons: [], pins: [] });
  const [renaming, setRenaming] = useState<null | { kind: 'pin' | 'group'; key: number | string; value: string }>(null);
  const [groupSheet, setGroupSheet] = useState<null | { name: string }>(null);
  const homeRef = useRef(home);
  homeRef.current = home;
  const orderIdRef = useRef<string | null>(null);
  const [eightySix, setEightySix] = useState<Set<string>>(new Set());
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [mode86, setMode86] = useState(false);
  const [modSheet, setModSheet] = useState<null | { item: MenuItem; category: string; groups: ModifierGroup[]; chosen: Record<string, string[]>; notes: string }>(null);
  const [variantSheet, setVariantSheet] = useState<MenuItem | null>(null);
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [lockScreen, setLockScreen] = useState(false);
  const [lockPin, setLockPin] = useState('');
  const [fireSheet, setFireSheet] = useState<null | Array<{ course: string; count: number; picked: boolean }>>(null);
  const [guestView, setGuestView] = useState<GuestProfile | null>(null);
  const [coversEdit, setCoversEdit] = useState<string>('');
  const [coversOpen, setCoversOpen] = useState(false);
  const [openFolder, setOpenFolder] = useState<Pin | null>(null);
  const [folderDraft, setFolderDraft] = useState<null | { name: string; c: string; items: string[]; search: string }>(null);
  const [customise, setCustomise] = useState(false);
  const [wastage, setWastage] = useState<null | { search: string; recipeId: string; itemName: string; quantity: string; reason: string }>(null);
  const [lineAction, setLineAction] = useState<null | { lineId: string; name: string; kind: 'COMP' | 'PRICE_CHANGE'; reason: string; price: string }>(null);
  const [discounting, setDiscounting] = useState<null | { mode: 'percent' | 'amount'; value: string; reason: string }>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [reader, setReader] = useState<Reader | null>(null);
  const [readerBusy, setReaderBusy] = useState<string | null>(null);
  const [closing, setClosing] = useState<null | {
    gate: CloseGate | null;
    drawer: DrawerInfo | null;
    stage: 'checklist' | 'count' | 'report';
    float: string;
    counts: Record<number, string>;
    report: (DaySummary & { drawers: Array<{ openingFloatCents: number; expectedCents: number | null; countedCents: number | null; varianceCents: number | null }> }) | null;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<QueuedSale[]>(() => loadQueue());
  const [cachedRules, setCachedRules] = useState<Array<{ kind: string; percent: number; weekdays: string }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('alma.pos.rulesCache') ?? '[]');
    } catch {
      return [];
    }
  });

  const refreshAuth = useCallback(async () => {
    try {
      const res = await api<{ user: { id: string; firstName?: string; lastName?: string; accountType?: string; deviceAccount?: boolean } | null }>('/api/auth/me');
      const user = res.user;
      if (!user) {
        setMe(null);
        return;
      }
      if (user.accountType === 'VENUE_DEVICE' || user.deviceAccount) {
        // Same PIN flow as Alma Home: the device stays signed in, the human
        // on the register identifies with their PIN.
        const list = await api<{ staff: StaffOption[]; activeUser: { firstName?: string; lastName?: string } | null }>('/api/device/staff');
        const staffName = list.activeUser
          ? `${list.activeUser.firstName ?? ''} ${list.activeUser.lastName ?? ''}`.trim() || null
          : null;
        setMe({ kind: 'device', staffName, staffList: list.staff });
      } else {
        setMe({ kind: 'staff', name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Staff' });
      }
    } catch {
      setMe(null);
    }
  }, []);

  const refreshOpenOrders = useCallback(async () => {
    try {
      setOpenOrders(await api<Order[]>(`/api/pos/orders?venue=${encodeURIComponent(venue)}`));
    } catch {
      /* home refresh is best-effort */
    }
    try {
      const tables = await api<FloorTable[]>(`/api/pos/tables?venue=${encodeURIComponent(venue)}`);
      setFloorTables(tables);
      setFloorArea((current) => current || tables[0]?.area || '');
    } catch {
      /* floor plan is optional */
    }
    try {
      setReservations(await api<FloorReservation[]>(`/api/pos/floor-reservations?venue=${encodeURIComponent(venue)}`));
    } catch {
      /* overlay is optional */
    }
  }, [venue]);

  useEffect(() => {
    localStorage.setItem('alma.pos.view', homeView);
  }, [homeView]);

  // 30s idle → lock the register. Bills live on the server so nothing is
  // lost: device sessions drop to the staff PIN screen, personal sessions
  // get a code-to-unlock overlay; the open bill is restored after.
  useEffect(() => {
    if (!me || me === 'loading') return;
    if (me.kind === 'device' && !me.staffName) return;
    const kind = me.kind;
    const lock = () => {
      localStorage.setItem('alma.pos.resumeOrder', orderIdRef.current ?? '');
      if (kind === 'device') {
        void api('/api/device/pin-logout', { method: 'POST' })
          .then(() => refreshAuth())
          .catch(() => undefined);
      } else {
        setLockScreen(true);
      }
    };
    let timer = window.setTimeout(lock, 30000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, 30000);
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    events.forEach((name) => document.addEventListener(name, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => document.removeEventListener(name, reset));
    };
  }, [me, refreshAuth]);

  // After an auto-lock sign-in, pick the bill back up where it was left.
  useEffect(() => {
    if (!me || me === 'loading') return;
    if (me.kind === 'device' && !me.staffName) return;
    const resume = localStorage.getItem('alma.pos.resumeOrder');
    if (!resume) return;
    localStorage.removeItem('alma.pos.resumeOrder');
    void api<Order>(`/api/pos/orders/${resume}`)
      .then((row) => {
        if (row.status === 'OPEN') {
          setOrder(row);
          setView('register');
        }
      })
      .catch(() => undefined);
  }, [me]);

  useEffect(() => {
    void (async () => {
      await consumeSuiteHandoffToken();
      await refreshAuth();
    })();
  }, [refreshAuth]);

  useEffect(() => {
    localStorage.setItem('alma.pos.venue', venue);
  }, [venue]);

  useEffect(() => {
    if (!me || me === 'loading') return;
    void (async () => {
      try {
        void api<Array<{ name: string }>>('/api/pos/courses')
          .then((rows) => setCourses(rows.map((row) => row.name)))
          .catch(() => undefined);
        void api<Record<string, string[]>>('/api/pos/adjust-reasons').then(setReasons).catch(() => undefined);
        const res = await api<{ categories: MenuCategory[]; eightySix?: string[]; modifierGroups?: ModifierGroup[] }>('/api/pos/menu');
        setMenu(res.categories);
        setEightySix(new Set(res.eightySix ?? []));
        setModifierGroups(res.modifierGroups ?? []);
        setOffline(false);
        localStorage.setItem('alma.pos.menuCache', JSON.stringify(res));
        void api<Array<{ kind: string; percent: number; weekdays: string }>>('/api/pos/rules')
          .then((rules) => {
            setCachedRules(rules);
            localStorage.setItem('alma.pos.rulesCache', JSON.stringify(rules));
          })
          .catch(() => undefined);
        setActiveCategory((current) => current || localStorage.getItem('alma.pos.deviceLanding') || home.landingCategory || HOME_TAB);
        const kinds = new Map<string, string>();
        for (const category of res.categories) for (const item of category.items) kinds.set(item.recipeId, category.kind);
        setKindByRecipe(kinds);
      } catch (err) {
        // Offline: run on the cached menu so quick sales keep flowing.
        const cached = localStorage.getItem('alma.pos.menuCache');
        if (cached && isNetworkError(err)) {
          const res = JSON.parse(cached) as { categories: MenuCategory[]; eightySix?: string[]; modifierGroups?: ModifierGroup[] };
          setMenu(res.categories);
          setEightySix(new Set(res.eightySix ?? []));
          setModifierGroups(res.modifierGroups ?? []);
          setOffline(true);
        } else {
          setError(messageForError(err, 'Could not load the menu.'));
        }
      }
      void refreshOpenOrders();
    })();
  }, [me, refreshOpenOrders]);

  useEffect(() => {
    if (me === 'loading' || !me) return;
    const name = me.kind === 'staff' ? me.name : me.staffName ?? '';
    if (!name) return;
    void api<{ buttons: string[]; pins: unknown[] }>(`/api/pos/homescreen?userKey=${encodeURIComponent(name.toLowerCase())}`)
      .then((config) => {
        const landing = (config as { landingCategory?: string | null }).landingCategory ?? null;
        setHome({
          landingCategory: landing,
          buttons: config.buttons,
          categories: ((config as { categories?: TabsConfig | null }).categories as TabsConfig | null) ?? null,
          // Legacy pins were plain recipeId strings — normalise to the rich shape.
          pins: (config.pins ?? []).map((pin) =>
            typeof pin === 'string' ? ({ t: 'i', id: pin } as Pin) : (pin as Pin)
          )
        });
        setActiveCategory((current) =>
          current && current !== HOME_TAB ? current : localStorage.getItem('alma.pos.deviceLanding') || landing || HOME_TAB
        );
      })
      .catch(() => undefined);
  }, [me]);

  async function connectReader(simulated: boolean) {
    setReaderBusy('Connecting…');
    try {
      if (!terminalRef.current) {
        const StripeTerminal = await loadStripeTerminal();
        if (!StripeTerminal) throw new Error('Stripe Terminal failed to load.');
        terminalRef.current = StripeTerminal.create({
          onFetchConnectionToken: async () => {
            const res = await api<{ secret: string }>('/api/pos/terminal/connection-token', { method: 'POST', body: JSON.stringify({ venue }) });
            return res.secret;
          },
          onUnexpectedReaderDisconnect: () => setReader(null)
        });
      }
      const discovered = await terminalRef.current.discoverReaders({ simulated });
      if ('error' in discovered) throw new Error(discovered.error.message);
      const first = discovered.discoveredReaders[0];
      if (!first) throw new Error(simulated ? 'No simulated reader.' : 'No readers found on this network.');
      const connected = await terminalRef.current.connectReader(first);
      if ('error' in connected) throw new Error(connected.error.message);
      setReader(connected.reader);
    } catch (err) {
      setError(messageForError(err, 'Could not connect a reader.'));
    } finally {
      setReaderBusy(null);
    }
  }

  async function payWithTerminal(amountCents: number, tipCents: number) {
    if (!order || !terminalRef.current || !reader) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await api<{ id: string; clientSecret: string }>('/api/pos/terminal/payment-intent', {
        method: 'POST',
        body: JSON.stringify({ amountCents: amountCents + tipCents, description: `POS ${order.tableLabel ?? order.orderNumber}` })
      });
      const collected = await terminalRef.current.collectPaymentMethod(intent.clientSecret);
      if ('error' in collected) throw new Error(collected.error.message);
      const processed = await terminalRef.current.processPayment(collected.paymentIntent);
      if ('error' in processed) throw new Error(processed.error.message);
      const result = await api<Order>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method: 'STRIPE_TERMINAL', tipCents, amountCents, reference: intent.id })
      });
      if (result.status === 'PAID') {
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        void refreshOpenOrders();
      } else {
        setOrder(result);
        setCharge({ stage: 'split', tipCents: 0, amountCents: null });
      }
    } catch (err) {
      setError(messageForError(err, 'Reader payment failed.'));
    } finally {
      setBusy(false);
    }
  }

  // Flush queued offline sales whenever we're (back) online. The localId is
  // sent as an idempotency key so a replay (double flush, retry after a
  // timed-out-but-committed request) can never duplicate the sale.
  const flushingRef = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      await flushQueueInner();
    } finally {
      flushingRef.current = false;
    }
  }, []);

  async function flushQueueInner() {
    const pending = loadQueue();
    if (pending.length === 0) return;
    for (const sale of pending) {
      try {
        const created = await api<Order>('/api/pos/orders', {
          method: 'POST',
          body: JSON.stringify({ venue: sale.venue, openedByName: sale.openedByName, training: sale.training || undefined, idempotencyKey: sale.localId })
        });
        if (created.status !== 'PAID') {
          await api(`/api/pos/orders/${created.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: sale.lines }) });
          await api(`/api/pos/orders/${created.id}/pay`, {
            method: 'POST',
            body: JSON.stringify(sale.payment)
          });
        }
        const remaining = loadQueue().filter((candidate) => candidate.localId !== sale.localId);
        saveQueue(remaining);
        setQueue(remaining);
        setOffline(false);
      } catch (err) {
        if (isNetworkError(err)) return; // still offline — try again later
        // Server rejected it — drop it out of the queue with a visible error.
        const remaining = loadQueue().filter((candidate) => candidate.localId !== sale.localId);
        saveQueue(remaining);
        setQueue(remaining);
        setError(`A queued sale (${money(sale.totalCents)}) was rejected: ${messageForError(err, 'unknown error')}`);
      }
    }
  }

  useEffect(() => {
    if (!dockets || !autoPrint) return;
    const timer = setTimeout(() => window.print(), 300);
    const after = () => {
      setDockets(null);
      setAutoPrint(false);
    };
    window.addEventListener('afterprint', after);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', after);
    };
  }, [dockets, autoPrint]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList?.contains('pos-modal')) return;
      const close =
        target.querySelector<HTMLButtonElement>('.pos-modal-close') ??
        [...target.querySelectorAll('button')].find((candidate) => /^(done|close|cancel|back to order)$/i.test(candidate.textContent?.trim() ?? ''));
      close?.click();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(() => setInfo(null), 7000);
    return () => clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (loadQueue().length > 0) void flushQueue();
    }, 10000);
    const onOnline = () => {
      setOffline(false);
      void flushQueue();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushQueue]);

  // The bill carries EVERY course as a standing section (collapsed until
  // used); legacy course names on old open orders append after.
  const [courseOpen, setCourseOpen] = useState<Record<string, boolean>>({});
  function courseIsOpen(name: string, count: number) {
    return courseOpen[name] ?? count > 0;
  }
  async function fireCourse(name: string) {
    if (!order || order.id.startsWith('local-') || busy) return;
    setBusy(true);
    try {
      const result = await api<{ dockets: Docket[]; sent: number }>(`/api/pos/orders/${order.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ courses: [name] })
      });
      if (result.dockets.length > 0) {
        setAutoPrint(true);
        setDockets(result.dockets);
      }
      const stamp = new Date().toISOString();
      setOrder((current) =>
        current
          ? { ...current, lines: current.lines.map((line) => ((line.course ?? 'NOW') === name && !(line as { sentAt?: string | null }).sentAt ? { ...line, sentAt: stamp } : line)) }
          : current
      );
      setInfo(`${name} fired to the kitchen.`);
    } catch (err) {
      setError(messageForError(err, 'Could not fire the course.'));
    } finally {
      setBusy(false);
    }
  }

  const billCourses = useMemo(() => {
    const groups = new Map<string, Array<{ line: Order['lines'][number]; index: number }>>();
    for (const name of courses) groups.set(name, []);
    (order?.lines ?? []).forEach((line, index) => {
      const key = line.course ?? courses[0] ?? 'NOW';
      groups.set(key, [...(groups.get(key) ?? []), { line, index }]);
    });
    return [...groups.entries()];
  }, [order, courses]);

  // Bill lines grouped under their course, in service order.
  const courseGroups = useMemo(() => {
    const groups = new Map<string, Array<{ line: Order['lines'][number]; index: number }>>();
    (order?.lines ?? []).forEach((line, index) => {
      const key = line.course ?? 'Mains';
      groups.set(key, [...(groups.get(key) ?? []), { line, index }]);
    });
    const rank = (name: string) => {
      const at = courses.indexOf(name);
      return at === -1 ? 99 : at;
    };
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [order, courses]);

  // The category tab bar, honouring the user's saved order/hidden/groups.
  const tabsConfig: TabsConfig = home.categories ?? { order: [], hidden: [], groups: [] };
  const visibleTabs = useMemo(() => {
    const catNames = menu.map((category) => category.name);
    const grouped = new Set(tabsConfig.groups.flatMap((group) => group.cats));
    const hidden = new Set(tabsConfig.hidden);
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const token of tabsConfig.order) {
      if (token.startsWith('g:')) {
        if (tabsConfig.groups.some((group) => group.name === token.slice(2)) && !seen.has(token)) {
          tokens.push(token);
          seen.add(token);
        }
      } else if (catNames.includes(token) && !grouped.has(token) && !hidden.has(token) && !seen.has(token)) {
        tokens.push(token);
        seen.add(token);
      }
    }
    for (const group of tabsConfig.groups) {
      const token = `g:${group.name}`;
      if (!seen.has(token)) {
        tokens.push(token);
        seen.add(token);
      }
    }
    for (const name of catNames) {
      if (!grouped.has(name) && !hidden.has(name) && !seen.has(name)) {
        tokens.push(name);
        seen.add(name);
      }
    }
    return tokens;
  }, [menu, tabsConfig]);

  function saveTabs(mutate: (config: TabsConfig) => TabsConfig) {
    setHome((current) => {
      const config = mutate(current.categories ?? { order: [], hidden: [], groups: [] });
      const next = { ...current, categories: config };
      setTimeout(() => saveBoard(next), 0);
      return next;
    });
  }

  // Tab drag (edit mode): reorder, or drop a tab ONTO another to group them.
  const dragTabToken = useRef<string | null>(null);
  function tabPointerDown(event: React.PointerEvent, token: string) {
    if (!boardEdit) return;
    event.preventDefault();
    dragTabToken.current = token;
    let dropOn: string | null = null;
    let dropBoard = false;
    let movedTab = false;
    const stamp = Date.now();
    const onMove = (nativeEvent: PointerEvent) => {
      if (dragTabToken.current === null) return;
      const hit = document.elementFromPoint(nativeEvent.clientX, nativeEvent.clientY);
      const target = hit?.closest('[data-tab-token]');
      document.querySelectorAll('[data-tab-token].is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      document.querySelectorAll('.pos-grid-home.is-board-drop').forEach((el) => el.classList.remove('is-board-drop'));
      if (!target) {
        const board = hit?.closest('.pos-grid-home');
        if (board) {
          dropBoard = true;
          board.classList.add('is-board-drop');
        } else {
          dropBoard = false;
        }
        return;
      }
      dropBoard = false;
      const over = target.getAttribute('data-tab-token')!;
      if (over === dragTabToken.current) return;
      // Centre third of the target = "drop into a group"; edges = reorder.
      const rect = target.getBoundingClientRect();
      const ratio = target.closest('.pos-rail-cats')
        ? (nativeEvent.clientY - rect.y) / rect.height
        : (nativeEvent.clientX - rect.x) / rect.width;
      if (ratio > 0.3 && ratio < 0.7 && !dragTabToken.current.startsWith('g:')) {
        dropOn = over;
        target.classList.add('is-drop-target');
        return;
      }
      dropOn = null;
      movedTab = true;
      const from = dragTabToken.current;
      saveTabsQuiet((config) => {
        const order = visibleTabsRef.current.filter((candidate) => candidate !== from);
        order.splice(order.indexOf(over) + (ratio >= 0.5 ? 1 : 0), 0, from);
        return { ...config, order };
      });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.querySelectorAll('[data-tab-token].is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      document.querySelectorAll('.pos-grid-home.is-board-drop').forEach((el) => el.classList.remove('is-board-drop'));
      const from = dragTabToken.current;
      dragTabToken.current = null;
      if (from && dropBoard) {
        // Whole category (or group) dropped on the board → folder with its items.
        const catNames = from.startsWith('g:')
          ? (homeRef.current.categories?.groups.find((group) => group.name === from.slice(2))?.cats ?? [])
          : [from];
        const items = catNames.flatMap((name) => menu.find((category) => category.name === name)?.items.map((item) => item.recipeId) ?? []);
        if (items.length > 0) {
          const folderName = from.startsWith('g:') ? from.slice(2) : from;
          const board = { ...homeRef.current, pins: [...homeRef.current.pins, { t: 'f' as const, name: folderName, items: items.slice(0, 40) }] };
          setHome(board);
          saveBoard(board);
          setInfo(`${folderName} added to Home as a folder (${Math.min(items.length, 40)} items).`);
        }
        return;
      }
      if (from && dropOn) {
        // Group the two tabs (or add to an existing group).
        saveTabs((config) => {
          if (dropOn!.startsWith('g:')) {
            const groupName = dropOn!.slice(2);
            return {
              ...config,
              order: visibleTabsRef.current.filter((candidate) => candidate !== from),
              groups: config.groups.map((group) => (group.name === groupName ? { ...group, cats: [...group.cats, from] } : group))
            };
          }
          let name = 'New group';
          let n = 2;
          while (config.groups.some((group) => group.name === name)) name = `New group ${n++}`;
          const order = visibleTabsRef.current.map((candidate) => (candidate === dropOn ? `g:${name}` : candidate)).filter((candidate) => candidate !== from);
          return { ...config, order, groups: [...config.groups, { name, cats: [dropOn!, from] }] };
        });

      } else if (movedTab) {
        saveBoard(homeRef.current);
      } else if (Date.now() - stamp < 400 && from) {
        // Plain tap in edit mode: hide/show a category tab.
        if (!from.startsWith('g:')) {
          saveTabs((config) => ({
            ...config,
            hidden: config.hidden.includes(from) ? config.hidden.filter((candidate) => candidate !== from) : [...config.hidden, from],
            order: visibleTabsRef.current
          }));
        }
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function commitPinRename(index: number, rawValue: string) {
    const value = rawValue.trim().slice(0, 40);
    setRenaming(null);
    setHome((current) => {
      const pins = current.pins.map((pin, i) => {
        if (i !== index) return pin;
        // Folders rename directly; items keep their real (kitchen) name and
        // get a display label — clearing the field restores the original.
        if (pin.t === 'f') return { ...pin, name: value || pin.name, label: undefined };
        return { ...pin, label: value || undefined };
      });
      const next = { ...current, pins };
      setTimeout(() => saveBoard(next), 0);
      return next;
    });
  }

  function commitGroupRename(oldName: string, rawValue: string) {
    const value = rawValue.trim().slice(0, 30);
    setRenaming(null);
    if (value === oldName) return;
    if (!value) {
      dissolveGroup(oldName);
      return;
    }
    saveTabs((config) => ({
      ...config,
      order: (config.order.length ? config.order : visibleTabsRef.current).map((token) => (token === `g:${oldName}` ? `g:${value}` : token)),
      groups: config.groups.map((group) => (group.name === oldName ? { ...group, name: value } : group))
    }));
    setActiveCategory((current) => (current === `__group__${oldName}` ? `__group__${value}` : current));
  }

  // Remove the folder, keep its categories — they return to the bar in place.
  function dissolveGroup(name: string) {
    saveTabs((config) => {
      const cats = config.groups.find((group) => group.name === name)?.cats ?? [];
      const base = config.order.length ? config.order : visibleTabsRef.current;
      return {
        ...config,
        order: base.flatMap((token) => (token === `g:${name}` ? cats : [token])),
        groups: config.groups.filter((group) => group.name !== name)
      };
    });
    setActiveCategory((current) => (current === `__group__${name}` ? HOME_TAB : current));
  }

  // Pull ONE category out of a folder, back onto the bar beside it.
  function releaseFromGroup(name: string, cat: string) {
    saveTabs((config) => {
      const base = (config.order.length ? config.order : visibleTabsRef.current).filter((token) => token !== cat);
      const at = base.indexOf(`g:${name}`);
      return {
        ...config,
        order: at === -1 ? [...base, cat] : [...base.slice(0, at + 1), cat, ...base.slice(at + 1)],
        groups: config.groups.map((group) => (group.name === name ? { ...group, cats: group.cats.filter((c) => c !== cat) } : group))
      };
    });
  }

  function renameGroupFromSheet(oldName: string, raw: string) {
    const value = raw.trim().slice(0, 30);
    if (!value || value === oldName) return;
    commitGroupRename(oldName, value);
    setGroupSheet({ name: value });
  }

  function newTabFolder() {
    saveTabs((config) => {
      let name = 'New folder';
      let n = 2;
      while (config.groups.some((group) => group.name === name)) name = `New folder ${n++}`;
      return {
        ...config,
        order: [...visibleTabsRef.current, `g:${name}`],
        groups: [...config.groups, { name, cats: [] }]
      };
    });
  }

  // Reorders during a drag must not thrash the server — quiet save, flush on up.
  function saveTabsQuiet(mutate: (config: TabsConfig) => TabsConfig) {
    setHome((current) => ({ ...current, categories: mutate(current.categories ?? { order: [], hidden: [], groups: [] }) }));
  }

  const visibleTabsRef = useRef(visibleTabs);
  visibleTabsRef.current = visibleTabs;

  // Measure how many standard tiles fit without scrolling; big/wide tiles
  // count as 4/2 slots. Under-estimating is safe (a roomier page), scrolling
  // away is not.
  useEffect(() => {
    const el = boardPagerRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth - 32;
      const height = el.clientHeight - 22;
      const cols = Math.max(2, Math.floor((width + 10) / (145 + 10)));
      const rows = Math.max(1, Math.floor((height + 10) / (98 + 10)));
      setBoardSlots(cols * rows);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeCategory, design, view, search]);

  const pinPages = useMemo(() => {
    const weight = (pin: Pin) => (pin.s === 'b' ? 4 : pin.s === 'w' ? 2 : 1);
    // Trailing action tiles (Edit this page / the edit-mode set) render on
    // every page — hold seats for them so nothing clips.
    const capacity = Math.max(2, boardSlots - (boardEdit ? 4 : 1));
    const pages: Array<Array<{ pin: Pin; index: number }>> = [];
    let current: Array<{ pin: Pin; index: number }> = [];
    let used = 0;
    home.pins.forEach((pin, index) => {
      const w = weight(pin);
      if (used + w > capacity && current.length > 0) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push({ pin, index });
      used += w;
    });
    if (current.length > 0 || pages.length === 0) pages.push(current);
    return pages;
  }, [home.pins, boardSlots, boardEdit]);
  pinPageCountRef.current = pinPages.length;
  const boardPageSafe = Math.min(boardPage, pinPages.length - 1);

  useEffect(() => {
    if (boardPage > pinPages.length - 1) setBoardPage(Math.max(0, pinPages.length - 1));
  }, [pinPages.length, boardPage]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) return menu.flatMap((category) => category.items).filter((item) => item.title.toLowerCase().includes(term)).slice(0, 60);
    return (menu.find((category) => category.name === activeCategory)?.items ?? []).filter((item) => !item.variantOf);
  }, [menu, activeCategory, search]);

  // Drag a bill line into another course. Fired lines are locked — a
  // call-away is a promise to the kitchen and is never silently rearranged.
  function lineCoursePointerDown(event: React.PointerEvent, lineId: string) {
    if (!order) return;
    event.preventDefault();
    const source = (event.currentTarget as HTMLElement).closest('.pos-line') as HTMLElement | null;
    const lines = order.lines;
    let dropCourse: string | null = null;
    source?.classList.add('is-dragging');
    const onMove = (nativeEvent: PointerEvent) => {
      nativeEvent.preventDefault();
      const hit = document.elementFromPoint(nativeEvent.clientX, nativeEvent.clientY);
      const target = hit?.closest('[data-course-drop]');
      document.querySelectorAll('[data-course-drop].is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      dropCourse = target?.getAttribute('data-course-drop') ?? null;
      if (target) target.classList.add('is-drop-target');
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      source?.classList.remove('is-dragging');
      document.querySelectorAll('[data-course-drop].is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      const line = lines.find((candidate) => candidate.id === lineId);
      if (dropCourse && line && line.course !== dropCourse) {
        const landed = dropCourse;
        setCourseOpen((current) => ({ ...current, [landed]: true }));
        void pushLines(lines.map((candidate) => (candidate.id === lineId ? { ...candidate, course: landed } : candidate)));
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  async function pushLines(next: OrderLine[]) {
    if (!order) return;
    if (order.id.startsWith('local-')) {
      const subtotal = next.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
      const surcharge = offlineSurcharge(subtotal, cachedRules);
      setOrder({
        ...order,
        lines: next,
        subtotalCents: subtotal,
        surchargeCents: surcharge.cents,
        surchargeLabel: surcharge.label,
        totalCents: subtotal + surcharge.cents,
        gstCents: Math.round((subtotal + surcharge.cents) / 11)
      });
      return;
    }
    setOrder({ ...order, lines: next });
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ lines: next })
      });
      setOrder(updated);
    } catch (err) {
      setError(messageForError(err, 'Could not save the order.'));
      try {
        setOrder(await api<Order>(`/api/pos/orders/${order.id}`));
      } catch {
        /* keep local state */
      }
    }
  }

  function categoryOf(item: MenuItem): string {
    return menu.find((category) => category.items.some((candidate) => candidate.recipeId === item.recipeId))?.name ?? '';
  }

  function addItem(item: MenuItem) {
    if (mode86) {
      void api<{ recipeId: string; eightySixed: boolean }>('/api/pos/eighty-six', {
        method: 'POST',
        body: JSON.stringify({ recipeId: item.recipeId, staffName: operatorName })
      })
        .then((result) => {
          setEightySix((current) => {
            const next = new Set(current);
            if (result.eightySixed) next.add(result.recipeId);
            else next.delete(result.recipeId);
            return next;
          });
        })
        .catch((err) => setError(messageForError(err, 'Could not update the 86 list.')));
      return;
    }
    if (item.variants && item.variants.length > 0) {
      setVariantSheet(item);
      return;
    }
    if (eightySix.has(item.recipeId)) {
      setError(`${item.title} is 86'd (sold out).`);
      return;
    }
    const category = categoryOf(item).toLowerCase();
    const groups = modifierGroups.filter((group) => group.categories.includes(category));
    if (groups.length > 0) {
      setModSheet({ item, category, groups, chosen: {}, notes: '' });
      return;
    }
    void addItemDirect(item, [], '');
  }

  async function addItemDirect(item: MenuItem, modifiers: Array<{ name: string; priceCents: number }>, notes: string) {
    const delta = modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0);
    const line: OrderLine = {
      recipeId: item.recipeId,
      name: item.title,
      unitPriceCents: item.priceCents + delta,
      quantity: 1,
      course: targetCourse ?? defaultCourse(kindByRecipe.get(item.recipeId) ?? 'FOOD'),
      modifiers: modifiers.length ? modifiers : null,
      notes: notes || null
    };
    // The course the item lands in opens so you see it arrive.
    setCourseOpen((current) => ({ ...current, [line.course ?? 'NOW']: true }));
    if (!order) {
      setBusy(true);
      try {
        const created = await api<Order>('/api/pos/orders', {
          method: 'POST',
          body: JSON.stringify({ venue, openedByName: operatorName || undefined, training: training || undefined })
        });
        const updated = await api<Order>(`/api/pos/orders/${created.id}/lines`, {
          method: 'PUT',
          body: JSON.stringify({ lines: [line] })
        });
        setOrder(updated);
        setOffline(false);
      } catch (err) {
        if (isNetworkError(err)) {
          // Offline quick sale: build a LOCAL order the charge flow understands.
          setOffline(true);
          const subtotal = line.unitPriceCents * line.quantity;
          const surcharge = offlineSurcharge(subtotal, cachedRules);
          setOrder({
            id: `local-${Date.now()}`,
            orderNumber: 0,
            venue,
            status: 'OPEN',
            tableLabel: null,
            covers: null,
            subtotalCents: subtotal,
            discountCents: 0,
            discountLabel: null,
            surchargeCents: surcharge.cents,
            surchargeLabel: surcharge.label,
            totalCents: subtotal + surcharge.cents,
            gstCents: Math.round((subtotal + surcharge.cents) / 11),
            tipCents: 0,
            createdAt: new Date().toISOString(),
            lines: [line],
            payments: []
          });
        } else {
          setError(messageForError(err, 'Could not start the sale.'));
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    // Modifier'd lines never merge — each configuration is its own line.
    const existing = modifiers.length === 0 && !notes
      ? order.lines.find(
          (candidate) =>
            candidate.recipeId === item.recipeId &&
            !candidate.modifiers &&
            !candidate.notes &&
            !(candidate as { sentAt?: string | null }).sentAt &&
            (candidate.course ?? null) === (line.course ?? null)
        )
      : undefined;
    const next = existing
      ? order.lines.map((candidate) => (candidate === existing ? { ...candidate, quantity: candidate.quantity + 1 } : candidate))
      : [...order.lines, line];
    void pushLines(next);
  }

  function legacyAddItem(item: MenuItem) {
    if (!order) {
      void quickSaleWithItem(item);
      return;
    }
    const existing = order.lines.find((line) => line.recipeId === item.recipeId);
    const next = existing
      ? order.lines.map((line) => (line.recipeId === item.recipeId ? { ...line, quantity: line.quantity + 1 } : line))
      : [
          ...order.lines,
          {
            recipeId: item.recipeId,
            name: item.title,
            unitPriceCents: item.priceCents,
            quantity: 1,
            course: defaultCourse(kindByRecipe.get(item.recipeId) ?? 'FOOD')
          }
        ];
    void pushLines(next);
  }

  function bumpQty(index: number, delta: number) {
    if (!order) return;
    const next = order.lines
      .map((line, i) => (i === index ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0);
    void pushLines(next);
  }

  function cycleSeat(index: number) {
    if (!order) return;
    const maxSeat = Math.max(order.covers ?? 0, 8);
    const next = order.lines.map((line, i) => {
      if (i !== index) return line;
      const current = line.seat ?? 0;
      return { ...line, seat: current >= maxSeat ? null : current + 1 };
    });
    void pushLines(next);
  }

  function cycleCourse(index: number) {
    if (!order) return;
    const next = order.lines.map((line, i) => {
      if (i !== index) return line;
      const at = courses.indexOf(line.course ?? 'Mains');
      return { ...line, course: courses[(at + 1) % courses.length] };
    });
    void pushLines(next);
  }

  async function quickSaleWithItem(item: MenuItem) {
    setBusy(true);
    try {
      const created = await api<Order>('/api/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ venue, openedByName: operatorName || undefined, training: training || undefined })
      });
      const updated = await api<Order>(`/api/pos/orders/${created.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({
          lines: [{ recipeId: item.recipeId, name: item.title, unitPriceCents: item.priceCents, quantity: 1, course: targetCourse ?? defaultCourse(kindByRecipe.get(item.recipeId) ?? 'FOOD') }]
        })
      });
      setOrder(updated);
      setOpenFolder(null);
    } catch (err) {
      setError(messageForError(err, 'Could not start the sale.'));
    } finally {
      setBusy(false);
    }
  }

  async function openOrder(input: { tableLabel?: string; covers?: number }) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<Order>('/api/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ venue, openedByName: operatorName || undefined, training: training || undefined, ...input })
      });
      setOrder(created);
      setNewTable(null);
      setView('register');
    } catch (err) {
      setError(messageForError(err, 'Could not open the order.'));
    } finally {
      setBusy(false);
    }
  }

  async function takePayment(method: 'CASH' | 'CARD_EXTERNAL') {
    if (!order || !charge || busy) return;
    if (order.id.startsWith('local-')) {
      // Offline settle: queue the whole sale for sync; receipt shows now.
      const tenderedCents = method === 'CASH' ? Math.round(Number(tendered || '0') * 100) || roundCash5(order.totalCents + charge.tipCents) : undefined;
      const sale: QueuedSale = {
        localId: order.id,
        venue,
        training: training || undefined,
        openedByName: operatorName || undefined,
        lines: order.lines,
        payment: { method, tipCents: charge.tipCents, tenderedCents },
        totalCents: order.totalCents,
        createdAt: new Date().toISOString()
      };
      const nextQueue = [...loadQueue(), sale];
      saveQueue(nextQueue);
      setQueue(nextQueue);
      setReceipt({
        ...order,
        status: 'PAID',
        tipCents: charge.tipCents,
        changeCents: tenderedCents ? tenderedCents - order.totalCents - charge.tipCents : null,
        payments: [{ method, amountCents: order.totalCents, tipCents: charge.tipCents }]
      });
      setOrder(null);
      setCharge(null);
      setTendered('');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tenderedCents = method === 'CASH' ? Math.round(Number(tendered || '0') * 100) || undefined : undefined;
      const result = await api<Order>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          method,
          tipCents: charge.tipCents,
          amountCents: charge.amountCents,
          tenderedCents
        })
      });
      setTendered('');
      if (result.status === 'PAID') {
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        void refreshOpenOrders();
      } else {
        setOrder(result);
        setCharge({ stage: 'split', tipCents: 0, amountCents: null });
      }
    } catch (err) {
      setError(messageForError(err, 'Payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function takeGiftPayment(appliesCents: number, coversAll: boolean) {
    if (!order || !charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const amountCents = coversAll ? (charge.amountCents ?? undefined) : Math.max(1, appliesCents);
      const tipCents = coversAll ? charge.tipCents : 0;
      const result = await api<Order & { status: string; giftCardRemainingCents?: number | null }>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method: 'GIFT_CARD', giftCardCode: gift.code.trim(), amountCents, tipCents })
      });
      if (result.giftCardRemainingCents !== null && result.giftCardRemainingCents !== undefined) {
        setInfo(`Gift card ${gift.code.trim()} — ${money(result.giftCardRemainingCents)} remaining.`);
      }
      if (result.status === 'PAID') {
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        void refreshOpenOrders();
      } else {
        setOrder(result);
        setCharge({ stage: 'split', tipCents: coversAll ? 0 : charge.tipCents, amountCents: null });
      }
      setGift({ code: '', balanceCents: null, checking: false });
    } catch (err) {
      setError(messageForError(err, 'Gift card payment failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithPin(pin: string) {
    setBusy(true);
    try {
      await api('/api/pos/unlock', { method: 'POST', body: JSON.stringify({ pin }) });
      setLockScreen(false);
      setLockPin('');
    } catch (err) {
      setLockPin('');
      setError(messageForError(err, 'That code did not match.'));
    } finally {
      setBusy(false);
    }
  }

  async function openDay() {
    try {
      setDay(await api<DaySummary>(`/api/pos/day-summary?venue=${encodeURIComponent(venue)}`));
      void api<{ postToReports: boolean }>(`/api/pos/venue-settings?venue=${encodeURIComponent(venue)}`)
        .then((setting) => setTillFlag(setting.postToReports))
        .catch(() => undefined);
    } catch (err) {
      setError(messageForError(err, 'Could not load the day summary.'));
    }
  }

  if (me === 'loading') return <div className="pos-center">Loading…</div>;
  if (!me) return <SignIn onSignedIn={refreshAuth} />;
  if (me.kind === 'device' && !me.staffName) {
    return <PinScreen staffList={me.staffList} onSignedIn={refreshAuth} />;
  }

  const operatorName = me.kind === 'staff' ? me.name : me.staffName ?? '';
  const userKey = operatorName.toLowerCase();
  const balance = order ? order.totalCents - paidCents(order) : 0;

  return (
    <div className="pos-shell">
      {design === 'rail' ? (
        <aside className="pos-rail">
          <div className="pos-rail-eyebrow">Tonight</div>
          <button type="button" className={view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'} onClick={() => setView('register')}>
            Sale
          </button>
          <button type="button" className={view === 'tables' ? 'pos-rail-item is-on' : 'pos-rail-item'} onClick={() => { setView('tables'); void refreshOpenOrders(); }}>
            Tables
            {openOrders.length > 0 ? <em>{openOrders.length} open</em> : null}
          </button>
          <button
            type="button"
            className="pos-rail-item"
            onClick={() => {
              void api<Order[]>(`/api/pos/orders?venue=${encodeURIComponent(venue)}&status=ALL`)
                .then((rows) => setBills(rows.filter((row) => row.status !== 'OPEN')))
                .catch((err) => setError(messageForError(err, 'Could not load bills.')));
            }}
          >
            Bills
          </button>
          <div className="pos-rail-eyebrow">
            Menu
            <button type="button" className="pos-rail-editbtn" onClick={() => setBoardEdit(!boardEdit)}>
              {boardEdit ? 'Done' : '✎ Edit'}
            </button>
          </div>
          <div className="pos-rail-cats">
            <button type="button" className={activeCategory === HOME_TAB && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'} onClick={() => { setView('register'); setActiveCategory(HOME_TAB); }}>
              ★ Home
            </button>
            <button type="button" className={activeCategory === '__all__' && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'} onClick={() => { setView('register'); setActiveCategory('__all__'); }}>
              Full menu
            </button>
            {visibleTabs.map((token) => {
              const isGroup = token.startsWith('g:');
              const groupName = isGroup ? token.slice(2) : null;
              if (renaming?.kind === 'group' && renaming.key === groupName) {
                return (
                  <input
                    key={token}
                    className="pos-rail-rename"
                    autoFocus
                    defaultValue={groupName ?? ''}
                    onBlur={(event) => commitGroupRename(groupName!, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitGroupRename(groupName!, event.currentTarget.value);
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                  />
                );
              }
              const label = isGroup ? `📁 ${groupName}` : token;
              const target = isGroup ? `__group__${groupName}` : token;
              return (
                <button
                  key={token}
                  type="button"
                  data-tab-token={token}
                  className={`${activeCategory === target && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'}${boardEdit ? ' is-tab-edit' : ''}`}
                  onPointerDown={(event) => tabPointerDown(event, token)}
                  onClick={() => {
                    if (boardEdit) {
                      if (isGroup) setGroupSheet({ name: groupName! });
                      return;
                    }
                    setView('register');
                    setActiveCategory(target);
                  }}
                >
                  {label}
                </button>
              );
            })}
            {boardEdit
              ? tabsConfig.hidden
                  .filter((name) => menu.some((category) => category.name === name))
                  .map((name) => (
                    <button
                      key={`rail-hidden-${name}`}
                      type="button"
                      className="pos-rail-item pos-rail-hidden"
                      onClick={() =>
                        saveTabs((config) => ({ ...config, hidden: config.hidden.filter((candidate) => candidate !== name) }))
                      }
                    >
                      {name} 🚫
                    </button>
                  ))
              : null}
            {boardEdit ? (
              <button type="button" className="pos-rail-item pos-rail-newfolder" onClick={newTabFolder}>
                ＋ New folder
              </button>
            ) : null}
          </div>
          <div className="pos-rail-foot">
            <strong>{operatorName}</strong>
            <small>On the till · {venueIdentity.businessName}</small>
          </div>
        </aside>
      ) : null}
      <div className="pos-main">
      <header className="pos-header">
        <img src="/brand/alma-a-mark.png" alt="" className="pos-mark" onClick={() => { setOrder(null); void refreshOpenOrders(); }} />
        <strong onClick={() => { setOrder(null); void refreshOpenOrders(); }} style={{ cursor: 'pointer' }}>
          {venueIdentity.businessName.toLowerCase()}
        </strong>
        <span className="pos-wordmark-chip">POS</span>
        {view === 'register' ? (
          <span className="pos-crumb">
            {!order ? 'New sale' : order.tableLabel ? `Table ${order.tableLabel}` : `Sale #${order.orderNumber}`}
            {!order ? null : (
              <>
            <button
              type="button"
              className="pos-covers-chip"
              onClick={() => {
                setCoversEdit(String(order.covers ?? ''));
                setCoversOpen(true);
              }}
            >
              {order.covers ?? '–'} covers
            </button>
            {order.guest ? (
              <button
                type="button"
                className="pos-guest-chip"
                onClick={() => {
                  void api<GuestProfile>(`/api/pos/guests/${order.guest!.id}`)
                    .then(setGuestView)
                    .catch((err) => setError(messageForError(err, 'Could not load the guest.')));
                }}
              >
                ☺ {order.guest.firstName} {order.guest.lastName}
              </button>
            ) : null}
              </>
            )}
          </span>
        ) : (
          <select value={venue} onChange={(event) => setVenue(event.currentTarget.value)}>
            {VENUES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        {view === 'register' ? (
          <input className="pos-search" placeholder="Search menu…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="pos-theme-btn"
          title="Switch light / dark"
          onClick={() => setDarkTheme(!darkTheme)}
        >
          {darkTheme ? '☀' : '☾'}
        </button>
        {operatorName ? (
          <button
            type="button"
            className="pos-staff-chip"
            title="Switch staff"
            onClick={() => {
              if (me.kind !== 'device') return;
              void api('/api/device/pin-logout', { method: 'POST' })
                .catch(() => undefined)
                .then(() => refreshAuth());
            }}
          >
            {operatorName}
            {me.kind === 'device' ? ' · switch' : ''}
          </button>
        ) : null}
        {view === 'register' && order ? (
          <>
            <button
              type="button"
              className="pos-ghost"
              disabled={busy || order.lines.every((line) => (line as { sentAt?: string | null }).sentAt)}
              onClick={() => {
                const held = new Map<string, number>();
                for (const line of order.lines) {
                  if ((line as { sentAt?: string | null }).sentAt) continue;
                  const course = line.course ?? 'Mains';
                  held.set(course, (held.get(course) ?? 0) + line.quantity);
                }
                const courseList = courses.filter((course) => held.has(course)).concat([...held.keys()].filter((course) => !courses.includes(course)));
                setFireSheet(courseList.map((course, index) => ({ course, count: held.get(course) ?? 0, picked: index === 0 })));
              }}
            >
              Send
            </button>
            <button
              type="button"
              className="pos-ghost"
              disabled={order.lines.length === 0}
              title="Print the full order docket — nothing is fired; call courses away when ready"
              onClick={() => {
                const sorted = [...order.lines].sort(
                  (a, b) => courses.indexOf(a.course ?? 'NOW') - courses.indexOf(b.course ?? 'NOW')
                );
                setDockets([
                  {
                    profile: 'Full order',
                    printerIp: null,
                    tableLabel: order.tableLabel,
                    orderNumber: order.orderNumber,
                    covers: order.covers,
                    openedByName: operatorName,
                    lines: sorted.map((line) => ({
                      id: line.id ?? line.recipeId ?? line.name,
                      name: line.name,
                      quantity: line.quantity,
                      course: line.course ?? 'NOW',
                      seat: line.seat ?? null,
                      modifiers: (line.modifiers as Array<{ name: string; priceCents: number }> | null) ?? [],
                      notes: line.notes ?? null
                    }))
                  } as Docket
                ]);
              }}
            >
              Print
            </button>
            <button type="button" className="pos-ghost" disabled={order.lines.length === 0} onClick={() => setBill(order)}>
              Bill
            </button>
            {order.tableLabel ? (
              <button
                type="button"
                className="pos-ghost"
                onClick={() => setMerging(openOrders.filter((open) => open.id !== order.id))}
              >
                Merge
              </button>
            ) : null}
            <button type="button" className="pos-ghost" onClick={() => { setOrder(null); }}>
              Exit
            </button>
            <button type="button" className="pos-ghost" onClick={() => { setView('tables'); void refreshOpenOrders(); }}>
              Tables
            </button>
          </>
        ) : view === 'register' ? (
          <>
            <button type="button" className="pos-ghost" onClick={() => { setView('tables'); void refreshOpenOrders(); }}>
              Tables
            </button>
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                void api<Order[]>(`/api/pos/orders?venue=${encodeURIComponent(venue)}&status=ALL`)
                  .then((rows) => setBills(rows.filter((row) => row.status !== 'OPEN')))
                  .catch((err) => setError(messageForError(err, 'Could not load bills.')));
              }}
            >
              Bills
            </button>
          </>
        ) : (
          <>
            <button type="button" className="pos-ghost" onClick={() => setView('register')}>
              Register
            </button>
            <button type="button" className={`pos-ghost ${editLayout ? 'pos-ghost-active' : ''}`} onClick={() => setEditLayout(!editLayout)}>
              {editLayout ? 'Done editing' : 'Edit layout'}
            </button>
            <button type="button" className="pos-ghost" onClick={() => void openDay()}>
              Day
            </button>
            {me.kind === 'staff' ? (
              <a className="pos-ghost" href="#office" style={{ textDecoration: 'none' }}>
                Office
              </a>
            ) : null}
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                void (async () => {
                  const [gate, drawer] = await Promise.all([
                    api<CloseGate>(`/api/pos/close-day?venue=${encodeURIComponent(venue)}`),
                    api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
                  ]);
                  setClosing({ gate, drawer, stage: 'checklist', float: '', counts: {}, report: null });
                })().catch((err) => setError(messageForError(err, 'Could not load close of day.')));
              }}
            >
              Close
            </button>
          </>
        )}
      </header>

      {error ? (
        <div className="pos-error" onClick={() => setError(null)}>
          {error} — tap to dismiss
        </div>
      ) : null}
      {info ? (
        <div className="pos-info" onClick={() => setInfo(null)}>
          {info}
        </div>
      ) : null}
      {training ? (
        <div
          className="pos-training"
          onClick={() => {
            setTraining(false);
            localStorage.setItem('alma.pos.training', '0');
          }}
        >
          TRAINING MODE — sales don't count, nothing reaches the kitchen. Tap to end.
        </div>
      ) : null}
      {offline || queue.length > 0 ? (
        <div className={offline ? 'pos-offline' : 'pos-offline is-syncing'}>
          {offline ? 'OFFLINE — quick sales keep working and queue on this device' : 'Back online'}
          {queue.length > 0 ? ` · ${queue.length} sale${queue.length === 1 ? '' : 's'} queued` : ''}
          {!offline && queue.length > 0 ? ' · syncing…' : ''}
        </div>
      ) : null}

      {view === 'tables' ? (
        <div className="pos-home">
          {floorTables.length > 0 ? (
            <button
              type="button"
              className="pos-view-chip"
              onClick={() => setHomeView(homeView === 'floor' ? 'list' : 'floor')}
            >
              {homeView === 'floor' ? '☰ List' : '▦ Floor'}
            </button>
          ) : null}
          {homeView === 'floor' && floorTables.length > 0 ? (
            <FloorView
              tables={floorTables}
              area={floorArea}
              setArea={setFloorArea}
              openOrders={openOrders}
              reservations={reservations}
              busy={busy}
              editing={editLayout}
              onMove={(tableId, posX, posY) => {
                setFloorTables((current) => current.map((table) => (table.id === tableId ? { ...table, posX, posY } : table)));
                void api(`/api/pos/tables/${tableId}/position`, {
                  method: 'PATCH',
                  body: JSON.stringify({ posX, posY })
                }).catch(() => undefined);
              }}
              onPick={(table) => {
                if (editLayout) return;
                const existing = openOrders.find(
                  (open) => (open.tableLabel ?? '').toLowerCase() === table.label.toLowerCase()
                );
                setView('register');
                if (existing) setOrder(existing);
                else void openOrder({ tableLabel: table.label, covers: table.seats ?? undefined });
              }}
            />
          ) : null}
          {homeView === 'floor' && floorTables.length > 0 ? null : null}
          <div className="pos-home-grid" style={homeView === 'floor' && floorTables.length > 0 ? { display: 'none' } : undefined}>
            {openOrders.map((open) => (
              <button
                key={open.id}
                type="button"
                className={`pos-table-card is-${fireState(open.lines as Array<{ sentAt?: string | null }>)}`}
                onClick={() => { setOrder(open); setView('register'); }}
              >
                <strong>{open.tableLabel ? `Table ${open.tableLabel}` : `#${open.orderNumber}`}</strong>
                <span className="pos-muted">
                  {open.covers ? `${open.covers} covers · ` : ''}
                  {ageMinutes(open.createdAt)}m
                </span>
                <span className="pos-table-total">
                  {money(open.totalCents)}
                  {paidCents(open) > 0 ? <small> ({money(open.totalCents - paidCents(open))} owing)</small> : null}
                </span>
              </button>
            ))}
            {openOrders.length === 0 ? <p className="pos-muted">No open tables at {venue}.</p> : null}
          </div>
        </div>
      ) : (
        <div className="pos-body">
          <div className="pos-menu">
            {!search ? (
              <nav className="pos-tabs">
                <button
                  type="button"
                  className={mode86 ? 'is-86' : ''}
                  title="86 mode: tap items to mark sold out"
                  onClick={() => setMode86(!mode86)}
                >
                  86
                </button>
                <button
                  type="button"
                  className={activeCategory === HOME_TAB ? 'is-active is-home' : 'is-home'}
                  onClick={() => setActiveCategory(HOME_TAB)}
                >
                  {HOME_TAB}
                </button>
                {visibleTabs.map((token) => {
                  const isGroup = token.startsWith('g:');
                  const groupName = isGroup ? token.slice(2) : null;
                  const active = isGroup ? activeCategory === `__group__${groupName}` : activeCategory === token;
                  if (renaming?.kind === 'group' && renaming.key === groupName) {
                    return (
                      <input
                        key={token}
                        className="pos-tab-rename"
                        autoFocus
                        defaultValue={groupName ?? ''}
                        onBlur={(event) => commitGroupRename(groupName!, event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitGroupRename(groupName!, event.currentTarget.value);
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                      />
                    );
                  }
                  return (
                    <button
                      key={token}
                      type="button"
                      data-tab-token={token}
                      className={`${active ? 'is-active' : ''} ${isGroup ? 'is-group' : ''} ${boardEdit ? 'is-tab-edit' : ''}`}
                      onPointerDown={(event) => tabPointerDown(event, token)}
                      onClick={() => {
                        if (boardEdit) {
                          if (isGroup) setGroupSheet({ name: groupName! });
                          return;
                        }
                        setActiveCategory(isGroup ? `__group__${groupName}` : token);
                      }}
                    >
                      {isGroup ? `📁 ${groupName}` : token}
                    </button>
                  );
                })}
                {boardEdit
                  ? tabsConfig.hidden
                      .filter((name) => menu.some((category) => category.name === name))
                      .map((name) => (
                        <button
                          key={`hidden-${name}`}
                          type="button"
                          className="is-tab-hidden"
                          onClick={() =>
                            saveTabs((config) => ({ ...config, hidden: config.hidden.filter((candidate) => candidate !== name) }))
                          }
                        >
                          {name} 🚫
                        </button>
                      ))
                  : null}
                {boardEdit ? (
                  <button type="button" className="pos-tab-newfolder" onClick={newTabFolder}>
                    ＋ Folder
                  </button>
                ) : null}
              </nav>
            ) : null}
            {design === 'rail' && (activeCategory === '__all__' || (menu.some((category) => category.name === activeCategory) && !search)) ? (
              <div className="pos-list">
                {(activeCategory === '__all__' ? menu : menu.filter((category) => category.name === activeCategory)).map((category) => {
                  const rows = category.items.filter((item) => (search ? item.title.toLowerCase().includes(search.toLowerCase()) : !item.variantOf));
                  if (rows.length === 0) return null;
                  const qtyOf = (recipeId: string) =>
                    (order?.lines ?? []).filter((line) => line.recipeId === recipeId).reduce((sum, line) => sum + line.quantity, 0);
                  const collapsible = activeCategory === '__all__' && !search;
                  return (
                    <details
                      key={category.name}
                      className="pos-list-section"
                      {...(collapsible ? {} : { open: true })}
                    >
                      <summary
                        className="pos-list-head"
                        onClick={(event) => {
                          if (!collapsible) event.preventDefault();
                        }}
                      >
                        <i className={`pos-list-dot ${hueClass(hueForCategory(category.name))}`} />
                        <h3>{category.name}</h3>
                        <small>
                          {rows.length} item{rows.length === 1 ? '' : 's'}
                        </small>
                      </summary>
                      <div className="pos-list-card">
                        {rows.map((item) => {
                          const quantity = qtyOf(item.recipeId);
                          return (
                            <button
                              key={item.recipeId}
                              type="button"
                              className={`pos-list-row ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                              disabled={busy}
                              onClick={() => addItem(item)}
                            >
                              <i className={`pos-list-dot ${hueClass(hueForCategory(category.name))}`} />
                              <span>{item.title}</span>
                              {quantity > 0 ? <em>×{quantity}</em> : null}
                              <b>{eightySix.has(item.recipeId) ? "86'd" : money(item.priceCents)}</b>
                              <u>＋</u>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : !search && activeCategory === HOME_TAB ? (
              <div className="pos-home-wrap">
              <div className="pos-grid pos-grid-home pos-grid-mgmt">
                {(home.buttons.length ? home.buttons : ['open-till', 'discount', 'comp', 'wastage', 'price']).map((key) => {
                  const labels: Record<string, string> = {
                    'open-till': 'Open till',
                    discount: 'Discount',
                    comp: 'Comp',
                    wastage: 'Wastage',
                    price: 'Change price'
                  };
                  return (
                    <button
                      key={key}
                      type="button"
                      className="pos-item pos-item-mgmt pos-item-slim"
                      onClick={() => {
                        if (boardEdit) {
                          const board = { ...home, buttons: (home.buttons.length ? home.buttons : ['open-till', 'discount', 'comp', 'wastage', 'price']).filter((candidate) => candidate !== key) };
                          setHome(board);
                          saveBoard(board);
                          return;
                        }
                        if (key === 'open-till') {
                          void (async () => {
                            const [gate, drawer] = await Promise.all([
                              api<CloseGate>(`/api/pos/close-day?venue=${encodeURIComponent(venue)}`),
                              api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
                            ]);
                            setClosing({ gate, drawer, stage: 'checklist', float: '', counts: {}, report: null });
                          })().catch(() => undefined);
                        } else if (key === 'wastage') {
                          setWastage({ search: '', recipeId: '', itemName: '', quantity: '1', reason: '' });
                        } else if (key === 'discount') {
                          if (order && order.lines.length > 0) setDiscounting({ mode: 'percent', value: '10', reason: '' });
                          else setError('Start a sale first, then apply the discount.');
                        } else {
                          setError(`Tap the item's name on the bill to ${key === 'comp' ? 'comp it' : 'change its price'}.`);
                        }
                      }}
                    >
                      {boardEdit ? <i className="pos-pin-x">✕</i> : null}
                      <span>{labels[key] ?? key}</span>
                    </button>
                  );
                })}
                {boardEdit
                  ? ['open-till', 'discount', 'comp', 'wastage', 'price']
                      .filter((key) => !(home.buttons.length ? home.buttons : ['open-till', 'discount', 'comp', 'wastage', 'price']).includes(key))
                      .map((key) => {
                        const labels: Record<string, string> = { 'open-till': 'Open till', discount: 'Discount', comp: 'Comp', wastage: 'Wastage', price: 'Change price' };
                        return (
                          <button
                            key={`add-${key}`}
                            type="button"
                            className="pos-item pos-item-mgmt pos-item-slim is-addable"
                            onClick={() => {
                              const board = { ...home, buttons: [...(home.buttons.length ? home.buttons : []), key] };
                              setHome(board);
                              saveBoard(board);
                            }}
                          >
                            <span>＋ {labels[key]}</span>
                          </button>
                        );
                      })
                  : null}
              </div>
              <div
                className="pos-board-pager"
                ref={boardPagerRef}
                onPointerDown={(event) => {
                  if (boardEdit) return;
                  const startX = event.clientX;
                  const startY = event.clientY;
                  const onSwipeMove = (nativeEvent: PointerEvent) => {
                    const dx = nativeEvent.clientX - startX;
                    const dy = nativeEvent.clientY - startY;
                    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                      cleanup();
                      boardSwiped.current = true;
                      setBoardPage((current) =>
                        dx < 0 ? Math.min(current + 1, pinPageCountRef.current - 1) : Math.max(current - 1, 0)
                      );
                      setTimeout(() => {
                        boardSwiped.current = false;
                      }, 350);
                    }
                  };
                  const cleanup = () => {
                    document.removeEventListener('pointermove', onSwipeMove);
                    document.removeEventListener('pointerup', cleanup);
                    document.removeEventListener('pointercancel', cleanup);
                  };
                  document.addEventListener('pointermove', onSwipeMove);
                  document.addEventListener('pointerup', cleanup);
                  document.addEventListener('pointercancel', cleanup);
                }}
                onClickCapture={(event) => {
                  if (boardSwiped.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    boardSwiped.current = false;
                  }
                }}
              >
              <div className="pos-grid pos-grid-home pos-board-page">
                {(pinPages[boardPageSafe] ?? []).map(({ pin, index }) => {
                  const editProps = boardEdit
                    ? { onPointerDown: (event: React.PointerEvent) => boardPinPointerDown(event, index) }
                    : {};
                  const cycleColour = () => {
                    if (dragMoved.current) {
                      dragMoved.current = false;
                      return;
                    }
                    const at = BRIGHT_PALETTE.indexOf(pin.c ?? '');
                    const next = BRIGHT_PALETTE[(at + 1) % BRIGHT_PALETTE.length];
                    const board = { ...home, pins: home.pins.map((candidate, i) => (i === index ? { ...candidate, c: next || undefined } : candidate)) };
                    setHome(board);
                    saveBoard(board);
                  };
                  const removePin = (event: React.MouseEvent) => {
                    event.stopPropagation();
                    const board = { ...home, pins: home.pins.filter((_, i) => i !== index) };
                    setHome(board);
                    saveBoard(board);
                  };
                  const sizeClass = pin.s === 'w' ? 'pos-size-w' : pin.s === 'b' ? 'pos-size-b' : '';
                  const cycleSize = (event: React.MouseEvent) => {
                    event.stopPropagation();
                    const next: 'w' | 'b' | undefined = pin.s === 'w' ? 'b' : pin.s === 'b' ? undefined : 'w';
                    const board = { ...home, pins: home.pins.map((candidate, i) => (i === index ? { ...candidate, s: next } : candidate)) };
                    setHome(board);
                    saveBoard(board);
                  };
                  const startRename = (event: React.MouseEvent) => {
                    event.stopPropagation();
                    setRenaming({ kind: 'pin', key: index, value: pin.label ?? (pin.t === 'f' ? pin.name : '') });
                  };
                  const badges = boardEdit ? (
                    <>
                      <i className="pos-pin-x" onClick={removePin}>✕</i>
                      <i className="pos-pin-size" onClick={cycleSize}>⤢</i>
                      <i className="pos-pin-rename" onClick={startRename}>✎</i>
                    </>
                  ) : null;
                  const renameInput =
                    renaming?.kind === 'pin' && renaming.key === index ? (
                      <input
                        className="pos-pin-rename-input"
                        autoFocus
                        defaultValue={renaming.value}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={(event) => commitPinRename(index, event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitPinRename(index, event.currentTarget.value);
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : null;
                  if (pin.t === 'f') {
                    return (
                      <button
                        key={`f-${index}`}
                        type="button"
                        data-pin-index={index}
                        data-pin-folder={pin.name}
                        className={`pos-item pos-item-pin ${hueClass(pin.c)} ${sizeClass} ${boardEdit ? 'is-editing' : ''}`}
                        style={hueStyle(pin.c)}
                        {...editProps}
                        onClick={() => {
                          if (dragMoved.current) {
                            dragMoved.current = false;
                            return;
                          }
                          setActiveCategory(`__folder__${index}`);
                        }}
                      >
                        {badges}
                        {renameInput ?? (
                          <>
                            <span className={pinDisplay(pin, pin.name).cls}>📁 {pinDisplay(pin, pin.name).main}</span>
                            <small>{pin.items.length} items</small>
                          </>
                        )}
                      </button>
                    );
                  }
                  const item = menu.flatMap((category) => category.items).find((candidate) => candidate.recipeId === pin.id);
                  if (!item) return null;
                  return (
                    <button
                      key={pin.id}
                      type="button"
                      data-pin-index={index}
                      className={`pos-item pos-item-pin ${hueClass(pin.c)} ${sizeClass} ${boardEdit ? 'is-editing' : ''} ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                      style={hueStyle(pin.c)}
                      disabled={busy && !boardEdit}
                      {...editProps}
                      onClick={() => (boardEdit ? cycleColour() : addItem(item))}
                    >
                      {badges}
                      {renameInput ?? (
                        <>
                          <span className={pinDisplay(pin, item.title).cls}>{pinDisplay(pin, item.title).main}</span>
                          <small>{eightySix.has(item.recipeId) ? "86'd — sold out" : money(item.priceCents)}</small>
                        </>
                      )}
                    </button>
                  );
                })}
                {boardEdit ? (
                  <>
                    <button
                      type="button"
                      className="pos-item pos-item-edit"
                      onClick={() => {
                        const board = { ...home, pins: [...home.pins, { t: 'f' as const, name: 'New folder', items: [] }] };
                        setHome(board);
                        saveBoard(board);
                        setRenaming({ kind: 'pin', key: board.pins.length - 1, value: 'New folder' });
                      }}
                    >
                      <span>📁 New folder</span>
                      <small>then drag items in</small>
                    </button>
                    <button type="button" className="pos-item pos-item-edit" onClick={() => setCustomise(true)}>
                      <span>＋ Add pins</span>
                      <small>search the menu</small>
                    </button>
                    <button
                      type="button"
                      className="pos-item pos-item-edit"
                      onClick={() => setDesign(design === 'rail' ? 'classic' : 'rail')}
                    >
                      <span>⇄ Switch design</span>
                      <small>{design === 'rail' ? 'to classic tiles' : 'to sidebar list'}</small>
                    </button>
                    <button
                      type="button"
                      className="pos-item pos-item-edit is-done"
                      onClick={() => {
                        setBoardEdit(false);
                        saveBoard();
                      }}
                    >
                      <span>✓ Done</span>
                      <small>save layout</small>
                    </button>
                  </>
                ) : (
                  <button type="button" className="pos-item pos-item-edit" onClick={() => setBoardEdit(true)}>
                    <span>✎ Edit this page</span>
                    <small>drag · colour · remove</small>
                  </button>
                )}
              </div>
              </div>
              {pinPages.length > 1 ? (
                <div className="pos-board-dots">
                  <button type="button" onClick={() => setBoardPage((current) => Math.max(0, current - 1))} disabled={boardPageSafe === 0}>
                    ‹
                  </button>
                  {pinPages.map((_, pageIndex) => (
                    <i
                      key={pageIndex}
                      className={pageIndex === boardPageSafe ? 'is-on' : ''}
                      onClick={() => setBoardPage(pageIndex)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setBoardPage((current) => Math.min(pinPages.length - 1, current + 1))}
                    disabled={boardPageSafe >= pinPages.length - 1}
                  >
                    ›
                  </button>
                </div>
              ) : null}
              </div>
            ) : !search && activeCategory.startsWith('__folder__') ? (
              <div className="pos-grid pos-grid-home">
                <button type="button" className="pos-item pos-item-edit" onClick={() => setActiveCategory(HOME_TAB)}>
                  <span>← Back</span>
                  <small>home</small>
                </button>
                {(() => {
                  const folderIndex = Number(activeCategory.slice('__folder__'.length));
                  const pin = home.pins[folderIndex];
                  if (!pin || pin.t !== 'f') return null;
                  return pin.items.map((recipeId, itemIndex) => {
                    const item = menu.flatMap((category) => category.items).find((candidate) => candidate.recipeId === recipeId);
                    if (!item) return null;
                    return (
                      <button
                        key={recipeId}
                        type="button"
                        data-fitem-index={itemIndex}
                        className={`pos-item pos-item-pin ${hueClass(pin.c)} ${boardEdit ? 'is-editing' : ''} ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                        style={hueStyle(pin.c)}
                        disabled={busy && !boardEdit}
                        onPointerDown={boardEdit ? (event) => folderItemPointerDown(event, folderIndex, itemIndex) : undefined}
                        onClick={() => {
                          if (boardEdit) {
                            if (dragMoved.current) dragMoved.current = false;
                            return;
                          }
                          addItem(item);
                        }}
                      >
                        {boardEdit ? (
                          <>
                            <i
                              className="pos-pin-rename pos-pin-star"
                              title="Pin to Home — stays in this folder"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (home.pins.some((candidate) => candidate.t === 'i' && candidate.id === recipeId)) {
                                  setInfo('Already pinned to Home.');
                                  return;
                                }
                                const board = { ...home, pins: [...home.pins, { t: 'i' as const, id: recipeId }] };
                                setHome(board);
                                saveBoard(board);
                                setInfo(`${item.title} pinned to Home — still in the folder.`);
                              }}
                            >
                              ★
                            </i>
                            <i
                              className="pos-pin-x"
                              title="Remove from this folder"
                              onClick={(event) => {
                                event.stopPropagation();
                                const board = {
                                  ...home,
                                  pins: home.pins.map((candidate, i) =>
                                    i === folderIndex && candidate.t === 'f'
                                      ? { ...candidate, items: candidate.items.filter((candidateId) => candidateId !== recipeId) }
                                      : candidate
                                  )
                                };
                                setHome(board);
                                saveBoard(board);
                              }}
                            >
                              ✕
                            </i>
                          </>
                        ) : null}
                        <span>{item.title}</span>
                        <small>{eightySix.has(item.recipeId) ? "86'd — sold out" : money(item.priceCents)}</small>
                      </button>
                    );
                  });
                })()}
              </div>
            ) : !search && activeCategory.startsWith('__group__') ? (
              <div className="pos-grid-groups">
                {(() => {
                  const group = tabsConfig.groups.find((candidate) => candidate.name === activeCategory.slice('__group__'.length));
                  if (!group) return null;
                  return group.cats.map((catName) => {
                    const category = menu.find((candidate) => candidate.name === catName);
                    if (!category) return null;
                    return (
                      <section key={catName}>
                        <h3 className="pos-group-head">{catName}</h3>
                        <div className="pos-grid">
                          {category.items.map((item) => (
                            <button
                              key={item.recipeId}
                              type="button"
                              className={`pos-item ${hueClass(hueForCategory(catName))} ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                              onClick={() => addItem(item)}
                            >
                              <span>{item.title}</span>
                              <small>{eightySix.has(item.recipeId) ? "86'd — sold out" : money(item.priceCents)}</small>
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="pos-grid">
                {visibleItems.map((item) => (
                  <button
                    key={item.recipeId}
                    type="button"
                    className={`pos-item ${hueClass(hueForCategory(categoryOf(item)))} ${eightySix.has(item.recipeId) ? 'is-86d' : ''} ${item.variants?.length ? 'has-variants' : ''}`}
                    onClick={() => addItem(item)}
                  >
                    {boardEdit ? (
                      <i
                        className="pos-pin-x"
                        title="Hide from the POS (restore in the Office)"
                        onClick={(event) => {
                          event.stopPropagation();
                          void api('/api/pos/menu-hides', { method: 'POST', body: JSON.stringify({ kind: 'ITEM', key: item.recipeId, hiddenBy: item.title }) })
                            .then(() => {
                              setInfo(`${item.title} hidden from the POS — restore it in the Office.`);
                              setMenu((current) => current.map((category) => ({ ...category, items: category.items.filter((candidate) => candidate.recipeId !== item.recipeId) })));
                            })
                            .catch((err) => setError(messageForError(err, 'Could not hide it.')));
                        }}
                      >
                        ⊘
                      </i>
                    ) : null}
                    <span>{item.title}</span>
                    <small>{eightySix.has(item.recipeId) ? "86'd — sold out" : money(item.priceCents)}</small>
                  </button>
                ))}
                {visibleItems.length === 0 ? <p className="pos-muted">No items{search ? ' match' : ''}.</p> : null}
              </div>
            )}
          </div>

          <aside className={`pos-cart ${cartOpen ? 'is-open' : ''} ${billCollapsed ? 'is-collapsed' : ''}`}>
            {billCollapsed ? (
              <button type="button" className="pos-cart-strip" onClick={() => setBillCollapsed(false)} title="Expand the bill">
                <span className="pos-strip-chevron">«</span>
                <i className={`pos-strip-dot is-${fireState((order?.lines ?? []) as Array<{ sentAt?: string | null }>)}`} />
                <b className="pos-strip-total">{money(balance)}</b>
                <small className="pos-strip-count">
                  {(order?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0) || 0} it.
                </small>
              </button>
            ) : (
              <button type="button" className="pos-cart-fold" onClick={() => setBillCollapsed(true)} title="Collapse the bill">
                »
              </button>
            )}
            <button type="button" className="pos-cart-summary" onClick={() => setCartOpen(!cartOpen)}>
              <span>
                {order && order.lines.length > 0
                  ? `${order.lines.reduce((sum, line) => sum + line.quantity, 0)} item${order.lines.reduce((sum, line) => sum + line.quantity, 0) === 1 ? '' : 's'} · ${money(balance)}`
                  : 'No items yet'}
              </span>
              <b>{cartOpen ? 'Hide bill ▾' : 'View bill ▴'}</b>
            </button>
            <div className="pos-cart-lines">
              {(order?.lines ?? []).length === 0 && !targetCourse ? (
                <div className="pos-cart-empty">
                  <img src="/brand/alma-fish.png" alt="" className="pos-fish-empty" />
                  <p className="pos-muted">Tap a course, then tap items — they land in that course.</p>
                </div>
              ) : null}
              {billCourses.map(([groupCourse, entries]) => (
                <div key={groupCourse} data-course-drop={groupCourse} className={`pos-course-group ${courseIsOpen(groupCourse, entries.length) ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    data-course-drop={groupCourse}
                    className={`pos-course-head ${targetCourse === groupCourse ? 'is-target' : ''}`}
                    onClick={() => {
                      const open = courseIsOpen(groupCourse, entries.length);
                      if (targetCourse === groupCourse && open) {
                        setTargetCourse(null);
                        setCourseOpen((current) => ({ ...current, [groupCourse]: false }));
                      } else {
                        setTargetCourse(groupCourse);
                        setCourseOpen((current) => ({ ...current, [groupCourse]: true }));
                      }
                    }}
                  >
                    <span>
                      {groupCourse}
                      {targetCourse === groupCourse ? <i className="pos-course-dot" /> : null}
                    </span>
                    <small>
                      {entries.length > 0 ? `${entries.reduce((sum, entry) => sum + entry.line.quantity, 0)} item${entries.length === 1 && entries[0]!.line.quantity === 1 ? '' : 's'}` : ''}
                      {(() => {
                        const unsent = entries.filter((entry) => !(entry.line as { sentAt?: string | null }).sentAt).length;
                        const sent = entries.length - unsent;
                        if (unsent > 0) {
                          return (
                            <i
                              className="pos-fire"
                              title={`Fire ${groupCourse} — ${unsent} line${unsent === 1 ? '' : 's'} waiting`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void fireCourse(groupCourse);
                              }}
                            >
                              🔥
                            </i>
                          );
                        }
                        if (sent > 0) return <i className="pos-fired" title="Called away">✓</i>;
                        return null;
                      })()}
                      {' '}
                      {courseIsOpen(groupCourse, entries.length) ? '▾' : '▸'}
                    </small>
                  </button>
                  {courseIsOpen(groupCourse, entries.length) ? entries.map(({ line, index }) => (
                <div key={`${line.recipeId}-${index}`} className={`pos-line ${(line as { sentAt?: string | null }).sentAt ? 'is-locked' : ''}`}>
                  {(line as { sentAt?: string | null }).sentAt ? (
                    <i className="pos-line-grip is-locked" title="Called away — locked to its course">🔒</i>
                  ) : line.id ? (
                    <i className="pos-line-grip" title="Drag into another course" onPointerDown={(event) => lineCoursePointerDown(event, line.id!)}>⠿</i>
                  ) : null}
                  <span className="pos-line-main">
                    <span
                      className="pos-line-name"
                      onClick={() =>
                        line.id
                          ? setLineAction({ lineId: line.id, name: line.name, kind: 'COMP', reason: '', price: '' })
                          : undefined
                      }
                    >
                      {line.name}
                    </span>
                    <span className="pos-line-chips">
                      <button type="button" className="pos-course" onClick={() => cycleCourse(index)}>
                        {line.course ?? 'Mains'}
                      </button>
                      <button type="button" className="pos-course" onClick={() => cycleSeat(index)}>
                        {line.seat ? `S${line.seat}` : 'S–'}
                      </button>
                      {!line.sentAt ? <span className="pos-held">held</span> : null}
                    </span>
                    {line.modifiers?.length || line.notes ? (
                      <small className="pos-line-mods">
                        {(line.modifiers ?? []).map((modifier) => modifier.name).join(', ')}
                        {line.notes ? `${line.modifiers?.length ? ' · ' : ''}${line.notes}` : ''}
                      </small>
                    ) : null}
                  </span>
                  <span className="pos-stepper">
                    <button type="button" onClick={() => bumpQty(index, -1)}>−</button>
                    <b>{line.quantity}</b>
                    <button type="button" onClick={() => bumpQty(index, 1)}>+</button>
                  </span>
                  <span className="pos-line-total">{money(line.unitPriceCents * line.quantity)}</span>
                </div>
              )) : null}
                </div>
              ))}
            </div>
            <div className="pos-cart-foot">
              <div className="pos-sumline">
                <span>Subtotal</span>
                <span>{money(order?.subtotalCents ?? 0)}</span>
              </div>
              {order && order.discountCents > 0 ? (
                <div className="pos-sumline pos-sumline-good">
                  <span>{order.discountLabel ?? 'Discount'}</span>
                  <span>−{money(order.discountCents)}</span>
                </div>
              ) : null}
              {order && (order as Order & { manualDiscountCents?: number }).manualDiscountCents ? (
                <div className="pos-sumline pos-sumline-good">
                  <span>{(order as Order & { manualDiscountLabel?: string }).manualDiscountLabel ?? 'Discount'}</span>
                  <span>−{money((order as Order & { manualDiscountCents?: number }).manualDiscountCents ?? 0)}</span>
                </div>
              ) : null}
              {order && order.surchargeCents > 0 ? (
                <div className="pos-sumline">
                  <span>{order.surchargeLabel ?? 'Surcharge'}</span>
                  <span>+{money(order.surchargeCents)}</span>
                </div>
              ) : null}
              {order && paidCents(order) > 0 ? (
                <div className="pos-sumline pos-sumline-good">
                  <span>Paid so far</span>
                  <span>−{money(paidCents(order))}</span>
                </div>
              ) : null}
              <div className="pos-totals">
                <span>{order && paidCents(order) > 0 ? 'Balance' : 'Total'} (incl. GST {money(order?.gstCents ?? 0)})</span>
                <strong>{money(balance)}</strong>
              </div>
              <div className="pos-cart-actions">
                <button
                  type="button"
                  className="pos-ghost"
                  disabled={busy || !order || order.lines.length === 0}
                  onClick={() => setDiscounting({ mode: 'percent', value: '10', reason: '' })}
                >
                  Disc.
                </button>
                <button
                  type="button"
                  className="pos-ghost"
                  disabled={busy || !order || order.lines.length === 0 || paidCents(order) > 0}
                  onClick={() => setVoidConfirm(true)}
                >
                  Void
                </button>
                <button
                  type="button"
                  className="pos-charge"
                  disabled={!order || order.lines.length === 0 || busy || balance <= 0}
                  onClick={() => setCharge({ stage: 'tip', tipCents: 0, amountCents: null })}
                >
                  Charge {money(balance)}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {newTable ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>New table</h2>
            <input
              className="pos-tender"
              placeholder="Table (e.g. 12, Bar 2)"
              value={newTable.label}
              onChange={(event) => setNewTable({ ...newTable, label: event.currentTarget.value })}
            />
            <input
              className="pos-tender"
              inputMode="numeric"
              placeholder="Covers (optional)"
              value={newTable.covers}
              onChange={(event) => setNewTable({ ...newTable, covers: event.currentTarget.value })}
            />
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !newTable.label.trim()}
              onClick={() =>
                void openOrder({
                  tableLabel: newTable.label.trim(),
                  covers: newTable.covers.trim() ? Number(newTable.covers) : undefined
                })
              }
            >
              Open table
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setNewTable(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {charge && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            {charge.stage === 'tip' ? (
              <>
                <h2>Add a tip?</h2>
                <div className="pos-choice-row">
                  {[0, 5, 10].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setCharge({ stage: 'split', tipCents: Math.round((balance * pct) / 100), amountCents: null })}
                    >
                      {pct === 0 ? 'No tip' : `+${pct}% (${money(Math.round((balance * pct) / 100))})`}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {charge.stage === 'split' ? (
              <>
                <h2>{money(balance + charge.tipCents)}</h2>
                {charge.tipCents > 0 ? <p className="pos-muted">includes {money(charge.tipCents)} tip on this payment</p> : null}
                <div className="pos-choice-row">
                  <button type="button" onClick={() => setCharge({ ...charge, stage: 'method', amountCents: null })}>
                    Pay in full
                  </button>
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCharge({ ...charge, stage: 'method', amountCents: Math.ceil(balance / n) })}
                    >
                      Split ÷{n} ({money(Math.ceil(balance / n))})
                    </button>
                  ))}
                </div>
                <input
                  className="pos-tender"
                  inputMode="decimal"
                  placeholder="Or split by % (e.g. 30)"
                  onChange={(event) => {
                    const pct = Number(event.currentTarget.value || '0');
                    const cents = pct > 0 && pct <= 100 ? Math.ceil((balance * pct) / 100) : 0;
                    setCharge({ ...charge, amountCents: cents > 0 ? Math.min(cents, balance) : null });
                  }}
                />
                <input
                  className="pos-tender"
                  inputMode="decimal"
                  placeholder="Or custom $ amount"
                  value={charge.amountCents === null ? '' : String(charge.amountCents / 100)}
                  onChange={(event) => {
                    const cents = Math.round(Number(event.currentTarget.value || '0') * 100);
                    setCharge({ ...charge, amountCents: cents > 0 ? Math.min(cents, balance) : null });
                  }}
                />
                {charge.amountCents !== null ? (
                  <button type="button" className="pos-charge" onClick={() => setCharge({ ...charge, stage: 'method' })}>
                    Take {money(charge.amountCents + charge.tipCents)}
                  </button>
                ) : null}
              </>
            ) : null}
            {charge.stage === 'method' ? (
              <>
                <h2>{money((charge.amountCents ?? balance) + charge.tipCents)}</h2>
                <div className="pos-choice-row">
                  <button type="button" disabled={busy} onClick={() => void takePayment('CARD_EXTERNAL')}>
                    Card (EFTPOS)
                  </button>
                  {reader ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void payWithTerminal(charge.amountCents ?? balance, charge.tipCents)}
                    >
                      Card ({reader.label ?? 'reader'})
                    </button>
                  ) : (
                    <button type="button" disabled={busy || readerBusy !== null} onClick={() => void connectReader(true)}>
                      {readerBusy ?? 'Pair reader (test)'}
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => setCharge({ ...charge, stage: 'cash' })}>
                    Cash
                  </button>
                  {!order.id.startsWith('local-') ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setGift({ code: '', balanceCents: null, checking: false });
                        setCharge({ ...charge, stage: 'gift' });
                      }}
                    >
                      Gift card
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            {charge.stage === 'gift' && order ? (
              <>
                <h2>Gift card — {money((charge.amountCents ?? balance) + charge.tipCents)}</h2>
                <input
                  className="pos-tender"
                  autoFocus
                  placeholder="Card code (e.g. ALMA-XXXX-XXXX)"
                  value={gift.code}
                  onChange={(event) => setGift({ code: event.currentTarget.value.toUpperCase(), balanceCents: null, checking: false })}
                />
                {gift.balanceCents === null ? (
                  <button
                    type="button"
                    className="pos-charge"
                    disabled={busy || gift.checking || gift.code.trim().length < 4}
                    onClick={() => {
                      setGift({ ...gift, checking: true });
                      void api<{ code: string; balanceCents: number }>(`/api/pos/gift-card?code=${encodeURIComponent(gift.code.trim())}`)
                        .then((card) => setGift({ code: card.code, balanceCents: card.balanceCents, checking: false }))
                        .catch((err) => {
                          setGift({ ...gift, checking: false });
                          setError(messageForError(err, 'Could not find that gift card.'));
                        });
                    }}
                  >
                    {gift.checking ? 'Checking…' : 'Check balance'}
                  </button>
                ) : (
                  <>
                    <p className="pos-change">Balance: {money(gift.balanceCents)}</p>
                    {(() => {
                      const wanted = (charge.amountCents ?? balance) + charge.tipCents;
                      const applies = Math.min(gift.balanceCents, wanted);
                      const coversAll = applies >= wanted;
                      return (
                        <button
                          type="button"
                          className="pos-charge"
                          disabled={busy || applies <= 0}
                          onClick={() => void takeGiftPayment(applies, coversAll)}
                        >
                          Apply {money(applies)}
                          {coversAll ? '' : ` (leaves ${money(wanted - applies)} owing)`}
                        </button>
                      );
                    })()}
                  </>
                )}
              </>
            ) : null}
            {charge.stage === 'cash' ? (
              <CashPad
                dueCents={(charge.amountCents ?? balance) + charge.tipCents}
                tendered={tendered}
                setTendered={setTendered}
                busy={busy}
                onTake={() => void takePayment('CASH')}
              />
            ) : null}
            <button type="button" className="pos-ghost pos-modal-close" disabled={busy} onClick={() => { setCharge(null); setTendered(''); }}>
              Back to order
            </button>
          </div>
        </div>
      ) : null}

      {bill ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-bill">
            <div className="pos-bill-head">
              <h2>{venueIdentity.businessName}</h2>
              {venueIdentity.abn ? <p className="pos-abn">ABN {venueIdentity.abn}</p> : null}
              <p className="pos-muted">
                {bill.venue}
                <br />
                {bill.tableLabel ? `Table ${bill.tableLabel}` : `Order #${bill.orderNumber}`}
                {bill.covers ? ` · ${bill.covers} guests` : ''}
                <br />
                {new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
            <div className="pos-receipt-lines">
              {bill.lines.map((line, index) => (
                <div key={index}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{money(line.unitPriceCents * line.quantity)}</span>
                </div>
              ))}
              {bill.discountCents > 0 ? (
                <div>
                  <span>{bill.discountLabel ?? 'Discount'}</span>
                  <span>−{money(bill.discountCents)}</span>
                </div>
              ) : null}
              {bill.surchargeCents > 0 ? (
                <div>
                  <span>{bill.surchargeLabel ?? 'Surcharge'}</span>
                  <span>+{money(bill.surchargeCents)}</span>
                </div>
              ) : null}
              {paidCents(bill) > 0 ? (
                <div>
                  <span>Paid so far</span>
                  <span>−{money(paidCents(bill))}</span>
                </div>
              ) : null}
              <div className="pos-receipt-total">
                <span>Total due (incl. {money(bill.gstCents)} GST)</span>
                <span>{money(bill.totalCents - paidCents(bill))}</span>
              </div>
            </div>
            <p className="pos-muted pos-bill-foot">Thank you — pay at the counter or with your server.</p>
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => setBill(null)}>
                Close
              </button>
              <button type="button" className="pos-charge" onClick={() => window.print()}>
                Print bill
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-receipt">
            <p className="pos-receipt-brand">
              {venueIdentity.businessName}
              {venueIdentity.abn ? ` · ABN ${venueIdentity.abn}` : ''}
            </p>
            <h2>
              Paid — {receipt.tableLabel ? `Table ${receipt.tableLabel}` : `order #${receipt.orderNumber}`}
            </h2>
            {receipt.changeCents ? <p className="pos-change">Change due: {money(receipt.changeCents)}</p> : null}
            <div className="pos-receipt-lines">
              {receipt.lines.map((line, index) => (
                <div key={index}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{money(line.unitPriceCents * line.quantity)}</span>
                </div>
              ))}
              {receipt.discountCents > 0 ? (
                <div>
                  <span>{receipt.discountLabel ?? 'Discount'}</span>
                  <span>−{money(receipt.discountCents)}</span>
                </div>
              ) : null}
              {receipt.surchargeCents > 0 ? (
                <div>
                  <span>{receipt.surchargeLabel ?? 'Surcharge'}</span>
                  <span>+{money(receipt.surchargeCents)}</span>
                </div>
              ) : null}
              {receipt.payments.length > 1
                ? receipt.payments.map((payment, index) => (
                    <div key={`p-${index}`}>
                      <span>
                        {payment.method === 'CASH' ? 'Cash' : 'Card'} payment {index + 1}
                      </span>
                      <span>{money(payment.amountCents + payment.tipCents)}</span>
                    </div>
                  ))
                : null}
              <div className="pos-receipt-total">
                <span>
                  Total (incl. {money(receipt.gstCents)} GST{receipt.tipCents ? ` + ${money(receipt.tipCents)} tips` : ''})
                </span>
                <span>{money(receipt.totalCents + receipt.tipCents)}</span>
              </div>
            </div>
            {(receipt as Order & { status?: string }).status === 'PAID' && receipt.payments.length > 0 ? (
              <div className="pos-manage-row">
                <p className="pos-muted">Management — manager PIN required for each action:</p>
                {receipt.payments.map((payment, index) => (
                  <div key={(payment as { id?: string }).id ?? index} className="pos-manage-payment">
                    <span>
                      {payment.method}
                      {payment.amountCents < 0 ? ' (refund)' : ''} · {money(payment.amountCents + payment.tipCents)}
                    </span>
                    {(payment as { id?: string }).id ? (
                      <button
                        type="button"
                        className="pos-ghost"
                        onClick={() =>
                          setManagerGate({
                            message: `Undo the ${payment.method} payment of ${money(payment.amountCents + payment.tipCents)} — the bill reopens as unpaid.`,
                            pin: '',
                            retry: (pin) => {
                              void api<Order>(`/api/pos/orders/${receipt.id}/payments/${(payment as { id?: string }).id}/undo`, {
                                method: 'POST',
                                body: JSON.stringify({ managerPin: pin })
                              })
                                .then((reopened) => {
                                  setManagerGate(null);
                                  setReceipt(null);
                                  setOrder(reopened);
                                  setView('register');
                                  setInfo('Payment undone — the bill is open again.');
                                  void refreshOpenOrders();
                                })
                                .catch((err) => setError(messageForError(err, 'Could not undo the payment.')));
                            }
                          })
                        }
                      >
                        Undo
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  className="pos-ghost"
                  onClick={() => {
                    const refunded = receipt.payments.filter((payment) => payment.amountCents < 0).reduce((sum, payment) => sum - payment.amountCents, 0);
                    setReceipt(null);
                    setRefunding({ order: receipt, amount: String((receipt.totalCents + receipt.tipCents - refunded) / 100), reason: '', method: 'REFUND' });
                  }}
                >
                  Refund…
                </button>
              </div>
            ) : null}
            <div className="pos-email-row">
              <input
                className="pos-tender"
                type="email"
                placeholder="Email receipt to…"
                value={receiptEmail}
                onChange={(event) => setReceiptEmail(event.currentTarget.value)}
              />
              <button
                type="button"
                className="pos-ghost"
                disabled={!receiptEmail.includes('@') || receiptEmailStatus === 'sending'}
                onClick={() => {
                  setReceiptEmailStatus('sending');
                  void api<{ sent: boolean; status: string }>(`/api/pos/orders/${receipt.id}/email-receipt`, {
                    method: 'POST',
                    body: JSON.stringify({ to: receiptEmail })
                  })
                    .then((result) => setReceiptEmailStatus(result.sent ? 'Sent ✓' : `Not sent (${result.status})`))
                    .catch((err) => setReceiptEmailStatus(messageForError(err, 'Failed')));
                }}
              >
                {receiptEmailStatus === 'sending' ? 'Sending…' : 'Email'}
              </button>
            </div>
            {receiptEmailStatus && receiptEmailStatus !== 'sending' ? <p className="pos-muted">{receiptEmailStatus}</p> : null}
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => window.print()}>
                Print receipt
              </button>
              <button type="button" className="pos-charge" onClick={() => { setReceipt(null); setReceiptEmail(''); setReceiptEmailStatus(null); }}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bills ? (
        <div className="pos-modal" role="dialog" onClick={() => setBills(null)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2>Today's bills</h2>
            {bills.length === 0 ? <p className="pos-muted">No settled bills yet today.</p> : null}
            {bills.map((row) => {
              const refunded = row.payments.filter((payment) => payment.amountCents < 0).reduce((sum, payment) => sum - payment.amountCents, 0);
              return (
                <div key={row.id} className="pos-bill-row">
                  <span>
                    <strong>{row.tableLabel ? `Table ${row.tableLabel}` : `#${row.orderNumber}`}</strong>
                    <small className="pos-muted">
                      {' '}
                      {row.status}
                      {refunded > 0 ? ` · refunded ${money(refunded)}` : ''}
                    </small>
                  </span>
                  <span>{money(row.totalCents + row.tipCents)}</span>
                  <span className="pos-bill-actions">
                    {row.status === 'PAID' ? (
                      <>
                        <button
                          type="button"
                          className="pos-ghost"
                          onClick={() => {
                            void api<Order>(`/api/pos/orders/${row.id}/reopen`, { method: 'POST' })
                              .then((reopened) => {
                                setOrder(reopened);
                                setBills(null);
                                setView('register');
                              })
                              .catch((err) => setError(messageForError(err, 'Could not reopen.')));
                          }}
                        >
                          Reopen
                        </button>
                        <button
                          type="button"
                          className="pos-ghost"
                          onClick={() => {
                            setBills(null);
                            setRefunding({ order: row, amount: String((row.totalCents + row.tipCents - refunded) / 100), reason: '', method: 'REFUND' });
                          }}
                        >
                          Refund
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="pos-ghost"
                      onClick={() => {
                        setBills(null);
                        setReceipt(row);
                      }}
                    >
                      View
                    </button>
                  </span>
                </div>
              );
            })}
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setBills(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {refunding ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Refund {refunding.order.tableLabel ? `table ${refunding.order.tableLabel}` : `#${refunding.order.orderNumber}`}</h2>
            <input
              className="pos-tender"
              inputMode="decimal"
              placeholder="Refund amount"
              value={refunding.amount}
              onChange={(event) => setRefunding({ ...refunding, amount: event.currentTarget.value })}
            />
            <div className="pos-choice-row">
              <button
                type="button"
                className={refunding.method === 'REFUND' ? 'is-on' : ''}
                onClick={() => setRefunding({ ...refunding, method: 'REFUND' })}
              >
                Back to card
              </button>
              <button
                type="button"
                className={refunding.method === 'CASH' ? 'is-on' : ''}
                onClick={() => setRefunding({ ...refunding, method: 'CASH' })}
              >
                Cash from till
              </button>
            </div>
            <p className="pos-muted">Reason (required):</p>
            <div className="pos-reason-list">
              {(reasons.COMP ?? []).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={refunding.reason === reason ? 'is-on' : ''}
                  onClick={() => setRefunding({ ...refunding, reason })}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !refunding.reason || !refunding.amount}
              onClick={() => {
                const snapshot = refunding;
                const attempt = (pin?: string) => {
                  void api(`/api/pos/orders/${snapshot.order.id}/refund`, {
                    method: 'POST',
                    body: JSON.stringify({
                      amountCents: Math.round(Number(snapshot.amount) * 100),
                      reason: snapshot.reason,
                      method: snapshot.method,
                      staffName: operatorName || 'Unknown',
                      managerPin: pin
                    })
                  })
                    .then(() => {
                      setManagerGate(null);
                      setRefunding(null);
                      setBills(null);
                    })
                    .catch((err) => {
                      const message = messageForError(err, 'Refund failed.');
                      if (/manager/i.test(message)) setManagerGate({ message, pin: '', retry: attempt });
                      else setError(message);
                    });
                };
                attempt();
              }}
            >
              Refund {refunding.amount ? money(Math.round(Number(refunding.amount) * 100)) : ''}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setRefunding(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {merging && order ? (
        <div className="pos-modal" role="dialog" onClick={() => setMerging(null)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2>Merge into {order.tableLabel ? `table ${order.tableLabel}` : `#${order.orderNumber}`}</h2>
            {merging.length === 0 ? <p className="pos-muted">No other open bills.</p> : null}
            {merging.map((candidate) => (
              <div key={candidate.id} className="pos-bill-row">
                <span>
                  <strong>{candidate.tableLabel ? `Table ${candidate.tableLabel}` : `#${candidate.orderNumber}`}</strong>
                  <small className="pos-muted"> {candidate.lines.length} items</small>
                </span>
                <span>{money(candidate.totalCents)}</span>
                <button
                  type="button"
                  className="pos-ghost"
                  disabled={busy}
                  onClick={() => {
                    void api<Order>(`/api/pos/orders/${order.id}/merge`, {
                      method: 'POST',
                      body: JSON.stringify({ sourceOrderId: candidate.id })
                    })
                      .then((merged) => {
                        setOrder(merged);
                        setMerging(null);
                        void refreshOpenOrders();
                      })
                      .catch((err) => setError(messageForError(err, 'Merge failed.')));
                  }}
                >
                  Merge in
                </button>
              </div>
            ))}
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setMerging(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {guestView ? (
        <div className="pos-modal" role="dialog" onClick={() => setGuestView(null)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2>
              {guestView.firstName} {guestView.lastName}
            </h2>
            <div className="pos-day-grid">
              <div>
                <small>Visits</small>
                <strong>{guestView.totalVisits}</strong>
              </div>
              <div>
                <small>Lifetime spend</small>
                <strong>{money(guestView.totalSpendCents)}</strong>
              </div>
            </div>
            {guestView.tags.length ? <p className="pos-muted">Tags: {guestView.tags.join(', ')}</p> : null}
            {guestView.allergyNotes ? <p className="pos-error-inline">⚠ Allergies: {guestView.allergyNotes}</p> : null}
            {guestView.dietaryNotes ? <p className="pos-muted">Dietary: {guestView.dietaryNotes}</p> : null}
            {guestView.favourites.length ? (
              <>
                <p className="pos-muted">Favourites:</p>
                {guestView.favourites.map((favourite) => (
                  <div key={favourite.name} className="pos-day-item">
                    <span>
                      {favourite.quantity}× {favourite.name}
                    </span>
                    <span>{money(favourite.totalCents)}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="pos-muted">No POS history yet — favourites build as they order.</p>
            )}
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setGuestView(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {coversOpen && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Covers on {order.tableLabel ? `table ${order.tableLabel}` : 'this sale'}</h2>
            <div className="pos-choice-row">
              <button type="button" onClick={() => setCoversEdit(String(Math.max(1, (Number(coversEdit) || 1) - 1)))}>
                −
              </button>
              <input
                className="pos-tender"
                style={{ flex: 1, textAlign: 'center' }}
                inputMode="numeric"
                value={coversEdit}
                onChange={(event) => setCoversEdit(event.currentTarget.value)}
              />
              <button type="button" onClick={() => setCoversEdit(String((Number(coversEdit) || 0) + 1))}>
                +
              </button>
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={busy}
              onClick={() => {
                void api<Order>(`/api/pos/orders/${order.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ covers: coversEdit === '' ? null : Number(coversEdit) })
                })
                  .then((updated) => {
                    setOrder(updated);
                    setCoversOpen(false);
                  })
                  .catch((err) => setError(messageForError(err, 'Could not update covers.')));
              }}
            >
              Save covers
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setCoversOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {openFolder && openFolder.t === 'f' ? (
        <div className="pos-modal" role="dialog" onClick={() => setOpenFolder(null)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2 style={openFolder.c ? { color: HUE_DOTS[openFolder.c] ?? openFolder.c } : undefined}>📁 {openFolder.name}</h2>
            <div className="pos-reason-list">
              {openFolder.items.map((recipeId) => {
                const item = menu.flatMap((category) => category.items).find((candidate) => candidate.recipeId === recipeId);
                if (!item) return null;
                return (
                  <button
                    key={recipeId}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setView('register');
                      addItem(item);
                    }}
                  >
                    {item.title} · {money(item.priceCents)}
                  </button>
                );
              })}
            </div>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setOpenFolder(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {folderDraft ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>New folder</h2>
            <input
              className="pos-tender"
              placeholder="Folder name (e.g. Happy hour, Kids)"
              value={folderDraft.name}
              onChange={(event) => setFolderDraft({ ...folderDraft, name: event.currentTarget.value })}
            />
            <div className="pos-reason-list">
              {['#4f8f6b', '#7f9ac4', '#d9a05a', '#c4655a', '#a98ac4', '#9aa4ab'].map((colour) => (
                <button
                  key={colour}
                  type="button"
                  className={folderDraft.c === colour ? 'is-on' : ''}
                  style={{ background: colour, borderColor: colour, minWidth: 44 }}
                  onClick={() => setFolderDraft({ ...folderDraft, c: colour })}
                >
                  {' '}
                </button>
              ))}
            </div>
            <input
              className="pos-tender"
              placeholder="Search items to add…"
              value={folderDraft.search}
              onChange={(event) => setFolderDraft({ ...folderDraft, search: event.currentTarget.value })}
            />
            <div className="pos-reason-list">
              {menu
                .flatMap((category) => category.items)
                .filter((item) => !folderDraft.search || item.title.toLowerCase().includes(folderDraft.search.toLowerCase()))
                .slice(0, 10)
                .map((item) => (
                  <button
                    key={item.recipeId}
                    type="button"
                    className={folderDraft.items.includes(item.recipeId) ? 'is-on' : ''}
                    onClick={() =>
                      setFolderDraft({
                        ...folderDraft,
                        items: folderDraft.items.includes(item.recipeId)
                          ? folderDraft.items.filter((candidate) => candidate !== item.recipeId)
                          : [...folderDraft.items, item.recipeId]
                      })
                    }
                  >
                    {item.title}
                  </button>
                ))}
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={!folderDraft.name.trim() || folderDraft.items.length === 0}
              onClick={() => {
                const next = {
                  ...home,
                  pins: [...home.pins, { t: 'f' as const, name: folderDraft.name.trim(), c: folderDraft.c, items: folderDraft.items }]
                };
                setHome(next);
                setFolderDraft(null);
                void api('/api/pos/homescreen', {
                  method: 'PUT',
                  body: JSON.stringify({ userKey, buttons: next.buttons, pins: next.pins, updatedBy: operatorName })
                }).catch(() => undefined);
              }}
            >
              Create folder ({folderDraft.items.length} items)
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setFolderDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {modSheet ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{modSheet.item.title}</h2>
            {modSheet.groups.map((group) => (
              <div key={group.id}>
                <p className="pos-muted">
                  {group.name}
                  {group.required ? ' (required)' : ''} — up to {group.maxSelect}
                </p>
                <div className="pos-reason-list">
                  {group.options.map((option) => {
                    const chosen = modSheet.chosen[group.id] ?? [];
                    const on = chosen.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={on ? 'is-on' : ''}
                        onClick={() => {
                          const next = on
                            ? chosen.filter((candidate) => candidate !== option.id)
                            : chosen.length >= group.maxSelect
                              ? chosen
                              : [...chosen, option.id];
                          setModSheet({ ...modSheet, chosen: { ...modSheet.chosen, [group.id]: next } });
                        }}
                      >
                        {option.name}
                        {option.priceCents ? ` +${money(option.priceCents)}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <input
              className="pos-tender"
              placeholder="Notes for the kitchen (optional)"
              value={modSheet.notes}
              onChange={(event) => setModSheet({ ...modSheet, notes: event.currentTarget.value })}
            />
            <button
              type="button"
              className="pos-charge"
              disabled={busy || modSheet.groups.some((group) => group.required && (modSheet.chosen[group.id] ?? []).length === 0)}
              onClick={() => {
                const modifiers = modSheet.groups.flatMap((group) =>
                  (modSheet.chosen[group.id] ?? []).map((optionId) => {
                    const option = group.options.find((candidate) => candidate.id === optionId)!;
                    return { name: option.name, priceCents: option.priceCents };
                  })
                );
                void addItemDirect(modSheet.item, modifiers, modSheet.notes.trim());
                setModSheet(null);
              }}
            >
              Add {modSheet.item.title}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setModSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {fireSheet && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Fire courses</h2>
            <p className="pos-muted">Held items only print when their course is fired.</p>
            <div className="pos-reason-list">
              {fireSheet.map((entry, index) => (
                <button
                  key={entry.course}
                  type="button"
                  className={entry.picked ? 'is-on' : ''}
                  onClick={() =>
                    setFireSheet(fireSheet.map((candidate, i) => (i === index ? { ...candidate, picked: !candidate.picked } : candidate)))
                  }
                >
                  {entry.course} ({entry.count})
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !fireSheet.some((entry) => entry.picked)}
              onClick={() => {
                const picked = fireSheet.filter((entry) => entry.picked).map((entry) => entry.course);
                void api<{ dockets: Docket[]; sent: number }>(`/api/pos/orders/${order.id}/send`, {
                  method: 'POST',
                  body: JSON.stringify({ courses: picked })
                })
                  .then(async (result) => {
                    setFireSheet(null);
                    if (result.dockets.length > 0) {
                  setAutoPrint(true);
                  setDockets(result.dockets);
                }
                    setOrder(await api<Order>(`/api/pos/orders/${order.id}`));
                  })
                  .catch((err) => setError(messageForError(err, 'Could not fire the courses.')));
              }}
            >
              Fire {fireSheet.filter((entry) => entry.picked).map((entry) => entry.course).join(' + ') || '…'}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setFireSheet(null)}>
              Hold everything
            </button>
          </div>
        </div>
      ) : null}

      {wastage ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Record wastage</h2>
            <input
              className="pos-tender"
              placeholder="Search item…"
              value={wastage.search}
              onChange={(event) => setWastage({ ...wastage, search: event.currentTarget.value, recipeId: '', itemName: '' })}
            />
            {wastage.search && !wastage.recipeId ? (
              <div className="pos-reason-list">
                {menu
                  .flatMap((category) => category.items)
                  .filter((item) => item.title.toLowerCase().includes(wastage.search.toLowerCase()))
                  .slice(0, 6)
                  .map((item) => (
                    <button
                      key={item.recipeId}
                      type="button"
                      onClick={() => setWastage({ ...wastage, recipeId: item.recipeId, itemName: item.title, search: item.title })}
                    >
                      {item.title}
                    </button>
                  ))}
              </div>
            ) : null}
            <input
              className="pos-tender"
              inputMode="numeric"
              placeholder="Quantity"
              value={wastage.quantity}
              onChange={(event) => setWastage({ ...wastage, quantity: event.currentTarget.value })}
            />
            <div className="pos-reason-list">
              {(reasons.WASTAGE ?? []).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={wastage.reason === reason ? 'is-on' : ''}
                  onClick={() => setWastage({ ...wastage, reason })}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !wastage.itemName || !wastage.reason}
              onClick={() => {
                void api('/api/pos/wastage', {
                  method: 'POST',
                  body: JSON.stringify({
                    venue,
                    recipeId: wastage.recipeId || undefined,
                    itemName: wastage.itemName,
                    quantity: Number(wastage.quantity) || 1,
                    reason: wastage.reason,
                    staffName: operatorName || 'Unknown'
                  })
                })
                  .then(() => setWastage(null))
                  .catch((err) => setError(messageForError(err, 'Could not record wastage.')));
              }}
            >
              Record wastage
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setWastage(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {lineAction && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{lineAction.name}</h2>
            <div className="pos-choice-row">
              <button
                type="button"
                className={lineAction.kind === 'COMP' ? 'is-on' : ''}
                onClick={() => setLineAction({ ...lineAction, kind: 'COMP', reason: '' })}
              >
                Comp (free)
              </button>
              <button
                type="button"
                className={lineAction.kind === 'PRICE_CHANGE' ? 'is-on' : ''}
                onClick={() => setLineAction({ ...lineAction, kind: 'PRICE_CHANGE', reason: '' })}
              >
                Change price
              </button>
            </div>
            {lineAction.kind === 'PRICE_CHANGE' ? (
              <input
                className="pos-tender"
                inputMode="decimal"
                placeholder="New price each"
                value={lineAction.price}
                onChange={(event) => setLineAction({ ...lineAction, price: event.currentTarget.value })}
              />
            ) : null}
            <p className="pos-muted">Reason (required):</p>
            <div className="pos-reason-list">
              {(reasons[lineAction.kind] ?? []).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={lineAction.reason === reason ? 'is-on' : ''}
                  onClick={() => setLineAction({ ...lineAction, reason })}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !lineAction.reason || (lineAction.kind === 'PRICE_CHANGE' && !lineAction.price)}
              onClick={() => {
                void api<Order>(`/api/pos/orders/${order.id}/lines/${lineAction.lineId}/adjust`, {
                  method: 'POST',
                  body: JSON.stringify({
                    kind: lineAction.kind,
                    reason: lineAction.reason,
                    staffName: operatorName || 'Unknown',
                    unitPriceCents:
                      lineAction.kind === 'PRICE_CHANGE' ? Math.round(Number(lineAction.price) * 100) : undefined
                  })
                })
                  .then((updated) => {
                    setOrder(updated);
                    setLineAction(null);
                  })
                  .catch((err) => setError(messageForError(err, 'Could not adjust the line.')));
              }}
            >
              {lineAction.kind === 'COMP' ? 'Comp it' : 'Set price'}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setLineAction(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {discounting && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Discount the order</h2>
            <div className="pos-choice-row">
              {['5', '10', '20'].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={discounting.mode === 'percent' && discounting.value === pct ? 'is-on' : ''}
                  onClick={() => setDiscounting({ ...discounting, mode: 'percent', value: pct })}
                >
                  {pct}%
                </button>
              ))}
            </div>
            <input
              className="pos-tender"
              inputMode="decimal"
              placeholder="Or custom %"
              value={discounting.mode === 'percent' && !['5', '10', '20'].includes(discounting.value) ? discounting.value : ''}
              onChange={(event) => setDiscounting({ ...discounting, mode: 'percent', value: event.currentTarget.value })}
            />
            <input
              className="pos-tender"
              inputMode="decimal"
              placeholder="Or fixed $ amount"
              value={discounting.mode === 'amount' ? discounting.value : ''}
              onChange={(event) => setDiscounting({ ...discounting, mode: 'amount', value: event.currentTarget.value })}
            />
            <p className="pos-muted">Reason (required):</p>
            <div className="pos-reason-list">
              {(reasons.DISCOUNT ?? []).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={discounting.reason === reason ? 'is-on' : ''}
                  onClick={() => setDiscounting({ ...discounting, reason })}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !discounting.reason || !discounting.value}
              onClick={() => {
                void api<Order>(`/api/pos/orders/${order.id}/discount`, {
                  method: 'POST',
                  body: JSON.stringify({
                    percent: discounting.mode === 'percent' ? Number(discounting.value) : undefined,
                    amountCents: discounting.mode === 'amount' ? Math.round(Number(discounting.value) * 100) : undefined,
                    reason: discounting.reason,
                    staffName: operatorName || 'Unknown'
                  })
                })
                  .then((updated) => {
                    setOrder(updated);
                    setDiscounting(null);
                  })
                  .catch((err) => setError(messageForError(err, 'Could not apply the discount.')));
              }}
            >
              Apply discount
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setDiscounting(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {lockScreen ? (
        <div className="pos-modal pos-lock" role="dialog">
          <div className="pos-modal-panel">
            <img src="/brand/alma-a-mark.png" alt="" className="pos-mark" />
            <h2>Register locked</h2>
            <p className="pos-muted">Idle for 30 seconds — the bill is saved. Enter your staff code to keep going.</p>
            <input
              className="pos-tender"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Staff code"
              value={lockPin}
              onChange={(event) => setLockPin(event.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && lockPin.length >= 4) void unlockWithPin(lockPin);
              }}
            />
            <button type="button" className="pos-charge" disabled={busy || lockPin.length < 4} onClick={() => void unlockWithPin(lockPin)}>
              Unlock
            </button>
          </div>
        </div>
      ) : null}
      {voidConfirm && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Void this bill?</h2>
            <p className="pos-muted">
              {order.lines.reduce((sum, line) => sum + line.quantity, 0)} item
              {order.lines.reduce((sum, line) => sum + line.quantity, 0) === 1 ? '' : 's'} · {money(order.totalCents)}
              {order.tableLabel ? ` · Table ${order.tableLabel}` : ''} — the whole bill is cancelled and the kitchen is
              not told automatically.
            </p>
            <button
              type="button"
              className="pos-charge pos-void-confirm"
              disabled={busy}
              onClick={() => {
                setVoidConfirm(false);
                if (!order) return;
                const orderId = order.id;
                const attempt = (pin?: string) => {
                  void api(`/api/pos/orders/${orderId}/void`, { method: 'POST', body: JSON.stringify({ reason: 'register', managerPin: pin }) })
                    .then(() => {
                      setManagerGate(null);
                      setOrder(null);
                      void refreshOpenOrders();
                      setInfo('Bill voided.');
                    })
                    .catch((err) => {
                      const message = messageForError(err, 'Could not void.');
                      if (/manager/i.test(message)) setManagerGate({ message, pin: '', retry: attempt });
                      else setError(message);
                    });
                };
                attempt();
              }}
            >
              Void the bill
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setVoidConfirm(false)}>
              Keep the bill
            </button>
          </div>
        </div>
      ) : null}
      {variantSheet ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{variantSheet.title}</h2>
            <p className="pos-muted">Which pour?</p>
            <div className="pos-variant-list">
              {(variantSheet.variants ?? []).map((option) => (
                <button
                  key={option.recipeId}
                  type="button"
                  className={eightySix.has(option.recipeId) ? 'is-86d' : ''}
                  onClick={() => {
                    setVariantSheet(null);
                    addItem({ recipeId: option.recipeId, title: option.title, priceCents: option.priceCents, venue: option.venue });
                  }}
                >
                  <span>{option.label}</span>
                  <b>{money(option.priceCents)}</b>
                </button>
              ))}
            </div>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setVariantSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {groupSheet ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>📁 {groupSheet.name}</h2>
            <input
              key={groupSheet.name}
              className="pos-tender"
              defaultValue={groupSheet.name}
              maxLength={30}
              onBlur={(event) => renameGroupFromSheet(groupSheet.name, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') renameGroupFromSheet(groupSheet.name, event.currentTarget.value);
              }}
            />
            {(() => {
              const cats = tabsConfig.groups.find((group) => group.name === groupSheet.name)?.cats ?? [];
              return cats.length > 0 ? (
                <>
                  <p className="pos-muted">Tap a category to move it back onto the bar:</p>
                  <div className="pos-group-chips">
                    {cats.map((cat) => (
                      <button key={cat} type="button" onClick={() => releaseFromGroup(groupSheet.name, cat)}>
                        {cat} ⤴
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="pos-muted">This folder is empty — drag categories onto it, or remove it below.</p>
              );
            })()}
            <button
              type="button"
              className="pos-ghost pos-danger-ghost"
              onClick={() => {
                dissolveGroup(groupSheet.name);
                setGroupSheet(null);
              }}
            >
              Remove folder (categories go back on the bar)
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setGroupSheet(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
      {managerGate ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Manager approval</h2>
            <p className="pos-muted">{managerGate.message}</p>
            <input
              className="pos-tender"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Manager PIN"
              value={managerGate.pin}
              onChange={(event) => setManagerGate({ ...managerGate, pin: event.currentTarget.value })}
            />
            <button
              type="button"
              className="pos-charge"
              disabled={busy || managerGate.pin.length < 4}
              onClick={() => managerGate.retry(managerGate.pin)}
            >
              Approve
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setManagerGate(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {customise ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Customise {operatorName ? `${operatorName}'s` : 'this'} homescreen</h2>
            <details className="pos-acc">
              <summary>
                Management buttons <small>{home.buttons.length ? home.buttons.join(', ') : 'none'}</small>
              </summary>
              <div className="pos-acc-body">
                {['open-till', 'discount', 'comp', 'wastage', 'price'].map((key) => (
                  <label key={key} className="pos-check-row">
                    <input
                      type="checkbox"
                      checked={home.buttons.includes(key)}
                      onChange={() =>
                        setHome({
                          ...home,
                          buttons: home.buttons.includes(key)
                            ? home.buttons.filter((candidate) => candidate !== key)
                            : [...home.buttons, key]
                        })
                      }
                    />
                    {key}
                  </label>
                ))}
              </div>
            </details>
            <details className="pos-acc">
              <summary>
                Open the register on <small>{home.landingCategory ?? HOME_TAB}</small>
              </summary>
              <div className="pos-acc-body">
                {[HOME_TAB, ...menu.slice(0, 11).map((category) => category.name)].map((name) => (
                  <label key={name} className="pos-check-row">
                    <input
                      type="checkbox"
                      checked={home.landingCategory === name || (!home.landingCategory && name === HOME_TAB)}
                      onChange={() => setHome({ ...home, landingCategory: home.landingCategory === name ? null : name })}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </details>
            <details className="pos-acc">
              <summary>
                Pins &amp; folders <small>{home.pins.length} pinned</small>
              </summary>
              <div className="pos-acc-body">
                <div className="pos-reason-list">
                  {home.pins.map((pin, index) => {
                    const label = pin.t === 'f' ? `📁 ${pin.name}` : menu.flatMap((category) => category.items).find((candidate) => candidate.recipeId === pin.id)?.title ?? '?';
                    return (
                      <span key={index} className="pos-pin-edit">
                        <button type="button" style={pin.c && !HUE_NAMES.includes(pin.c) ? { borderColor: pin.c, color: pin.c } : pin.c ? { borderColor: HUE_DOTS[pin.c], color: HUE_DOTS[pin.c] } : undefined}>
                          {label}
                        </button>
                        <span className="pos-swatches">
                          {BRIGHT_PALETTE.map((colour) => (
                            <button
                              key={colour || 'none'}
                              type="button"
                              className={`pos-swatch ${(pin.c ?? '') === colour ? 'is-on' : ''}`}
                              style={colour ? { background: HUE_DOTS[colour] ?? colour } : undefined}
                              title={colour || 'No colour'}
                              onClick={() =>
                                setHome({
                                  ...home,
                                  pins: home.pins.map((candidate, i) => (i === index ? { ...candidate, c: colour || undefined } : candidate))
                                })
                              }
                            >
                              {colour ? '' : '∅'}
                            </button>
                          ))}
                        </span>
                        <span className="pos-dstyle">
                          {(
                            [
                              ['', 'Aa'],
                              ['sh', 'AB'],
                              ['hs', 'A a'],
                              ['big', 'A']
                            ] as const
                          ).map(([mode, tag]) => (
                            <button
                              key={mode || 'std'}
                              type="button"
                              className={(pin.d ?? '') === mode ? 'is-on' : ''}
                              title={mode === 'sh' ? 'Short abbreviation' : mode === 'hs' ? 'Heading + subheading' : mode === 'big' ? 'Big title' : 'Standard'}
                              onClick={() =>
                                setHome({
                                  ...home,
                                  pins: home.pins.map((candidate, i) => (i === index ? { ...candidate, d: (mode || undefined) as Pin['d'] } : candidate))
                                })
                              }
                            >
                              {tag}
                            </button>
                          ))}
                        </span>
                        <button type="button" onClick={() => setHome({ ...home, pins: home.pins.filter((_, i) => i !== index) })}>
                          ✕
                        </button>
                      </span>
                    );
                  })}
                  <button type="button" onClick={() => setFolderDraft({ name: '', c: '#4f8f6b', items: [], search: '' })}>
                    + New folder
                  </button>
                </div>
              </div>
            </details>
            <details className="pos-acc">
              <summary>Add item pins</summary>
              <div className="pos-acc-body">
                <input
                  className="pos-tender"
                  placeholder="Search items to pin…"
                  value={pinSearch}
                  onChange={(event) => setPinSearch(event.currentTarget.value)}
                />
                <div className="pos-reason-list">
                  {menu
                    .flatMap((category) => category.items)
                    .filter((item) => !pinSearch || item.title.toLowerCase().includes(pinSearch.toLowerCase()))
                    .filter((item) => !home.pins.some((pin) => pin.t === 'i' && pin.id === item.recipeId))
                    .slice(0, 14)
                    .map((item) => (
                      <button
                        key={item.recipeId}
                        type="button"
                        onClick={() => setHome({ ...home, pins: [...home.pins, { t: 'i', id: item.recipeId }] })}
                      >
                        + {item.title}
                      </button>
                    ))}
                </div>
              </div>
            </details>
            <details className="pos-acc">
              <summary>
                This device opens on <small>{deviceLanding || 'user default'}</small>
              </summary>
              <div className="pos-acc-body">
                {[HOME_TAB, ...menu.slice(0, 11).map((category) => category.name)].map((name) => (
                  <label key={name} className="pos-check-row">
                    <input
                      type="checkbox"
                      checked={deviceLanding === name}
                      onChange={() => {
                        const next = deviceLanding === name ? '' : name;
                        setDeviceLanding(next);
                        if (next) localStorage.setItem('alma.pos.deviceLanding', next);
                        else localStorage.removeItem('alma.pos.deviceLanding');
                      }}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </details>
            <details className="pos-acc">
              <summary>
                Design <small>{design === 'rail' ? 'Sidebar list' : 'Classic tiles'}</small>
              </summary>
              <div className="pos-acc-body">
                {(
                  [
                    ['classic', 'Classic tiles'],
                    ['rail', 'Sidebar list']
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="pos-check-row">
                    <input type="checkbox" checked={design === key} onChange={() => setDesign(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </details>
            <details className="pos-acc">
              <summary>
                Training <small>{training ? 'ON' : 'off'}</small>
              </summary>
              <div className="pos-acc-body">
                <label className="pos-check-row">
                  <input
                    type="checkbox"
                    checked={training}
                    onChange={() => {
                      const next = !training;
                      setTraining(next);
                      localStorage.setItem('alma.pos.training', next ? '1' : '0');
                    }}
                  />
                  Training mode — practice sales that never post
                </label>
              </div>
            </details>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !userKey}
              onClick={() => {
                void api('/api/pos/homescreen', {
                  method: 'PUT',
                  body: JSON.stringify({ userKey, buttons: home.buttons, pins: home.pins, landingCategory: home.landingCategory ?? '', updatedBy: operatorName })
                })
                  .then(() => setCustomise(false))
                  .catch((err) => setError(messageForError(err, 'Could not save.')));
              }}
            >
              Save homescreen
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setCustomise(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {dockets ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-docket">
            {dockets.map((docket, index) => (
              <div key={index} className="pos-docket">
                <div className="pos-docket-head">
                  <h2>{docket.profile}</h2>
                  <p className="pos-muted">
                    {docket.tableLabel ? `Table ${docket.tableLabel}` : `Order #${docket.orderNumber}`}
                    {docket.covers ? ` · ${docket.covers} covers` : ''}
                    {docket.openedByName ? ` · ${docket.openedByName}` : ''}
                  </p>
                </div>
                {(() => {
                  // Courses print as proper ruled sub-headings with their
                  // items listed beneath, in service order.
                  const grouped = new Map<string, typeof docket.lines>();
                  for (const line of docket.lines) {
                    const key = line.course ?? 'NOW';
                    grouped.set(key, [...(grouped.get(key) ?? []), line]);
                  }
                  const rank = (name: string) => {
                    const at = courses.indexOf(name);
                    return at === -1 ? 99 : at;
                  };
                  return [...grouped.entries()]
                    .sort((a, b) => rank(a[0]) - rank(b[0]))
                    .map(([courseName, courseLines]) => (
                      <div key={courseName} className="pos-docket-courseblock">
                        <div className="pos-docket-courserule">
                          <span>{courseName}</span>
                        </div>
                        {courseLines.map((line) => (
                          <div key={line.id} className="pos-docket-line">
                            <strong>
                              {line.quantity}× {line.name}
                              {(line as { seat?: number | null }).seat ? ` · S${(line as { seat?: number | null }).seat}` : ''}
                            </strong>
                            {((line as { modifiers?: Array<{ name: string }> }).modifiers ?? []).length || line.notes ? (
                              <small>
                                {((line as { modifiers?: Array<{ name: string }> }).modifiers ?? []).map((modifier) => modifier.name).join(', ')}
                                {line.notes ? `${((line as { modifiers?: Array<{ name: string }> }).modifiers ?? []).length ? ' — ' : ''}${line.notes}` : ''}
                              </small>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ));
                })()}
              </div>
            ))}
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => window.print()}>
                Print dockets
              </button>
              <button type="button" className="pos-charge" onClick={() => setDockets(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {closing ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-close">
            {closing.stage === 'checklist' ? (
              <>
                <h2>Close of day — {venue}</h2>
                <div className="pos-checklist">
                  <div className={closing.gate && closing.gate.openBills === 0 ? 'is-ok' : 'is-block'}>
                    {closing.gate?.openBills === 0 ? '✓' : '✕'} All bills closed
                    {closing.gate && closing.gate.openBills > 0 ? ` — ${closing.gate.openBills} still open` : ''}
                  </div>
                  <div className={closing.drawer?.drawer ? 'is-block' : 'is-ok'}>
                    {closing.drawer?.drawer ? '✕ Cash drawer open — count it below' : '✓ Cash drawer closed'}
                  </div>
                  {closing.gate?.alreadyClosed ? <div className="is-block">✕ Already closed today</div> : null}
                </div>

                {!closing.drawer?.drawer ? (
                  <div className="pos-drawer-open">
                    <p className="pos-muted">No drawer open. Start one with an opening float:</p>
                    <input
                      className="pos-tender"
                      inputMode="decimal"
                      placeholder="Opening float (e.g. 300)"
                      value={closing.float}
                      onChange={(event) => setClosing({ ...closing, float: event.currentTarget.value })}
                    />
                    <button
                      type="button"
                      className="pos-ghost"
                      disabled={busy || !closing.float}
                      onClick={() => {
                        void api<DrawerInfo['drawer']>('/api/pos/drawer/open', {
                          method: 'POST',
                          body: JSON.stringify({
                            venue,
                            openingFloatCents: Math.round(Number(closing.float) * 100),
                            openedByName: operatorName
                          })
                        })
                          .then(async () => {
                            const drawer = await api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`);
                            setClosing({ ...closing, drawer, float: '' });
                          })
                          .catch((err) => setError(messageForError(err, 'Could not open the drawer.')));
                      }}
                    >
                      Open drawer
                    </button>
                  </div>
                ) : (
                  <button type="button" className="pos-ghost" onClick={() => setClosing({ ...closing, stage: 'count' })}>
                    Count &amp; close drawer → (expecting {money(closing.drawer.expectedCents ?? 0)})
                  </button>
                )}

                <button
                  type="button"
                  className="pos-charge"
                  disabled={busy || !closing.gate?.ready}
                  onClick={() => {
                    void api<NonNullable<typeof closing.report>>('/api/pos/close-day', {
                      method: 'POST',
                      body: JSON.stringify({ venue, closedByName: operatorName })
                    })
                      .then((report) => setClosing({ ...closing, stage: 'report', report }))
                      .catch((err) => setError(messageForError(err, 'Close of day failed.')));
                  }}
                >
                  Run close of day
                </button>
              </>
            ) : null}

            {closing.stage === 'count' && closing.drawer?.drawer ? (
              <>
                <h2>Count the till</h2>
                <p className="pos-muted">
                  Float {money(closing.drawer.drawer.openingFloatCents)} · expecting {money(closing.drawer.expectedCents ?? 0)}
                </p>
                <div className="pos-denoms">
                  {DENOMS.map((denomination) => (
                    <label key={denomination}>
                      <span>{denomination >= 500 ? `$${denomination / 100}` : `${denomination}c`}</span>
                      <input
                        inputMode="numeric"
                        placeholder="0"
                        value={closing.counts[denomination] ?? ''}
                        onChange={(event) =>
                          setClosing({
                            ...closing,
                            counts: { ...closing.counts, [denomination]: event.currentTarget.value }
                          })
                        }
                      />
                      <small>
                        {money(denomination * (Number(closing.counts[denomination] ?? '0') || 0))}
                      </small>
                    </label>
                  ))}
                </div>
                {(() => {
                  const counted = DENOMS.reduce(
                    (sum, denomination) => sum + denomination * (Number(closing.counts[denomination] ?? '0') || 0),
                    0
                  );
                  const expected = closing.drawer?.expectedCents ?? 0;
                  const variance = counted - expected;
                  return (
                    <div className="pos-count-summary">
                      <div>
                        <span>Counted</span>
                        <strong>{money(counted)}</strong>
                      </div>
                      <div>
                        <span>Expected</span>
                        <strong>{money(expected)}</strong>
                      </div>
                      <div className={variance === 0 ? '' : variance > 0 ? 'is-over' : 'is-short'}>
                        <span>{variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'}</span>
                        <strong>{money(Math.abs(variance))}</strong>
                      </div>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  className="pos-charge"
                  disabled={busy}
                  onClick={() => {
                    const denominations = Object.fromEntries(
                      DENOMS.map((denomination) => [denomination, Number(closing.counts[denomination] ?? '0') || 0])
                    );
                    void api('/api/pos/drawer/close', {
                      method: 'POST',
                      body: JSON.stringify({ venue, denominations, closedByName: operatorName })
                    })
                      .then(async () => {
                        const [gate, drawer] = await Promise.all([
                          api<CloseGate>(`/api/pos/close-day?venue=${encodeURIComponent(venue)}`),
                          api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
                        ]);
                        setClosing({ ...closing, gate, drawer, stage: 'checklist', counts: {} });
                      })
                      .catch((err) => setError(messageForError(err, 'Could not close the drawer.')));
                  }}
                >
                  Close drawer
                </button>
                <button type="button" className="pos-ghost" onClick={() => setClosing({ ...closing, stage: 'checklist' })}>
                  Back
                </button>
              </>
            ) : null}

            {closing.stage === 'report' && closing.report ? (
              <>
                <h2>Close of day — {closing.report.serviceDate}</h2>
                <div className="pos-day-grid">
                  <div>
                    <small>Sales</small>
                    <strong>{money(closing.report.totalCents)}</strong>
                  </div>
                  <div>
                    <small>Orders</small>
                    <strong>{closing.report.orderCount}</strong>
                  </div>
                  <div>
                    <small>Tips</small>
                    <strong>{money(closing.report.tipCents)}</strong>
                  </div>
                  <div>
                    <small>GST</small>
                    <strong>{money(closing.report.gstCents)}</strong>
                  </div>
                </div>
                {Object.entries(closing.report.methods).map(([method, bucket]) => (
                  <p key={method} className="pos-muted">
                    {method === 'CASH' ? 'Cash' : 'Card'} · {bucket.count} payments · {money(bucket.amountCents + bucket.tipCents)}
                  </p>
                ))}
                {closing.report.drawers.map((drawer, index) => (
                  <p key={index} className="pos-muted">
                    Drawer {index + 1}: float {money(drawer.openingFloatCents)} → counted {money(drawer.countedCents ?? 0)} (
                    {(drawer.varianceCents ?? 0) === 0
                      ? 'balanced'
                      : `${(drawer.varianceCents ?? 0) > 0 ? 'over' : 'short'} ${money(Math.abs(drawer.varianceCents ?? 0))}`}
                    )
                  </p>
                ))}
                {closing.report.topItems.slice(0, 10).map((item) => (
                  <div key={item.name} className="pos-day-item">
                    <span>
                      {item.quantity}× {item.name}
                    </span>
                    <span>{money(item.totalCents)}</span>
                  </div>
                ))}
                <div className="pos-choice-row">
                  <button type="button" className="pos-ghost" onClick={() => window.print()}>
                    Print report
                  </button>
                  <button type="button" className="pos-charge" onClick={() => setClosing(null)}>
                    Done
                  </button>
                </div>
              </>
            ) : null}
            {closing.stage !== 'report' ? (
              <button type="button" className="pos-ghost pos-modal-close" onClick={() => setClosing(null)}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {shift ? (
        <div className="pos-modal" role="dialog" onClick={() => setShift(null)}>
          <div className="pos-modal-panel pos-receipt" id="pos-shift" onClick={(event) => event.stopPropagation()}>
            <h2>{shift.staffName} — shift</h2>
            <div className="pos-day-grid">
              <div>
                <small>Sales</small>
                <strong>{money(shift.totalCents)}</strong>
              </div>
              <div>
                <small>Orders / items</small>
                <strong>
                  {shift.orderCount} / {shift.itemCount}
                </strong>
              </div>
              <div>
                <small>Tips</small>
                <strong>{money(shift.tipCents)}</strong>
              </div>
            </div>
            {Object.entries(shift.methods).map(([method, bucket]) => (
              <p key={method} className="pos-muted">
                {method === 'CASH' ? 'Cash' : method === 'REFUND' ? 'Refunds' : 'Card'} · {bucket.count} payments ·{' '}
                {money(bucket.amountCents + bucket.tipCents)}
              </p>
            ))}
            {shift.adjustments.length ? <p className="pos-muted">Adjustments:</p> : null}
            {shift.adjustments.slice(0, 8).map((adjustment, index) => (
              <div key={index} className="pos-day-item">
                <span>
                  {adjustment.kind} · {adjustment.itemName} · {adjustment.reason}
                </span>
                <span>{money(adjustment.amountCents)}</span>
              </div>
            ))}
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => window.print()}>
                Print
              </button>
              <button type="button" className="pos-charge" onClick={() => setShift(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {day ? (
        <div className="pos-modal" role="dialog" onClick={() => setDay(null)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2>
              {venue} · {day.serviceDate}
            </h2>
            <div className="pos-day-grid">
              <div>
                <small>Sales</small>
                <strong>{money(day.totalCents)}</strong>
              </div>
              <div>
                <small>Orders</small>
                <strong>{day.orderCount}</strong>
              </div>
              <div>
                <small>Tips</small>
                <strong>{money(day.tipCents)}</strong>
              </div>
              <div>
                <small>GST</small>
                <strong>{money(day.gstCents)}</strong>
              </div>
            </div>
            {Object.entries(day.methods).map(([method, bucket]) => (
              <p key={method} className="pos-muted">
                {method === 'CASH' ? 'Cash' : 'Card'} · {bucket.count} payments · {money(bucket.amountCents + bucket.tipCents)}
              </p>
            ))}
            {day.topItems.slice(0, 8).map((item) => (
              <div key={item.name} className="pos-day-item">
                <span>
                  {item.quantity}× {item.name}
                </span>
                <span>{money(item.totalCents)}</span>
              </div>
            ))}
            {tillFlag !== null ? (
              <label className="pos-till-toggle">
                <input
                  type="checkbox"
                  checked={tillFlag}
                  onChange={(event) => {
                    const next = event.currentTarget.checked;
                    setTillFlag(next);
                    void api('/api/pos/venue-settings', {
                      method: 'PUT',
                      body: JSON.stringify({ venue, postToReports: next })
                    }).catch((err) => setError(messageForError(err, 'Could not save.')));
                  }}
                />
                This POS is the till — post day sales, covers &amp; card tips to Reports
              </label>
            ) : null}
            <div className="pos-identity-fields">
              <input
                className="pos-tender"
                placeholder="Business name on receipts"
                defaultValue={venueIdentity.businessName}
                onBlur={(event) => {
                  const businessName = event.currentTarget.value.trim();
                  if (!businessName || businessName === venueIdentity.businessName) return;
                  setVenueIdentity((current) => ({ ...current, businessName }));
                  void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue, businessName }) }).catch((err) =>
                    setError(messageForError(err, 'Could not save.'))
                  );
                }}
              />
              <input
                className="pos-tender"
                placeholder="ABN (shown on receipts)"
                defaultValue={venueIdentity.abn ?? ''}
                onBlur={(event) => {
                  const abn = event.currentTarget.value.trim();
                  if (abn === (venueIdentity.abn ?? '')) return;
                  setVenueIdentity((current) => ({ ...current, abn: abn || null }));
                  void api('/api/pos/venue-settings', { method: 'PUT', body: JSON.stringify({ venue, abn }) }).catch((err) =>
                    setError(messageForError(err, 'Could not save.'))
                  );
                }}
              />
            </div>
            {operatorName ? (
              <button
                type="button"
                className="pos-ghost"
                onClick={() => {
                  void api<NonNullable<typeof shift>>(`/api/pos/shift-report?venue=${encodeURIComponent(venue)}&staffName=${encodeURIComponent(operatorName)}`)
                    .then((report) => {
                      setShift(report);
                      setDay(null);
                    })
                    .catch((err) => setError(messageForError(err, 'Could not load your shift.')));
                }}
              >
                My shift report
              </button>
            ) : null}
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setDay(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}

// The venue floor plan — same tables + geometry the Reserve app's floor-plan
// editor manages. Occupied = an open POS order whose table label matches.
function FloorView({
  tables,
  area,
  setArea,
  openOrders,
  reservations,
  busy,
  editing,
  onMove,
  onPick
}: {
  tables: FloorTable[];
  area: string;
  setArea: (value: string) => void;
  openOrders: Order[];
  reservations: FloorReservation[];
  busy: boolean;
  editing?: boolean;
  onMove?: (tableId: string, posX: number, posY: number) => void;
  onPick: (table: FloorTable) => void;
}) {
  const dragRef = { current: null as null | { id: string; startX: number; startY: number; posX: number; posY: number; el: HTMLElement } };
  const now = Date.now();
  // Next upcoming (or currently seated) booking per table label.
  const nextByTable = new Map<string, FloorReservation>();
  for (const reservation of reservations) {
    if (!reservation.tableLabel) continue;
    if (new Date(reservation.startsAt).getTime() < now - 2.5 * 3600_000) continue;
    const key = reservation.tableLabel.toLowerCase();
    if (!nextByTable.has(key)) nextByTable.set(key, reservation);
  }
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
  const areas = Array.from(new Set(tables.map((table) => table.area)));
  const shown = tables.filter((table) => table.area === (area || areas[0]));
  const placed = shown.filter((table) => table.posX != null && table.posY != null);
  const unplaced = shown.filter((table) => table.posX == null || table.posY == null);
  const orderFor = (table: FloorTable) =>
    openOrders.find((open) => (open.tableLabel ?? '').toLowerCase() === table.label.toLowerCase());

  return (
    <div className="pos-floor">
      {areas.length > 1 ? (
        <nav className="pos-tabs">
          {areas.map((name) => (
            <button key={name} type="button" className={name === (area || areas[0]) ? 'is-active' : ''} onClick={() => setArea(name)}>
              {name}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="pos-floor-canvas">
        {placed.map((table) => {
          const open = orderFor(table);
          return (
            <button
              key={table.id}
              type="button"
              disabled={busy}
              className={`pos-floor-table ${open ? `is-occupied is-${fireState(open.lines as Array<{ sentAt?: string | null }>)}` : ''} ${!open && nextByTable.has(table.label.toLowerCase()) ? 'is-reserved' : ''} ${table.shape === 'round' ? 'is-round' : ''}`}
              style={{
                left: `${table.posX}%`,
                top: `${table.posY}%`,
                width: `${table.width ?? 10}%`,
                height: `${table.height ?? 10}%`,
                transform: `rotate(${table.rotation}deg)`
              }}
              onClick={() => onPick(table)}
              onPointerDown={(event) => {
                if (!editing || !onMove) return;
                const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const start = { x: event.clientX, y: event.clientY };
                const startPos = { x: table.posX ?? 0, y: table.posY ?? 0 };
                const move = (ev: PointerEvent) => {
                  const dx = ((ev.clientX - start.x) / canvas.width) * 100;
                  const dy = ((ev.clientY - start.y) / canvas.height) * 100;
                  onMove(table.id, Math.min(96, Math.max(0, startPos.x + dx)), Math.min(96, Math.max(0, startPos.y + dy)));
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              <strong>{table.label}</strong>
              <small>
                {open
                  ? money(open.totalCents - paidCents(open))
                  : (() => {
                      const upcoming = nextByTable.get(table.label.toLowerCase());
                      return upcoming
                        ? `${timeOf(upcoming.startsAt)} ${upcoming.name.split(' ')[0]} ×${upcoming.covers}`
                        : `${table.seats ?? table.maxCovers}`;
                    })()}
              </small>
            </button>
          );
        })}
        {placed.length === 0 ? (
          <p className="pos-muted pos-floor-empty">
            No tables placed for this area yet — arrange them in Reserve → Settings → Floor plan and they appear here.
          </p>
        ) : null}
      </div>
      {unplaced.length > 0 ? (
        <div className="pos-floor-unplaced">
          {unplaced.map((table) => {
            const open = orderFor(table);
            return (
              <button key={table.id} type="button" disabled={busy} className={`pos-ghost ${open ? 'pos-chip-occupied' : ''}`} onClick={() => onPick(table)}>
                {table.label}
                {open ? ` · ${money(open.totalCents - paidCents(open))}` : ''}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CashPad({
  dueCents,
  tendered,
  setTendered,
  busy,
  onTake
}: {
  dueCents: number;
  tendered: string;
  setTendered: (value: string) => void;
  busy: boolean;
  onTake: () => void;
}) {
  const tenderedCents = Math.round(Number(tendered || '0') * 100);
  const roundedDue = roundCash5(dueCents);
  return (
    <>
      <h2>Cash — {money(roundedDue)}</h2>
      {roundedDue !== dueCents ? (
        <p className="pos-muted">
          {money(dueCents)} rounds {roundedDue > dueCents ? 'up' : 'down'} to {money(roundedDue)} for cash.
        </p>
      ) : null}
      <div className="pos-choice-row">
        {[roundedDue, Math.ceil(roundedDue / 5000) * 5000, Math.ceil(roundedDue / 10000) * 10000]
          .filter((value, index, all) => all.indexOf(value) === index)
          .map((cents) => (
            <button key={cents} type="button" onClick={() => setTendered(String(cents / 100))}>
              {money(cents)}
            </button>
          ))}
      </div>
      <input
        className="pos-tender"
        inputMode="decimal"
        placeholder="Tendered"
        value={tendered}
        onChange={(event) => setTendered(event.currentTarget.value)}
      />
      {tendered && tenderedCents >= roundedDue ? <p className="pos-change">Change: {money(tenderedCents - roundedDue)}</p> : null}
      <button type="button" className="pos-charge" disabled={busy || !tendered || tenderedCents < roundedDue} onClick={onTake}>
        Take cash
      </button>
    </>
  );
}

function PinScreen({ staffList, onSignedIn }: { staffList: StaffOption[]; onSignedIn: () => Promise<void> }) {
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitPin(nextPin: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/device/pin-login', {
        method: 'POST',
        body: JSON.stringify({ staffProfileId: selected.id, pin: nextPin })
      });
      await onSignedIn();
    } catch (err) {
      setError(messageForError(err, 'Wrong PIN.'));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy) return;
    const next = (pin + digit).slice(0, 6);
    setPin(next);
    if (next.length >= 4) void submitPin(next);
  }

  return (
    <div className="pos-center">
      <div className="pos-pin">
        <h1>Who's on the register?</h1>
        {!selected ? (
          <div className="pos-pin-staff">
            {staffList.filter((member) => member.hasPin).map((member) => (
              <button key={member.id} type="button" onClick={() => setSelected(member)}>
                <strong>{member.name}</strong>
                <small>{member.roleTitle}</small>
              </button>
            ))}
            {staffList.filter((member) => member.hasPin).length === 0 ? (
              <p className="pos-muted">No staff have PINs yet — set them in the Staff app.</p>
            ) : null}
          </div>
        ) : (
          <>
            <p className="pos-muted">
              {selected.name} — enter your PIN{' '}
              <button type="button" className="pos-linklike" onClick={() => { setSelected(null); setPin(''); setError(null); }}>
                (change)
              </button>
            </p>
            <div className="pos-pin-dots">{'●'.repeat(pin.length).padEnd(4, '○')}</div>
            {error ? <p className="pos-error-inline">{error}</p> : null}
            <div className="pos-pin-pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, index) =>
                key === '' ? (
                  <span key={index} />
                ) : (
                  <button
                    key={index}
                    type="button"
                    disabled={busy}
                    onClick={() => (key === '⌫' ? setPin(pin.slice(0, -1)) : press(key))}
                  >
                    {key}
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await onSignedIn();
    } catch (err) {
      setError(messageForError(err, 'Sign in failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-center">
      <div className="pos-signin">
        <img src="/brand/alma-a-mark.png" alt="" className="pos-mark pos-signin-mark" />
        <h1>ALMA POS</h1>
        <p className="pos-muted">Sign in at Alma Home, then tap the POS button.</p>
        <button type="button" className="pos-charge" onClick={() => { window.location.href = 'https://alma-home.web.app'; }}>
          Sign in at Alma Home
        </button>
        <details className="pos-signin-fallback">
          <summary>Use a device account instead</summary>
          <form onSubmit={submit}>
            <input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
            {error ? <p className="pos-error-inline">{error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Open register'}
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}
