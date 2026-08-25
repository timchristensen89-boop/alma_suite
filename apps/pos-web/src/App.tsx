import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { loadStripeTerminal, type Terminal, type Reader } from '@stripe/terminal-js';
import { api, clearApiTokens, consumeSuiteHandoffToken, messageForError, openSuiteApp, setApiAuthToken, setApiPinToken } from './api';
import { POS_SURFACES, SUITE_APP_LINKS } from './suiteApps';
// Dietary vocabulary, shared with Stock and the booking parser so a guest's
// requirement and a dish's label are the same words rather than two sets that
// nearly match.
import { answerableGuestTags, dietaryKind, dietaryLabel, dietaryShort, dishAnswersGuest, guestTagIsAllergy, menuForDay, parseDishDietary } from '@alma/shared';

// Lazy: jsQR is ~130KB the till never needs until somebody actually taps
// "Scan the card" — the register's first paint shouldn't carry it.
const ScanSheet = lazy(() => import('./ScanSheet').then((module) => ({ default: module.ScanSheet })));
// Lazy: the board editor is a management surface a till only opens to
// rearrange tiles — it has no business in the register's startup chunk.
const BoardEditor = lazy(() => import('./BoardEditor').then((m) => ({ default: m.BoardEditor })));
// Board + nav vocabulary (pin shapes, tab tokens, page breaks) is shared with
// the board editor so the two can never drift apart.
import {
  BRIGHT_PALETTE,
  HOME_TAB,
  HUE_DOTS,
  HUE_NAMES,
  MGMT_KEYS,
  MGMT_LABELS,
  ICONS_KEY,
  hueClass,
  hueStyle,
  iconKeyFor,
  iconSvg,
  loadIconStyle,
  loadTextScale,
  textScaleValue,
  TEXT_SCALE_KEY,
  type TextScale,
  MAX_FOLDER_DEPTH,
  folderAtPath,
  folderPathToken,
  paginatePins,
  parseFolderPath,
  pinDisplay,
  updateFolderAtPath,
  visibleTabTokens,
  childNavGroups,
  groupSubtreeCats,
  type FolderPin,
  type HomeConfig,
  type MenuCategory,
  type MenuItem,
  type Pin,
  type TabsConfig
} from './board';
// The A mark and the fish, inlined into the bundle rather than fetched.
import { ALMA_MARK, ALMA_FISH } from './brand';

// ── ALMA POS v2 ─────────────────────────────────────────────────────────────
// Home screen (open tables/tabs + quick sale + day glance) → order screen
// (menu grid, coursed cart) → charge (tips, cash/card, SPLIT bills). Orders
// are server-backed from the moment a table opens; totals — including the
// automatic weekend/public-holiday surcharge and any timed discounts — are
// computed server-side on every cart change.

type OrderLine = {
  id?: string;
  recipeId: string | null;
  name: string;
  printName?: string | null;
  unitPriceCents: number;
  quantity: number;
  course?: string | null;
  seat?: number | null;
  modifiers?: Array<{ name: string; priceCents: number }> | null;
  notes?: string | null;
  // The set menu that paid for this line — set on the $0 dishes a banquet
  // rings, so the bill can group them and the report can tell them from comps.
  packagedBy?: string | null;
  sentAt?: string | null;
  // Server-built voucher line (syncGiftCardLines). Never cooked, never fired,
  // never editable here — the cart shows it in its own block, off the courses.
  isGiftCard?: boolean;
};
// What the register needs to run a banquet, shipped with the menu.
type SetMenuOption = {
  id: string;
  recipeId: string;
  title: string;
  /** Charged on top of the package price, per guest. 0 = included. */
  supplementCents: number;
  salePriceCents: number | null;
};
type SetMenuCourse = {
  id: string;
  name: string;
  posCourse: string | null;
  /** Choices each guest makes here. covers x pick = what the table owes. */
  pick: number;
  /** One serve feeds this many. NULL = one each. */
  perGuests: number | null;
  options: SetMenuOption[];
};
// What the register needs to sell a wine. Price comes off the recipe each pour
// points at, so a pour is a sellable item in its own right.
type RegisterWinePour = { recipeId: string; ml: number; priceCents: number; title: string; printName: string | null };
type RegisterWine = {
  id: string;
  venue: string;
  name: string;
  producer: string;
  cuvee: string | null;
  grape: string | null;
  region: string | null;
  origin: string | null;
  vintage: number | null;
  section: string | null;
  styleBand: string | null;
  /** 's' seafood & ceviche, 'r' rich & grilled, 'v' vegetables & cheese. */
  pairsWith: string[];
  tastingNote: string | null;
  sommelierPour: boolean;
  limitedStock: boolean;
  serveChilled: boolean;
  pours: RegisterWinePour[];
};
type SetMenuPlan = {
  recipeId: string;
  title: string;
  salePriceCents: number | null;
  /** Nobody chooses these — bread for the table, greens between four. */
  fixed: Array<{ name: string; printName: string | null; recipeId: string | null; quantity: number; perGuests: number | null }>;
  courses: SetMenuCourse[];
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
  loyaltyCode?: string | null;
  loyaltyPoints?: number;
  loyaltyJoinedAt?: string | null;
};
type LoyaltyMember = {
  guestId: string;
  code: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  points: number;
  creditCents: number;
  pointValueCents: number;
  minRedeemPoints: number;
};
type GuestProfile = OrderGuest & {
  lastVisitAt: string | null;
  visitNotes: string | null;
  favourites: Array<{ name: string; quantity: number; totalCents: number }>;
};
type ModifierOption = { id: string; name: string; priceCents: number };
type ModifierGroup = { id: string; name: string; required: boolean; maxSelect: number; categories: string[]; options: ModifierOption[] };

/**
 * The last good /api/pos/menu response, exactly as the menu effect wrote it.
 * Read once per call — used by the state initialisers so the register paints
 * a usable grid before the first network round trip completes.
 */
type MenuPayload = {
  categories: MenuCategory[];
  eightySix?: string[];
  modifierGroups?: ModifierGroup[];
  setMenus?: SetMenuPlan[];
  wines?: RegisterWine[];
};
function readMenuCache(): MenuPayload | null {
  try {
    const cached = localStorage.getItem('alma.pos.menuCache');
    return cached ? (JSON.parse(cached) as MenuPayload) : null;
  } catch {
    return null;
  }
}
type Order = {
  orderType?: 'DINE_IN' | 'TAKEAWAY' | null;
  openedByName?: string | null;
  notes?: string | null;
  dietary?: Array<{ tag: string; seat: number | null }> | null;
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
  orderNotes?: string | null;
  dietary?: Array<{ tag: string; seat: number | null }>;
  // What this piece of paper IS: a call-away the kitchen must cook now, a
  // hold copy to work from, or the whole order for reference. The kitchen
  // must never have to guess which.
  kind?: 'FIRE' | 'HOLD' | 'FULL';
  orderType?: 'DINE_IN' | 'TAKEAWAY';
  // Who took the order vs who called it away — different people, different
  // questions when something goes wrong.
  firedByName?: string | null;
  orderedAt?: string | null;
  firedAt?: string | null;
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

/**
 * Owns the raw keystrokes so typing re-renders THIS input alone — the
 * register only hears the 120ms-debounced term it actually filters by.
 * Before this, every character re-evaluated the whole ~3,300-line render.
 */
const PosSearchBox = memo(function PosSearchBox({ onTerm }: { onTerm: (term: string) => void }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => onTerm(value), 120);
    return () => clearTimeout(timer);
  }, [value, onTerm]);
  return (
    <input
      className="pos-search"
      placeholder="Search menu…"
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
    />
  );
});

const VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];
// Set when we send someone to Alma Home to sign in. If they come back still
// signed out, the handoff didn't stick — show the device sign-in rather than
// ping-ponging between the two apps.
const BOUNCE_KEY = 'alma.pos.signinBounce';

// Dine in unless the order says otherwise — the kitchen packs differently.
function orderTypeOf(order: { orderType?: string | null } | null): 'DINE_IN' | 'TAKEAWAY' {
  return order?.orderType === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN';
}
// Kitchen clocks are wall clocks: 7:42pm, not an ISO string.
function clockTime(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })
    .toLowerCase()
    .replace(' ', '');
}
// Fire progress of an order: 'waiting' = lines not yet called away,
// 'away' = everything fired, 'empty' = no lines.
function fireState(lines: Array<{ sentAt?: string | null }>): 'waiting' | 'away' | 'empty' {
  if (lines.length === 0) return 'empty';
  return lines.some((line) => !line.sentAt) ? 'waiting' : 'away';
}
// Australian cash rounding — physical cash rounds to the nearest 5c.
const roundCash5 = (cents: number) => Math.round(cents / 5) * 5;
// Menu tiles take a calm hue from their category so every grid reads warm.
// Cached: the same handful of category names get hashed on every tile render.
const hueCache = new Map<string, string>();
function hueForCategory(name: string) {
  const hit = hueCache.get(name);
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = HUE_NAMES[h % HUE_NAMES.length]!;
  hueCache.set(name, hue);
  return hue;
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

const CASH_DENOMS: Array<[string, number]> = [
  ['100', 10000],
  ['50', 5000],
  ['20', 2000],
  ['10', 1000],
  ['5', 500],
  ['2', 200],
  ['1', 100],
  ['50c', 50],
  ['20c', 20],
  ['10c', 10],
  ['5c', 5]
];

// How long this bill has been open, and how worried the floor should be.
function elapsedMinutes(order: { createdAt?: string | null }): number | null {
  if (!order.createdAt) return null;
  return Math.max(0, Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000));
}
function elapsedLabel(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
// Seated under an hour is calm; past two, someone should be checking in.
function stayClass(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes >= 120) return 'is-stay-long';
  if (minutes >= 60) return 'is-stay-mid';
  return 'is-stay-fresh';
}

function money(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function paidCents(order: Order) {
  return order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

// The wine list is its own view rather than a category of tiles, so it needs a
// token the board will never produce.
const WINE_TAB = '__wine__';

function defaultCourse(_kind: string) {
  return 'NOW';
}

type StaffOption = { id: string; name: string; roleTitle: string; hasPin: boolean };
type AuthShape =
  | 'loading'
  | null
  // `trainingOnly` is a practice account. It comes from the server on every
  // /api/auth/me, and on a shared device it is already the OR of the till and
  // the PIN — the client only reads it. Nothing here can clear it, which is
  // the entire difference from the localStorage switch it replaces.
  | { kind: 'staff'; name: string; trainingOnly: boolean }
  | { kind: 'device'; staffName: string | null; staffList: StaffOption[]; trainingOnly: boolean };

export function App() {
  const [me, setMe] = useState<AuthShape>('loading');
  const [bill, setBill] = useState<Order | null>(null);
  const [venue, setVenue] = useState<string>(() => localStorage.getItem('alma.pos.venue') ?? VENUES[0]!);
  // Hydrated synchronously from the last good /api/pos/menu response so the
  // register paints a usable grid in zero round trips on open; the fetch in
  // the menu effect then revalidates in the background. The cache was
  // previously read only when the fetch FAILED, so a normal online open
  // stared at an empty grid for the full auth+menu waterfall.
  const [rawMenu, setRawMenu] = useState<MenuCategory[]>(() => readMenuCache()?.categories ?? []);
  // Set menus that ask a question, keyed by the tile's recipeId. A menu with
  // no courses isn't here, so its tile keeps ringing as a plain priced item.
  const [setMenuPlans, setSetMenuPlans] = useState<Map<string, SetMenuPlan>>(
    () => new Map((readMenuCache()?.setMenus ?? []).map((plan) => [plan.recipeId, plan]))
  );
  const [allWines, setAllWines] = useState<RegisterWine[]>(() => readMenuCache()?.wines ?? []);
  // The weekday the register prices by — device-local, the same convention
  // as the offline weekend surcharge, and re-checked each minute so Taco
  // Tuesday ends when Tuesday does, even on a register nobody reloads.
  const [priceDay, setPriceDay] = useState<number>(() => new Date().getDay());
  useEffect(() => {
    const tick = window.setInterval(() => {
      setPriceDay((current) => {
        const day = new Date().getDay();
        return day === current ? current : day;
      });
    }, 60_000);
    return () => window.clearInterval(tick);
  }, []);
  // Each venue sells its own menu: St Alma items at St Alma, Avalon's at
  // Avalon. Unassigned items and Functions / Pop-up see everything.
  const menu = useMemo(() => {
    const venueMenu =
      venue !== 'St Alma' && venue !== 'Alma Avalon'
        ? rawMenu
        : rawMenu
            .map((category) => ({
              ...category,
              items: category.items
                .filter((item) => !item.venue || item.venue === venue)
                // Shared (venue-null) recipes price per register via the override
                // map; venue-tagged ones arrive with it already applied.
                .map((item) => (item.venuePrices?.[venue] != null ? { ...item, priceCents: item.venuePrices[venue] } : item))
            }))
            .filter((category) => category.items.length > 0);
    // Taco Tuesday bakes LAST, so a weekday window beats a per-venue
    // override, and a dish outside its window (the Tuesday-only taco board)
    // is not on the board at all today.
    return menuForDay(venueMenu, priceDay).filter((category) => category.items.length > 0);
  }, [rawMenu, venue, priceDay]);
  const [kindByRecipe, setKindByRecipe] = useState<Map<string, string>>(() => {
    const kinds = new Map<string, string>();
    for (const category of readMenuCache()?.categories ?? []) {
      for (const item of category.items) kinds.set(item.recipeId, category.kind);
    }
    return kinds;
  });
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [floorTables, setFloorTables] = useState<FloorTable[]>([]);
  const [floorArea, setFloorArea] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  // Render-time mirror so async work (the optimistic order-creation loop)
  // can read the LATEST order without stale closures.
  const orderNow = useRef<Order | null>(null);
  orderNow.current = order;
  // Monotonic id per pushLines call — the stale-echo guard.
  const pushSeqRef = useRef(0);
  // Register-first: the app opens on menu + bill; Tables is a secondary view.
  const [view, setView] = useState<'register' | 'tables' | 'bills' | 'board'>('register');
  // Bills page: everything trading right now plus what's already settled.
  const [settled, setSettled] = useState<Order[]>([]);
  const [splitPick, setSplitPick] = useState<null | { mode: 'item' | 'seat'; picked: string[]; seat: number | null }>(null);
  // What this venue actually sells — suggestions beat a blank search box.
  const [topSellers, setTopSellers] = useState<string[]>([]);
  const [bills, setBills] = useState<Order[] | null>(null);
  const [refunding, setRefunding] = useState<null | { order: Order; amount: string; reason: string; method: 'REFUND' | 'CASH' | 'TERMINAL' }>(null);
  // Card payments on the bill being refunded that Square can actually send
  // money back to. Empty = no terminal option offered, so a cash bill never
  // shows a button that can only fail.
  const [refundCards, setRefundCards] = useState<Array<{ squarePaymentId: string; refundableCents: number; devices: Array<{ id: string; name: string }> }>>([]);
  const [merging, setMerging] = useState<Order[] | null>(null);
  const [editLayout, setEditLayout] = useState(false);
  const [activeCategory, setActiveCategory] = useState('');
  const [newTable, setNewTable] = useState<null | { label: string; covers: string }>(null);
  const [charge, setCharge] = useState<null | { stage: 'pay' | 'tip' | 'method' | 'cash' | 'split' | 'gift' | 'loyalty'; tipCents: number; amountCents: number | null }>(null);
  // Loyalty at the charge screen: the handle being typed, and the join
  // mini-form when the phone isn't a member yet.
  const [loyalty, setLoyalty] = useState<{ handle: string; joinName: string; joining: boolean; working: boolean; member: LoyaltyMember | null }>({
    handle: '',
    joinName: '',
    joining: false,
    working: false,
    member: null
  });
  // `external` = the code isn't ours (an old Gift Up card, say) — we can
  // still take it, recorded as an outside tender against the number.
  const [gift, setGift] = useState<{
    code: string;
    balanceCents: number | null;
    checking: boolean;
    external?: boolean;
    // How much of THIS card to take — the guest decides, it needn't be all
    // of it and needn't clear the bill.
    take: string;
    holder?: string | null;
  }>({ code: '', balanceCents: null, checking: false, take: '' });
  // Cards already put against this bill, so staff can see what's been taken.
  const [giftApplied, setGiftApplied] = useState<Array<{ code: string; amountCents: number; remainingCents: number | null }>>([]);
  // The camera sheet on the gift tender — scan the wallet pass or printed
  // card instead of typing the code mid-service.
  const [giftScan, setGiftScan] = useState(false);
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
  // Training has two sources and they are not equal.
  //
  // `trainingSwitch` is the old one: a per-device opt-in a manager flips to
  // practise on a real till. It stays, because it is useful.
  //
  // `trainingLocked` is the account saying so, and it wins. It cannot be
  // switched off here, and the server does not believe this client anyway —
  // createOrder ORs the account's flag in regardless of what we send. The UI
  // below is honesty about a decision already made server-side, not the
  // decision itself.
  const [trainingSwitch, setTrainingSwitch] = useState(() => localStorage.getItem('alma.pos.training') === '1');
  const trainingLocked = me !== 'loading' && me !== null && me.trainingOnly;
  const training = trainingSwitch || trainingLocked;
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
  const [design, setDesign] = useState<'classic' | 'rail'>(() => (localStorage.getItem('alma.pos.design') === 'classic' ? 'classic' : 'rail'));
  const [textScale, setTextScale] = useState<TextScale>(loadTextScale);

  useEffect(() => {
    document.body.classList.toggle('pos-v2', design === 'rail');
    localStorage.setItem('alma.pos.design', design);
  }, [design]);

  // One number drives the board type, the tile size and the nav; the pager's
  // measurement reads the same value so bigger text means fewer tiles per
  // page rather than tiles scrolling off the bottom.
  useEffect(() => {
    localStorage.setItem(TEXT_SCALE_KEY, textScale);
    document.body.style.setProperty('--pos-text-scale', String(textScaleValue(textScale)));
  }, [textScale]);
  // St Alma and Alma Avalon are separate companies — receipts and the header
  // carry the selected venue's own identity.
  const [venueIdentity, setVenueIdentity] = useState<{ businessName: string; abn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; receiptLogo: string | null }>({ businessName: 'ALMA', abn: null, address: null, phone: null, email: null, website: null, receiptLogo: null });

  useEffect(() => {
    if (me === 'loading' || !me) return;
    void api<{ businessName: string; abn: string | null }>(`/api/pos/venue-settings?venue=${encodeURIComponent(venue)}`)
      .then((setting) =>
        setVenueIdentity({
          businessName: setting.businessName || venue,
          abn: setting.abn ?? null,
          address: (setting as { address?: string | null }).address ?? null,
          phone: (setting as { phone?: string | null }).phone ?? null,
          email: (setting as { email?: string | null }).email ?? null,
          website: (setting as { website?: string | null }).website ?? null,
          receiptLogo: (setting as { receiptLogo?: string | null }).receiptLogo ?? null
        })
      )
      .catch(() => setVenueIdentity({ businessName: venue, abn: null, address: null, phone: null, email: null, website: null, receiptLogo: null }));
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
  // A register tab stays open for days, so a deploy never reaches it. Poll
  // the shell for a new asset hash and offer a one-tap reload — never force
  // one, that could land mid-order.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const mine = new URL(import.meta.url).pathname.split('/').pop() ?? '';
    let stop = false;
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const live = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1];
        if (!stop && live && mine && live !== mine) setUpdateReady(true);
      } catch {
        /* offline: the queue handles it, nothing to update */
      }
    };
    const timer = setInterval(check, 5 * 60_000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    void check();
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // The banner alone never gets tapped on a till, so deploys sat unapplied
  // for days ("the fix is live" while the register runs last week's bundle).
  // Auto-apply when it cannot interrupt anyone: no open sale AND the register
  // untouched for a few minutes, or the tab already hidden. Mid-order the
  // banner remains the only path, as before.
  const lastTouchAt = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      lastTouchAt.current = Date.now();
    };
    window.addEventListener('pointerdown', touch, { passive: true });
    return () => window.removeEventListener('pointerdown', touch);
  }, []);
  useEffect(() => {
    if (!updateReady) return;
    const tryReload = () => {
      if (orderNow.current) return; // never mid-order
      const idle = Date.now() - lastTouchAt.current > 3 * 60_000;
      if (document.visibilityState === 'hidden' || idle) window.location.reload();
    };
    const timer = setInterval(tryReload, 30_000);
    document.addEventListener('visibilitychange', tryReload);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tryReload);
    };
  }, [updateReady]);

  const [boardPage, setBoardPage] = useState(0);
  const [boardSlots, setBoardSlots] = useState(24);
  // Drawn food-group marks on the nav and the board, per device.
  const [iconStyle, setIconStyle] = useState(loadIconStyle);
  const iconsOn = iconStyle !== 'off';
  // A mark for this name, or nothing. Rendered as inline SVG so it takes the
  // ink colour of whatever it sits in.
  //
  const hasMark = (name: string) => Boolean(iconsOn && iconKeyFor(name, home.categories?.icons));
  // Column count is kept alongside the slot total so the board editor's
  // preview can lay tiles out on the same grid the register measured.
  const [boardCols, setBoardCols] = useState(4);
  const boardPagerRef = useRef<HTMLDivElement | null>(null);
  const pinPageCountRef = useRef(1);
  const pageFlipStamp = useRef(0);
  const boardSwiped = useRef(false);

  // Drag runs on document-level NATIVE listeners registered at drag start —
  // React's synthetic move events are unreliable under pointer capture.
  function boardPinPointerDown(event: React.PointerEvent, index: number) {
    if (!boardEdit) return;
    // A pointerdown on one of the tile's OWN controls (remove / resize /
    // rename) must not start a drag. This handler sits on the tile, so those
    // presses bubble into it, and the preventDefault + setPointerCapture
    // below then swallow the click that should have followed — which is
    // exactly why ✕, ⤢ and ✎ did nothing at all in edit mode. Any control
    // added to a tile in future needs `pos-pin-act` for the same reason.
    if ((event.target as HTMLElement).closest('.pos-pin-act')) return;
    event.preventDefault();
    dragPinIndex.current = index;
    dragMoved.current = false;
    const carried = (event.currentTarget as HTMLElement);
    carried.classList.add('is-dragging');
    // A ghost of the tile rides the finger, so you can see what you picked
    // up and where it is. Plain DOM, moved by transform — React never sees
    // it, so a 60fps drag costs no renders.
    const box = carried.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'pos-drag-ghost';
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    ghost.textContent = (carried.querySelector('span')?.textContent ?? '').trim();
    const grabX = event.clientX - box.left;
    const grabY = event.clientY - box.top;
    const placeGhost = (x: number, y: number) => {
      ghost.style.transform = `translate3d(${Math.round(x - grabX)}px, ${Math.round(y - grabY)}px, 0)`;
    };
    placeGhost(event.clientX, event.clientY);
    document.body.appendChild(ghost);
    // Pointer capture keeps the gesture with this tile even if the grid
    // re-renders underneath it mid-drag.
    try {
      carried.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
    // Fast drags outrun React renders, so hover decisions read the DOM's own
    // data attributes (always in sync with what's on screen) and the drop is
    // resolved by STABLE keys, never indices.
    const draggedPinAtStart = homeRef.current.pins[index];
    const dragKey = draggedPinAtStart?.t === 'i' ? draggedPinAtStart.id : null;
    const dropFolder = { name: null as string | null };
    const onMove = (nativeEvent: PointerEvent) => {
      if (dragPinIndex.current === null) return;
      placeGhost(nativeEvent.clientX, nativeEvent.clientY);
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
      // THE BUG THAT MADE DRAG DO NOTHING (fixed 2026-08-11): this updater
      // used to read dragPinIndex.current, which the next line reassigns.
      // React runs updaters at RENDER time (twice under StrictMode), by which
      // point the ref already equalled `over` — so every swap was a no-op and
      // the board never moved. Capture the index first; keep the updater pure.
      const from = dragPinIndex.current;
      dragPinIndex.current = over;
      if (from === null || from === over) return;
      setHome((current) => {
        if (from >= current.pins.length || over >= current.pins.length) return current;
        // SWAP places — the dragged tile and the one under it trade spots.
        const pins = [...current.pins];
        const held = pins[from]!;
        pins[from] = pins[over]!;
        pins[over] = held;
        return { ...current, pins };
      });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      ghost.remove();
      document.querySelectorAll('.pos-item-pin.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
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

  function folderItemPointerDown(event: React.PointerEvent, path: number[], itemIndex: number) {
    if (!boardEdit) return;
    event.preventDefault();
    let from = itemIndex;
    let moved = false;
    // The id, not the index: reorders shuffle indices mid-drag, and a drop
    // into a subfolder must move THIS dish wherever it ended up.
    const draggedId = folderAtPath(homeRef.current.pins, path)?.items[itemIndex] ?? null;
    // Hovering a subfolder tile: computer-style — drop moves the item INSIDE.
    const dropSub = { index: null as number | null };
    const held = event.currentTarget as HTMLElement;
    held.classList.add('is-dragging');
    const box = held.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'pos-drag-ghost';
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    ghost.textContent = (held.querySelector('span')?.textContent ?? '').trim();
    const grabX = event.clientX - box.left;
    const grabY = event.clientY - box.top;
    const placeGhost = (x: number, y: number) => {
      ghost.style.transform = `translate3d(${Math.round(x - grabX)}px, ${Math.round(y - grabY)}px, 0)`;
    };
    placeGhost(event.clientX, event.clientY);
    document.body.appendChild(ghost);
    const clearDropTargets = () =>
      document.querySelectorAll('.pos-item-pin.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    const onMove = (nativeEvent: PointerEvent) => {
      placeGhost(nativeEvent.clientX, nativeEvent.clientY);
      const under = document.elementFromPoint(nativeEvent.clientX, nativeEvent.clientY);
      const sub = under?.closest('[data-fsub-index]');
      if (draggedId && sub) {
        dropSub.index = Number(sub.getAttribute('data-fsub-index'));
        clearDropTargets();
        sub.classList.add('is-drop-target');
        return;
      }
      dropSub.index = null;
      clearDropTargets();
      const target = under?.closest('[data-fitem-index]');
      if (!target) return;
      const over = Number(target.getAttribute('data-fitem-index'));
      if (Number.isNaN(over) || over === from) return;
      moved = true;
      // Same trap as the board drag: `from` is reassigned right after, and the
      // updater runs later — so freeze it before calling setHome.
      const start = from;
      from = over;
      setHome((current) => ({
        ...current,
        pins: updateFolderAtPath(current.pins, path, (folder) => {
          const items = [...folder.items];
          const [dragged] = items.splice(start, 1);
          items.splice(over, 0, dragged!);
          return { ...folder, items };
        })
      }));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      ghost.remove();
      held.classList.remove('is-dragging');
      clearDropTargets();
      if (draggedId && dropSub.index !== null) {
        const subIndex = dropSub.index;
        dragMoved.current = true;
        setHome((current) => {
          const pins = updateFolderAtPath(current.pins, path, (folder) => {
            const child = folder.folders?.[subIndex];
            if (!child) return folder;
            return {
              ...folder,
              items: folder.items.filter((id) => id !== draggedId),
              folders: (folder.folders ?? []).map((candidate, i) =>
                i === subIndex && !candidate.items.includes(draggedId)
                  ? { ...candidate, items: [...candidate.items, draggedId] }
                  : candidate
              )
            };
          });
          const next = { ...current, pins };
          setTimeout(() => saveBoard(next), 0);
          return next;
        });
        return;
      }
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
      body: JSON.stringify({ userKey, buttons: board.buttons, pins: board.pins, categories: board.categories ?? undefined, buttonSizes: board.buttonSizes ?? undefined, landingCategory: board.landingCategory ?? '', updatedBy: operatorName })
    }).catch((err) => setError(messageForError(err, 'Could not save the board.')));
  }
  const [dockets, setDockets] = useState<Docket[] | null>(null);
  // Call-aways print WITHOUT a confirm tap: the docket sheet fires straight
  // into the print flow and closes itself after. (For fully silent printing,
  // run the register browser in kiosk-printing mode.)
  const [autoPrint, setAutoPrint] = useState(false);
  const [reservations, setReservations] = useState<FloorReservation[]>([]);
  const [serviceCalls, setServiceCalls] = useState<Array<{ id: string; tableLabel: string; kind: string; createdAt: string }>>([]);
  const [reasons, setReasons] = useState<Record<string, string[]>>({});
  const [home, setHome] = useState<HomeConfig>({ buttons: [], pins: [] });
  // Memoised so the component's IDENTITY is stable across renders: declared
  // inline, every App render made React treat <Mark> as a brand-new element
  // type and remount every icon on the board and the nav — re-parsing its SVG
  // string — on every keystroke and every cart update.
  const iconOverridesForMark = home.categories?.icons;
  const Mark = useMemo(() => {
    function MarkStable({ name, className }: { name: string; className?: string }) {
      const key = iconStyle !== 'off' ? iconKeyFor(name, iconOverridesForMark) : '';
      if (!key) return null;
      return (
        <i className={className ?? 'pos-nav-icon'} dangerouslySetInnerHTML={{ __html: iconSvg(key, iconStyle) }} />
      );
    }
    return MarkStable;
  }, [iconStyle, iconOverridesForMark]);

  // 'sub' renames a nested folder; its key is the folder-path token.
  const [renaming, setRenaming] = useState<null | { kind: 'pin' | 'group' | 'sub'; key: number | string; value: string }>(null);
  const homeRef = useRef(home);
  homeRef.current = home;
  const orderIdRef = useRef<string | null>(null);
  const [eightySix, setEightySix] = useState<Set<string>>(() => new Set(readMenuCache()?.eightySix ?? []));
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>(() => readMenuCache()?.modifierGroups ?? []);
  const [mode86, setMode86] = useState(false);
  const [modSheet, setModSheet] = useState<null | { item: MenuItem; category: string; groups: ModifierGroup[]; chosen: Record<string, string[]>; notes: string }>(null);
  const [variantSheet, setVariantSheet] = useState<MenuItem | null>(null);
  const [voidConfirm, setVoidConfirm] = useState(false);
  // Running inside the ALMA POS iOS shell? Then this handset IS the card
  // reader (Tap to Pay). In Safari this stays false and nothing changes.
  const [nativeTapToPay, setNativeTapToPay] = useState(
    () => typeof window !== 'undefined' && Boolean((window as { almaNative?: { tapToPay?: boolean } }).almaNative?.tapToPay)
  );
  useEffect(() => {
    const onReady = () =>
      setNativeTapToPay(Boolean((window as { almaNative?: { tapToPay?: boolean } }).almaNative?.tapToPay));
    window.addEventListener('alma-native-ready', onReady);
    return () => window.removeEventListener('alma-native-ready', onReady);
  }, []);
  const [lockScreen, setLockScreen] = useState(false);
  // The suite app switcher: which apps a till can hop to, session carried
  // across by a one-time handoff token.
  const [appsOpen, setAppsOpen] = useState(false);
  const [appsBusy, setAppsBusy] = useState<string | null>(null);
  // The "?" tour. Auto-opens the first time each operator lands on a signed-in
  // register (flagged per name in localStorage, so it shows once per person
  // per device) — that the home board follows you is the one thing nobody
  // guesses on their own.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOperator = me === 'loading' || !me ? '' : me.kind === 'staff' ? me.name : me.staffName ?? '';
  const helpSeenKey = helpOperator ? `alma.pos.helpSeen.${helpOperator.toLowerCase()}` : null;
  useEffect(() => {
    if (helpSeenKey && localStorage.getItem(helpSeenKey) !== '1') setHelpOpen(true);
  }, [helpSeenKey]);
  function closeHelp() {
    if (helpSeenKey) localStorage.setItem(helpSeenKey, '1');
    setHelpOpen(false);
  }
  const [lockPin, setLockPin] = useState('');
  const [switchSheet, setSwitchSheet] = useState<null | { pin: string }>(null);
  const [noteSheet, setNoteSheet] = useState<null | { value: string }>(null);
  const [cashCount, setCashCount] = useState<null | { counts: Record<string, string>; expected: number | null }>(null);
  const [dietSheet, setDietSheet] = useState<null | { tags: Array<{ tag: string; seat: number | null }>; custom: string; seat: string }>(null);
  const [fireSheet, setFireSheet] = useState<null | Array<{ course: string; count: number; picked: boolean }>>(null);
  const [guestView, setGuestView] = useState<GuestProfile | null>(null);
  const [coversEdit, setCoversEdit] = useState<string>('');
  const [coversOpen, setCoversOpen] = useState(false);
  const [openFolder, setOpenFolder] = useState<Pin | null>(null);
  // One sheet, three jobs: no `at`/`into` = new folder on the home board;
  // `at` = new subfolder inside the folder at that path; `into` = add items
  // to the existing folder at that path (name/colour hidden).
  const [folderDraft, setFolderDraft] = useState<null | { name: string; c: string; items: string[]; search: string; at?: number[]; into?: number[] }>(null);
  const [customise, setCustomise] = useState(false);
  // Package mode: while ON, every item tapped lands at $0 with an
  // "Included in package" note — the set-menu line carries the money, the
  // kitchen still gets real dishes on real courses. Turns itself off when
  // the sale closes so it can't bleed into the next bill.
  const [pkgMode, setPkgMode] = useState(false);
  useEffect(() => {
    if (!order) setPkgMode(false);
  }, [order]);
  // The banquet picker. `step` counts through the plan's courses; -1 is the
  // covers question that opens it. `picks` is courseId -> recipeId -> heads,
  // which is the whole state of the sheet — everything else is derived.
  const [banquet, setBanquet] = useState<null | {
    plan: SetMenuPlan;
    covers: number;
    step: number;
    picks: Record<string, Record<string, number>>;
  }>(null);
  const [wastage, setWastage] = useState<null | { search: string; recipeId: string; itemName: string; quantity: string; reason: string }>(null);
  // Selling a gift card at the till. The server side of this has existed for a
  // while — PosGiftCardSale, GST-free face value, issued and emailed when the
  // bill settles, cancelled if the bill is refunded — with no way to reach it
  // from the register. This is that way.
  const [giftSale, setGiftSale] = useState<
    null | { amountDollars: string; recipientName: string; recipientEmail: string; code: string; physical: boolean; saving: boolean }
  >(null);
  const [lineAction, setLineAction] = useState<null | { lineId: string; name: string; kind: 'COMP' | 'PRICE_CHANGE'; reason: string; price: string }>(null);
  const [discounting, setDiscounting] = useState<null | { mode: 'percent' | 'amount'; value: string; reason: string }>(null);
  // One chooser for everything you do TO a bill (discount, comp, split,
  // merge, print, void) — so the toolbar stays four buttons and nothing
  // destructive sits beside Charge.
  const [billActions, setBillActions] = useState(false);
  // Selling a gift card at the till: amount, who it's for, how they paid.
  const [giftSell, setGiftSell] = useState<null | {
    amount: string;
    recipientName: string;
    recipientEmail: string;
    code: string;
  }>(null);
  // Codes issued when a bill settles, shown once so staff can write them on
  // the cards they hand over.
  const [giftIssued, setGiftIssued] = useState<Array<{ code: string; amountCents: number }>>([]);
  const [pickLine, setPickLine] = useState<null | 'COMP' | 'PRICE_CHANGE'>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [reader, setReader] = useState<Reader | null>(null);
  const [readerBusy, setReaderBusy] = useState<string | null>(null);
  // Square Terminals paired to this venue, and the charge currently sitting on
  // one of them. `squareCheckout` being non-null is what puts the register into
  // "waiting for the guest to tap" — it must be cleared on every exit path or
  // the pay screen stays stuck.
  const [squareTerminals, setSquareTerminals] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [squareCheckout, setSquareCheckout] = useState<null | { id: string; deviceName: string; status: string }>(null);
  // Reporting a bug from the floor. The register attaches the context, so the
  // person who hit it only has to say what happened.
  const [reporting, setReporting] = useState<null | { text: string; blocking: boolean; sent: boolean }>(null);
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
      const res = await api<{
        user: {
          id: string;
          firstName?: string;
          lastName?: string;
          accountType?: string;
          trainingOnly?: boolean;
          deviceAccount?: boolean;
        } | null;
      }>('/api/auth/me');
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
        setMe({ kind: 'device', staffName, staffList: list.staff, trainingOnly: user.trainingOnly === true });
      } else {
        setMe({
          kind: 'staff',
          name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Staff',
          trainingOnly: user.trainingOnly === true
        });
      }
    } catch {
      setMe(null);
    }
  }, []);

  const refreshOpenOrders = useCallback(async () => {
    // All four in flight together — they were awaited one after another,
    // which cost four VPS round trips where one would do. Each stays
    // independently best-effort: one failing never blocks the others.
    await Promise.allSettled([
      api<Order[]>(`/api/pos/orders?venue=${encodeURIComponent(venue)}`).then(setOpenOrders),
      api<FloorTable[]>(`/api/pos/tables?venue=${encodeURIComponent(venue)}`).then((tables) => {
        setFloorTables(tables);
        setFloorArea((current) => current || tables[0]?.area || '');
      }),
      api<FloorReservation[]>(`/api/pos/floor-reservations?venue=${encodeURIComponent(venue)}`).then(setReservations),
      api<Array<{ id: string; tableLabel: string; kind: string; createdAt: string }>>(
        `/api/pos/service-calls?venue=${encodeURIComponent(venue)}`
      ).then(setServiceCalls)
    ]);
  }, [venue]);

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
        setApiPinToken(null);
        void api('/api/device/pin-logout', { method: 'POST' })
          .then(() => refreshAuth())
          .catch(() => undefined);
      } else {
        setLockScreen(true);
      }
    };
    let timer = window.setTimeout(lock, 60000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, 60000);
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
      const handedOff = await consumeSuiteHandoffToken();
      // The round trip worked — forget we ever bounced.
      if (handedOff) sessionStorage.removeItem(BOUNCE_KEY);
      await refreshAuth();
    })();
  }, [refreshAuth]);

  useEffect(() => {
    localStorage.setItem('alma.pos.venue', venue);
  }, [venue]);

  // Opening the refund dialog: ask the server what can actually go back to a
  // card. Quiet failure — a refund to cash must still work if Square is down.
  useEffect(() => {
    const orderId = refunding?.order.id;
    if (!orderId) {
      setRefundCards([]);
      return;
    }
    void api<Array<{ squarePaymentId: string; refundableCents: number; devices: Array<{ id: string; name: string }> }>>(
      `/api/pos/orders/${orderId}/refundable-cards`
    )
      .then(setRefundCards)
      .catch(() => setRefundCards([]));
  }, [refunding?.order.id]);

  // Which card terminals this venue can charge to. Quiet failure on purpose:
  // Square being unreachable must not stop anyone taking cash.
  useEffect(() => {
    if (!me || me === 'loading') return;
    void api<Array<{ id: string; name: string; status: string }>>(
      `/api/pos/terminals?venue=${encodeURIComponent(venue)}`
    )
      .then((rows) => setSquareTerminals(rows.filter((row) => row.status === 'PAIRED')))
      .catch(() => setSquareTerminals([]));
  }, [venue, me]);

  useEffect(() => {
    if (!me || me === 'loading') return;
    void (async () => {
      try {
        void api<Array<{ name: string }>>('/api/pos/courses')
          // An empty list is not an answer, it is a bad reply: the API seeds
          // the cycle on first read, so it never legitimately has none. Keep
          // the fallback rather than leaving the register with no courses to
          // fire on.
          .then((rows) => { if (rows.length > 0) setCourses(rows.map((row) => row.name)); })
          .catch(() => undefined);
        void api<Record<string, string[]>>('/api/pos/adjust-reasons').then(setReasons).catch(() => undefined);
        const res = await api<MenuPayload>('/api/pos/menu');
        setRawMenu(res.categories);
        setEightySix(new Set(res.eightySix ?? []));
        setModifierGroups(res.modifierGroups ?? []);
        setSetMenuPlans(new Map((res.setMenus ?? []).map((plan) => [plan.recipeId, plan])));
        setAllWines(res.wines ?? []);
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
          const res = JSON.parse(cached) as MenuPayload;
          setRawMenu(res.categories);
          setEightySix(new Set(res.eightySix ?? []));
          setModifierGroups(res.modifierGroups ?? []);
          setSetMenuPlans(new Map((res.setMenus ?? []).map((plan) => [plan.recipeId, plan])));
          setAllWines(res.wines ?? []);
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
          buttonSizes: (config as { buttonSizes?: Record<string, 'w' | 'b'> }).buttonSizes ?? undefined,
          // Legacy pins were plain recipeId strings — normalise to the rich shape.
          pins: (config.pins ?? []).map((pin) =>
            typeof pin === 'string' ? ({ t: 'i', id: pin } as Pin) : (pin as Pin)
          )
        });
        // Management buttons used to live in their own strip. Fold them into
        // the board as pins so they can be moved and sized like anything else.
        setHome((current) => {
          const legacy = current.buttons ?? [];
          if (legacy.length === 0 || current.pins.some((pin) => pin.t === 'm')) return current;
          const next = {
            ...current,
            pins: [...current.pins, ...legacy.filter((key) => MGMT_KEYS.includes(key)).map((key) => ({ t: 'm' as const, key }))],
            buttons: []
          };
          setTimeout(() => saveBoard(next), 0);
          return next;
        });
        setActiveCategory((current) =>
          current && current !== HOME_TAB
            ? current
            : localStorage.getItem('alma.pos.deviceLanding') ||
              landing ||
              // No board built yet? Land on the Full menu instead of an
              // empty Home.
              ((config.pins ?? []).length > 0 ? HOME_TAB : '__all__')
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
        collectIssuedGiftCards(result.id);
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        void refreshOpenOrders();
      } else {
        setOrder(result);
        setCharge({ stage: 'pay', tipCents: 0, amountCents: null });
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
    // Dockets with a printer assigned print DIRECT (the Epson polls for
    // them) — the browser only prints what has no printer of its own.
    if (!dockets.some((docket) => !docket.printerIp)) {
      const closer = setTimeout(() => {
        setDockets(null);
        setAutoPrint(false);
      }, 1400);
      return () => clearTimeout(closer);
    }
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
  // The server builds the docket, but the register knows things the current
  // API doesn't return yet (order type, who took it, when it was opened) —
  // fill them in here so a call-away prints complete either way.
  function stampDockets(rows: Docket[], from: Order): Docket[] {
    const now = new Date().toISOString();
    return rows.map((docket) => ({
      ...docket,
      kind: docket.kind ?? 'FIRE',
      orderType: docket.orderType ?? orderTypeOf(from),
      openedByName: docket.openedByName ?? from.openedByName ?? operatorName,
      firedByName: docket.firedByName ?? operatorName,
      orderedAt: docket.orderedAt ?? from.createdAt,
      firedAt: docket.firedAt ?? now
    }));
  }

  async function fireCourse(name: string) {
    if (!order || order.id.startsWith('local-') || busy) return;
    setBusy(true);
    try {
      const result = await api<{ dockets: Docket[]; sent: number }>(`/api/pos/orders/${order.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ courses: [name], firedByName: operatorName })
      });
      if (result.dockets.length > 0) {
        setAutoPrint(true);
        setDockets(stampDockets(result.dockets, order));
      }
      const stamp = new Date().toISOString();
      setOrder((current) =>
        current
          ? { ...current, lines: current.lines.map((line) => (!line.isGiftCard && (line.course ?? 'NOW') === name && !(line as { sentAt?: string | null }).sentAt ? { ...line, sentAt: stamp } : line)) }
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
      // A gift-card line is never cooked: grouped under NOW it read as a
      // course with food waiting, and its 🔥 flip-flopped forever because
      // /send rightly refuses to stamp it. It gets its own block below.
      if (line.isGiftCard) return;
      const key = line.course ?? courses[0] ?? 'NOW';
      groups.set(key, [...(groups.get(key) ?? []), { line, index }]);
    });
    return [...groups.entries()];
  }, [order, courses]);
  const giftLines = useMemo(
    () => (order?.lines ?? []).map((line, index) => ({ line, index })).filter((entry) => entry.line.isGiftCard),
    [order]
  );

  // Bill lines grouped under their course, in service order.
  const courseGroups = useMemo(() => {
    const groups = new Map<string, Array<{ line: Order['lines'][number]; index: number }>>();
    (order?.lines ?? []).forEach((line, index) => {
      // Null course = NOW, the same default the cart, the fire filter and
      // the docket all use — three different defaults here once meant a
      // line could show under one course and fire under another.
      const key = line.course ?? 'NOW';
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
  const visibleTabs = useMemo(() => visibleTabTokens(menu.map((category) => category.name), tabsConfig), [menu, tabsConfig]);
  // The two tabs that bring their own search bar. Anywhere else the header
  // search is the only one there is, so it stays.
  const pageOwnsSearch = activeCategory === WINE_TAB || activeCategory === '__all__';

  // Nav editing (reorder, group, hide, rename) lives ONLY in the board
  // editor now — the register just reads this config. Board TILES are still
  // editable in place, so their rename stays here.
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

  function commitSubRename(path: number[], rawValue: string) {
    const value = rawValue.trim().slice(0, 40);
    setRenaming(null);
    if (!value) return;
    setHome((current) => {
      const next = { ...current, pins: updateFolderAtPath(current.pins, path, (folder) => ({ ...folder, name: value })) };
      setTimeout(() => saveBoard(next), 0);
      return next;
    });
  }

  const visibleTabsRef = useRef(visibleTabs);
  visibleTabsRef.current = visibleTabs;

  // The editor saves as you go, but a rename is one keystroke per PUT — so
  // the write is debounced and flushed on the way out. State updates stay
  // immediate: the preview must never lag behind the press.
  const boardSaveTimer = useRef<number | null>(null);
  function queueBoardSave(next: HomeConfig) {
    setHome(next);
    if (boardSaveTimer.current) window.clearTimeout(boardSaveTimer.current);
    boardSaveTimer.current = window.setTimeout(() => {
      boardSaveTimer.current = null;
      saveBoard();
    }, 500);
  }
  function flushBoardSave() {
    if (!boardSaveTimer.current) return;
    window.clearTimeout(boardSaveTimer.current);
    boardSaveTimer.current = null;
    saveBoard();
  }

  // Leaving the board editor: editing can dissolve the group (or shuffle the
  // folder) the register was sitting on, so send it somewhere that still
  // exists rather than to an empty screen.
  function closeBoardEditor() {
    flushBoardSave();
    setActiveCategory((current) => {
      if (current.startsWith('__group__')) {
        const name = current.slice('__group__'.length);
        return homeRef.current.categories?.groups.some((group) => group.name === name) ? current : HOME_TAB;
      }
      if (current.startsWith('__folder__')) {
        const path = parseFolderPath(current);
        return path && folderAtPath(homeRef.current.pins, path) ? current : HOME_TAB;
      }
      return current;
    });
    setBoardEdit(false);
    setBoardPage(0);
    setView('register');
  }

  // Measure how many standard tiles fit without scrolling; big/wide tiles
  // count as 4/2 slots. Under-estimating is safe (a roomier page), scrolling
  // away is not.
  const [searchTerm, setSearchTerm] = useState('');
  // The chip rows on Full menu and Wine cost about a hundred pixels of list.
  // Worth it while you are narrowing, dead weight once you know what you are
  // looking for — so they fold, and the choice sticks to the device. Nothing
  // is lost while they are folded: the tally and Clear stay on the search
  // line, so a filter left on is still visible.
  const [chipsOpen, setChipsOpen] = useState(() => {
    try {
      return localStorage.getItem('alma.pos.filterChips') !== 'off';
    } catch {
      return true;
    }
  });
  const toggleChips = useCallback(() => {
    setChipsOpen((open) => {
      try {
        localStorage.setItem('alma.pos.filterChips', open ? 'off' : 'on');
      } catch {
        /* private browsing — the fold still works, it just won't be remembered */
      }
      return !open;
    });
  }, []);
  // Switching to Full menu or Wine takes the header search off screen. Its
  // term has to go with it — a filter still running behind a box you can no
  // longer see reads as a page with items missing.
  useEffect(() => {
    if (pageOwnsSearch && searchTerm) setSearchTerm('');
  }, [pageOwnsSearch, searchTerm]);
  useEffect(() => {
    const el = boardPagerRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth - 32;
      const scale = textScaleValue(textScale);
      // Phones don't page the board — they scroll it. The row maths below is
      // circular there anyway: the pager's clientHeight is its own content
      // height once the document is the scroller, so "how many rows fit"
      // answered "however many are already there". One page, every pin, and
      // theme.css lets the document scroll through it.
      if (window.matchMedia('(max-width: 700px)').matches) {
        const tileW = 104; // phone tiles don't scale their column (theme.css)
        setBoardCols(Math.max(2, Math.floor((width + 10) / (tileW + 10))));
        setBoardSlots(10000);
        return;
      }
      const height = el.clientHeight - 22;
      // Tiles grow with the text size, so the "how many fit" maths has to use
      // the same multiplier — otherwise turning the text up just pushes tiles
      // off the bottom of the page instead of onto the next one.
      const tileW = (el.clientWidth < 720 ? 104 : 145) * scale;
      const tileH = (el.clientWidth < 720 ? 80 : 98) * scale;
      const cols = Math.max(2, Math.floor((width + 10) / (tileW + 10)));
      const rows = Math.max(1, Math.floor((height + 10) / (tileH + 10)));
      setBoardSlots(cols * rows);
      setBoardCols(cols);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeCategory, design, view, searchTerm, textScale]);

  const pinPages = useMemo(
    // Trailing action tiles (Edit this page / the edit-mode set) render on
    // every page — hold seats for them so nothing clips.
    () => paginatePins(home.pins, Math.max(2, boardSlots - (boardEdit ? 5 : 1))),
    [home.pins, boardSlots, boardEdit]
  );
  pinPageCountRef.current = pinPages.length;
  const boardPageSafe = Math.min(boardPage, pinPages.length - 1);

  useEffect(() => {
    if (boardPage > pinPages.length - 1) setBoardPage(Math.max(0, pinPages.length - 1));
  }, [pinPages.length, boardPage]);

  // The grid reads a debounced term so a fast typist isn't re-filtering and
  // re-rendering hundreds of tiles on every character.

  const visibleItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (term) return menu.flatMap((category) => category.items).filter((item) => item.title.toLowerCase().includes(term)).slice(0, 60);
    return (menu.find((category) => category.name === activeCategory)?.items ?? []).filter((item) => !item.variantOf);
  }, [menu, activeCategory, searchTerm]);

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
    // local- = offline quick sale; pending- = a sale whose server order is
    // still being created (optimistic first tap). Both stay local — pending-
    // lines are re-PUT by the creation loop once the real order id exists.
    if (order.id.startsWith('local-') || order.id.startsWith('pending-')) {
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
    // Optimistic, functionally applied, and sequence-guarded: two quick taps
    // used to race — the FIRST tap's server echo (carrying one line) landed
    // after the second optimistic update and wholesale-replaced the cart, so
    // the second item visibly vanished until its own echo arrived. Only the
    // latest push's echo is allowed to settle now.
    const seq = ++pushSeqRef.current;
    setOrder((current) => (current && current.id === order.id ? { ...current, lines: next } : current));
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ lines: next })
      });
      setOrder((current) => {
        if (!current || current.id !== updated.id) return current;
        if (pushSeqRef.current !== seq) return current; // a newer push owns the cart
        return updated;
      });
    } catch (err) {
      setError(messageForError(err, 'Could not save the order.'));
      try {
        const server = await api<Order>(`/api/pos/orders/${order.id}`);
        setOrder((current) =>
          current && current.id === server.id && pushSeqRef.current === seq ? server : current
        );
      } catch {
        /* keep local state */
      }
    }
  }

  // recipeId → category, built once per menu. This used to be a nested scan
  // run for every tile on every render — with 176 items across 23 categories
  // that was tens of thousands of comparisons per keystroke.
  const categoryByRecipe = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of menu) {
      for (const item of category.items) map.set(item.recipeId, category.name);
    }
    return map;
  }, [menu]);
  // recipeId → item, for the same reason: the board resolved every pin with
  // a flatMap().find() over the whole menu, per tile, per render.
  const itemByRecipe = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const category of menu) {
      for (const item of category.items) map.set(item.recipeId, item);
    }
    return map;
  }, [menu]);
  // A pin can name the OTHER venue's copy of a dish: the menu is duplicated
  // per venue (Avalon and St Alma each carry their own "Catalina Sounds
  // 750mL" with different recipeIds), so a folder built on one register held
  // ids the other venue's menu never contains — those entries silently
  // rendered nothing, and a "40 item" folder showed ten ("the bottom of the
  // items is cut off"). Resolve such ids to this venue's twin by title.
  const visibleByTitle = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const category of menu) {
      for (const item of category.items) if (!map.has(item.title)) map.set(item.title, item);
    }
    return map;
  }, [menu]);
  const titleByRecipeAllVenues = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of rawMenu) {
      for (const item of category.items) map.set(item.recipeId, item.title);
    }
    return map;
  }, [rawMenu]);
  // The explicit twin link, when the backfill has run: canonical group id →
  // this venue's member. Falls back to title matching for unlinked recipes.
  const visibleByCanonical = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const category of menu) {
      for (const item of category.items) {
        map.set(item.canonicalId ?? item.recipeId, item);
      }
    }
    return map;
  }, [menu]);
  const canonicalByRecipeAllVenues = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of rawMenu) {
      for (const item of category.items) map.set(item.recipeId, item.canonicalId ?? item.recipeId);
    }
    return map;
  }, [rawMenu]);
  function resolvePinItem(recipeId: string): MenuItem | undefined {
    const direct = itemByRecipe.get(recipeId);
    if (direct) return direct;
    const canonical = canonicalByRecipeAllVenues.get(recipeId);
    const viaLink = canonical ? visibleByCanonical.get(canonical) : undefined;
    if (viaLink) return viaLink;
    const title = titleByRecipeAllVenues.get(recipeId);
    return title ? visibleByTitle.get(title) : undefined;
  }
  const categoryOfRef = useRef(categoryByRecipe);
  categoryOfRef.current = categoryByRecipe;
  function categoryOf(item: MenuItem): string {
    return categoryOfRef.current.get(item.recipeId) ?? '';
  }

  // What a folder tile's count means: distinct dishes THIS venue can open,
  // subfolders included — a folder may hold both venues' copies of a wine.
  function folderDishCount(folder: FolderPin): number {
    const gather = (f: FolderPin): string[] => [...f.items, ...(f.folders ?? []).flatMap(gather)];
    return new Set(gather(folder).map((id) => resolvePinItem(id)?.recipeId).filter(Boolean)).size;
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
    const plan = setMenuPlans.get(item.recipeId);
    if (plan && plan.courses.length > 0) {
      openBanquet(plan);
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

  // ── The wine list ─────────────────────────────────────────────────────
  // Food is a grid because a grid works: forty dishes, tapped by sight. Wine
  // is not like that — the guest asks for a grape, a region or a number, never
  // for a tile. So wine gets a list with the pour prices on the row, and the
  // filters that answer the three questions actually asked at the table.
  const wines = useMemo(
    () => allWines.filter((wine) => wine.venue === venue),
    [allWines, venue]
  );

  // Colour comes off the menu's own section headings, because the printed list
  // is already organised by grape — "Riesling" says white without being told.
  const wineColour = (wine: RegisterWine): string => {
    const section = (wine.section ?? '').toLowerCase();
    if (/skin|orange/.test(section)) return 'orange';
    if (/bubbl|sparkling|champagne/.test(section)) return 'sparkling';
    if (/ros/.test(section)) return 'rose';
    if (/sweet|fortified|muscat/.test(section)) return 'fortified';
    if (/riesling|chardonnay|sauvignon|semillon|white/.test(section)) return 'white';
    return 'red';
  };
  const WINE_COLOURS = [
    { id: 'white', label: 'White' },
    { id: 'red', label: 'Red' },
    { id: 'rose', label: 'Rosé' },
    { id: 'sparkling', label: 'Sparkling' },
    { id: 'orange', label: 'Skin contact' },
    { id: 'fortified', label: 'Fortified' }
  ];
  // Bands as a guest says them, not in even steps.
  const WINE_BANDS = [
    { id: 'u80', label: 'Under $80', test: (cents: number) => cents < 8000 },
    { id: '80-120', label: '$80–120', test: (cents: number) => cents >= 8000 && cents < 12000 },
    { id: '120-200', label: '$120–200', test: (cents: number) => cents >= 12000 && cents < 20000 },
    { id: '200+', label: '$200+', test: (cents: number) => cents >= 20000 }
  ];
  const WINE_PAIRS = [
    { id: 's', label: '○ Seafood' },
    { id: 'r', label: '△ Rich & grilled' },
    { id: 'v', label: '◇ Veg & cheese' }
  ];
  const WINE_MARK: Record<string, string> = { s: '○', r: '△', v: '◇' };
  // The printed list's running order, so the register and the list in the
  // guest's hand are organised the same way.
  const WINE_SECTIONS = [
    'Bubbles', 'White', 'Riesling', 'Sauvignon Blanc & Semillon', 'Chardonnay', 'Other whites',
    'Skin contact & orange', 'Rosé', 'Red', 'Pinot Noir', 'Shiraz', 'Cabernet & Bordeaux blends',
    'Other reds', 'Mexican wine', 'Sweet & fortified'
  ];
  const WINE_BANDS_ORDER = [
    'Crisp & refreshing', 'Aromatic & textural', 'Mineral & complex',
    'Light & juicy', 'Medium-bodied & versatile', 'Full-bodied & bold'
  ];
  const rankIn = (list: string[], value: string | null) => {
    const index = list.indexOf(value ?? '');
    return index === -1 ? list.length : index;
  };

  const [wineFilters, setWineFilters] = useState<{
    q: string;
    pour: 'any' | 'glass' | 'bottle';
    colours: string[];
    band: string | null;
    pairs: string[];
    open: string | null;
  }>({ q: '', pour: 'any', colours: [], band: null, pairs: [], open: null });

  /**
   * Filters for the full menu, which is the same idea as the wine list applied
   * to everything else: the tiles stay the fast way to ring a dish somebody
   * already knows, and this is the page you open to answer "what have we got".
   *
   * Deliberately NOT the wine filters. Grape and price band are what you ask a
   * wine list; a food menu gets asked what section it is in, whether it comes
   * out of the kitchen or the bar, and whether it is still on. The API already
   * labels every category FOOD, BEVERAGE or SET_MENU (pos.service kindBucket),
   * so the kitchen/bar split is read rather than guessed.
   *
   * There is no dietary filter, because no dietary data exists to filter on —
   * Recipe has no allergen or dietary field, and the `dietary` column in the
   * schema belongs to PosOrder: it is the GUEST's requirement on a booking,
   * not a property of a dish. Inventing one here would put a confident-looking
   * "GF" on a plate nobody had checked.
   */
  const [menuFilters, setMenuFilters] = useState<{
    q: string;
    kind: 'any' | 'FOOD' | 'BEVERAGE' | 'SET_MENU';
    avail: 'any' | 'on' | 'off';
    /** A guest requirement, in the booking parser's own vocabulary. */
    diet: string | null;
  }>({ q: '', kind: 'any', avail: 'any', diet: null });

  /**
   * Does this dish survive the full-menu filters? Every term must appear
   * somewhere in the title, so "fish taco" narrows rather than widening the
   * way an OR would.
   */
  const menuMatch = (item: MenuItem, categoryKind: string) => {
    if (menuFilters.kind !== 'any' && categoryKind !== menuFilters.kind) return false;
    if (menuFilters.diet) {
      const verdict = dishAnswersGuest(item.dietary ?? [], menuFilters.diet);
      if (guestTagIsAllergy(menuFilters.diet)) {
        // An allergy can only ever rule dishes OUT — nothing in the tag
        // vocabulary is a positive "checked, allergen-free" claim, so the
        // best any dish can be is "not marked as containing it". Drop the
        // marked ones, keep the rest, and the note under the chips says
        // plainly that unmarked is unverified, not safe.
        if (verdict === 'no') return false;
      } else {
        // A diet: 'yes' and 'ask' only. A dish nobody has tagged is UNKNOWN,
        // and an unknown dish must never be offered to somebody who asked for
        // gluten free — that is the whole reason this filter exists rather
        // than the floor guessing from the title.
        if (verdict !== 'yes' && verdict !== 'ask') return false;
      }
    }
    const off = eightySix.has(item.recipeId);
    if (menuFilters.avail === 'on' && off) return false;
    if (menuFilters.avail === 'off' && !off) return false;
    const terms = menuFilters.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const hay = `${item.title} ${item.printTitle ?? ''}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  };

  const menuFiltersOn =
    menuFilters.q.trim() !== '' || menuFilters.kind !== 'any' || menuFilters.avail !== 'any' || menuFilters.diet !== null;

  /** How many dishes survive the filters — the bar's count and the empty state
      read the same number rather than each working it out. */
  const menuShownCount = useMemo(() => {
    // Count exactly the categories the Full menu RENDERS — the visible tabs
    // plus every folder's subtree. Counting all of `menu` overstated the
    // number whenever a category was nav-hidden, and made a search that only
    // matched an unrendered dish show a count over a blank list.
    const shownCats = new Set<string>();
    for (const token of visibleTabs) {
      if (token.startsWith('g:')) for (const name of groupSubtreeCats(tabsConfig, token.slice(2))) shownCats.add(name);
      else shownCats.add(token);
    }
    return menu.reduce(
      (sum, category) =>
        shownCats.has(category.name)
          ? sum + category.items.filter((item) => !item.variantOf && menuMatch(item, category.kind)).length
          : sum,
      0
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, menuFilters, eightySix, visibleTabs, tabsConfig]);

  /** Cheapest way to buy the whole bottle, or the dearest pour if there is none. */
  const wineFrom = (wine: RegisterWine) =>
    wine.pours.find((pour) => pour.ml >= 700)?.priceCents ?? Math.max(...wine.pours.map((pour) => pour.priceCents));
  const winePoured = (wine: RegisterWine) => wine.pours.some((pour) => pour.ml < 700);
  const wineOff = (wine: RegisterWine) => wine.pours.every((pour) => eightySix.has(pour.recipeId));

  const sortedWines = useMemo(
    () =>
      wines.slice().sort(
        (a, b) =>
          rankIn(WINE_SECTIONS, a.section) - rankIn(WINE_SECTIONS, b.section) ||
          rankIn(WINE_BANDS_ORDER, a.styleBand) - rankIn(WINE_BANDS_ORDER, b.styleBand) ||
          wineFrom(a) - wineFrom(b)
      ),
    [wines]
  );

  const shownWines = useMemo(() => {
    const band = WINE_BANDS.find((entry) => entry.id === wineFilters.band);
    const terms = wineFilters.q.toLowerCase().split(/\s+/).filter(Boolean);
    return sortedWines.filter((wine) => {
      // Search covers everything a guest might say — the grape and the region
      // as readily as the label, and the tasting note for "something chalky".
      if (terms.length > 0) {
        const hay = `${wine.name} ${wine.grape ?? ''} ${wine.region ?? ''} ${wine.origin ?? ''} ${wine.section ?? ''} ${wine.styleBand ?? ''} ${wine.tastingNote ?? ''} ${wine.vintage ?? 'NV'}`.toLowerCase();
        if (!terms.every((term) => hay.includes(term))) return false;
      }
      if (wineFilters.pour === 'glass' && !winePoured(wine)) return false;
      if (wineFilters.pour === 'bottle' && winePoured(wine)) return false;
      if (wineFilters.colours.length > 0 && !wineFilters.colours.includes(wineColour(wine))) return false;
      if (band && !band.test(wineFrom(wine))) return false;
      if (wineFilters.pairs.length > 0 && !wine.pairsWith.some((mark) => wineFilters.pairs.includes(mark))) return false;
      return true;
    });
  }, [sortedWines, wineFilters, eightySix]);

  // What a sommelier does in their head, for when the bottle is gone or it is
  // over their number: same grape first, then same region, then same country,
  // nearest by price — and never something that has run out.
  function similarWines(wine: RegisterWine) {
    return wines
      .filter((other) => other.id !== wine.id && !wineOff(other) && (other.grape === wine.grape || other.region === wine.region || other.origin === wine.origin))
      .map((other) => ({
        wine: other,
        why: other.grape === wine.grape ? 'Same grape' : other.region === wine.region ? 'Same region' : `Also ${other.origin ?? ''}`,
        rank: (other.grape === wine.grape ? 0 : other.region === wine.region ? 1 : 2) * 1e7 + Math.abs(wineFrom(other) - wineFrom(wine))
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 3);
  }

  // A pour is an ordinary catalogue item, so selling one goes through the same
  // path as any tile: modifiers, course defaults, the optimistic first tap.
  function addWinePour(wine: RegisterWine, pour: RegisterWinePour) {
    if (eightySix.has(pour.recipeId)) {
      setError(`${wine.name} is 86'd (sold out).`);
      return;
    }
    void addItemDirect(
      { recipeId: pour.recipeId, title: pour.title, printTitle: pour.printName, priceCents: pour.priceCents, venue: wine.venue },
      [],
      ''
    );
  }

  // ── Banquet picker ────────────────────────────────────────────────────
  // A set menu is one price for a table, but the kitchen needs the dishes and
  // the reporting needs the mix. So the register asks: how many covers, then
  // course by course, how many of each. Everything below is derived from
  // `picks` — how many are spoken for, what's left, whether we can move on.

  // Courses worth a screen. A course offering exactly one dish is not a
  // question — it gets filled for the whole table at commit. (Unless that one
  // dish is 86'd, in which case service needs to see it rather than have the
  // register quietly ring something the kitchen cannot cook.)
  // What the kitchen actually plates for this many guests. A course with no
  // perGuests is one serve each; "shared between 4" rounds up, because half a
  // board of fries is not a thing anyone can send.
  function banquetPortions(course: SetMenuCourse, heads: number): number {
    if (!course.perGuests || course.perGuests <= 1) return heads;
    return Math.ceil(heads / course.perGuests);
  }

  // Which course a banquet dish FIRES on, which is not the same thing as what
  // the course is called. The firing order set in Stock wins. A course name is
  // only accepted when it is a course the register actually cycles through -
  // the seeded courses are named after their dish, and taking those at face
  // value gave a table of four fourteen one-dish "courses" on the fire screen.
  function courseFiresOn(course: SetMenuCourse): string {
    if (course.posCourse) return course.posCourse;
    return courses.includes(course.name) ? course.name : 'NOW';
  }

  function askableCourses(plan: SetMenuPlan): SetMenuCourse[] {
    return plan.courses.filter(
      (course) => course.options.length !== 1 || eightySix.has(course.options[0]!.recipeId)
    );
  }

  function openBanquet(plan: SetMenuPlan) {
    setBanquet({
      // The table's covers if service has already set them: the common case is
      // a booked function where the number is known before anyone orders.
      covers: order?.covers && order.covers > 0 ? order.covers : 0,
      plan,
      step: -1,
      picks: {}
    });
  }

  // Heads spoken for in a course, and how many that course still owes.
  function banquetChosen(courseId: string): number {
    return Object.values(banquet?.picks[courseId] ?? {}).reduce((sum, count) => sum + count, 0);
  }
  function banquetOwed(course: SetMenuCourse, covers: number): number {
    return covers * course.pick;
  }

  function banquetPick(course: SetMenuCourse, recipeId: string, delta: number) {
    setBanquet((current) => {
      if (!current) return current;
      const forCourse = current.picks[course.id] ?? {};
      const owed = banquetOwed(course, current.covers);
      const spoken = Object.values(forCourse).reduce((sum, count) => sum + count, 0);
      // Never past what the table owes — a miscount here is a wrong docket.
      const room = delta > 0 ? Math.min(delta, owed - spoken) : delta;
      const next = Math.max(0, (forCourse[recipeId] ?? 0) + room);
      return {
        ...current,
        picks: { ...current.picks, [course.id]: { ...forCourse, [recipeId]: next } }
      };
    });
  }

  // "Rest get this" — the one tap that finishes a course. Eleven of the
  // eighteen are spoken for, everyone else is having the chicken.
  function banquetFill(course: SetMenuCourse, recipeId: string) {
    setBanquet((current) => {
      if (!current) return current;
      const forCourse = current.picks[course.id] ?? {};
      const spoken = Object.values(forCourse).reduce((sum, count) => sum + count, 0);
      const left = banquetOwed(course, current.covers) - spoken;
      if (left <= 0) return current;
      return {
        ...current,
        picks: { ...current.picks, [course.id]: { ...forCourse, [recipeId]: (forCourse[recipeId] ?? 0) + left } }
      };
    });
  }

  // The package line carries the money; every dish under it rings at $0 (or
  // at its supplement) with `packagedBy` pointing back at the menu. That stamp
  // is what lets the bill group them and the banquet report tell an included
  // dish from a comped one.
  function commitBanquet() {
    if (!banquet) return;
    const { plan, covers, picks } = banquet;
    const lines: OrderLine[] = [
      {
        recipeId: plan.recipeId,
        name: plan.title,
        printName: null,
        unitPriceCents: plan.salePriceCents ?? 0,
        quantity: covers,
        // Explicitly NOW rather than null: the cart groups a course-less line
        // under NOW but labels its chip "Mains", and a bill that disagrees
        // with itself is the kind of small wrongness staff stop trusting.
        course: 'NOW',
        modifiers: null,
        notes: null
      }
    ];
    // Fixed components: nobody chose them, but the kitchen still plates them.
    // perGuests = shared between N, so eighteen covers want five boards of
    // bread between four, not eighteen.
    for (const component of plan.fixed) {
      const quantity = component.perGuests && component.perGuests > 0
        ? Math.ceil(covers / component.perGuests)
        : Math.max(1, Math.round(component.quantity * covers));
      if (quantity <= 0) continue;
      lines.push({
        recipeId: component.recipeId,
        name: component.name,
        printName: component.printName,
        unitPriceCents: 0,
        quantity,
        course: targetCourse ?? defaultCourse('FOOD'),
        modifiers: null,
        notes: null,
        packagedBy: plan.recipeId
      });
    }
    const asked = new Set(askableCourses(plan).map((course) => course.id));
    for (const course of plan.courses) {
      for (const option of course.options) {
        // One dish, no question asked: everyone is having it.
        const heads = asked.has(course.id)
          ? picks[course.id]?.[option.recipeId] ?? 0
          : covers * course.pick;
        if (heads <= 0) continue;
        // Heads are what the guests want; portions are what the kitchen
        // plates. A side shared between four sends two boards to a table of
        // eight, the same rule the fixed components above already follow.
        const portions = banquetPortions(course, heads);
        lines.push({
          recipeId: option.recipeId,
          name: option.title,
          printName: null,
          // A supplement is real money on the bill — the eye fillet upgrade
          // is charged per guest who took it, on top of the package. On a
          // shared course it is charged per SERVE, because upgrading a board
          // eight people share is one upgrade, not eight.
          unitPriceCents: option.supplementCents,
          quantity: portions,
          course: courseFiresOn(course),
          modifiers: null,
          notes: null,
          packagedBy: plan.recipeId
        });
      }
    }
    setBanquet(null);
    // Everything the banquet touches opens, so service sees it land.
    setCourseOpen((current) => {
      const next = { ...current };
      for (const line of lines) next[line.course ?? 'NOW'] = true;
      return next;
    });
    void addLines(lines, covers);
  }

  // Add several lines in one go — what the banquet picker commits. No
  // optimistic path here on purpose: the picker has already taken a few
  // seconds, and a table this size wants its covers on the order as well.
  async function addLines(lines: OrderLine[], covers?: number) {
    if (lines.length === 0) return;
    if (order && (order.id.startsWith('local-') || order.id.startsWith('pending-'))) {
      // A sale whose server order doesn't exist yet: merge locally and let the
      // creation loop re-PUT the lot, exactly as a tile tap would.
      void pushLines([...order.lines, ...lines]);
      return;
    }
    setBusy(true);
    try {
      let target = order;
      if (!target) {
        target = await api<Order>('/api/pos/orders', {
          method: 'POST',
          body: JSON.stringify({
            venue,
            openedByName: operatorName || undefined,
            training: training || undefined,
            ...(covers ? { covers } : {})
          })
        });
      } else if (covers && !target.covers) {
        // The picker just asked how many are eating; the docket header and
        // every covers-based report want that same number.
        target = await api<Order>(`/api/pos/orders/${target.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ covers })
        });
      }
      const updated = await api<Order>(`/api/pos/orders/${target.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ lines: [...target.lines, ...lines] })
      });
      setOrder(updated);
      setOpenFolder(null);
      setOffline(false);
    } catch (err) {
      setError(messageForError(err, 'Could not add the set menu.'));
    } finally {
      setBusy(false);
    }
  }

  async function addItemDirect(item: MenuItem, modifiers: Array<{ name: string; priceCents: number }>, notes: string) {
    const delta = modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0);
    const line: OrderLine = {
      recipeId: item.recipeId,
      name: item.title,
      printName: item.printTitle || null,
      unitPriceCents: pkgMode ? 0 : item.priceCents + delta,
      quantity: 1,
      course: targetCourse ?? defaultCourse(kindByRecipe.get(item.recipeId) ?? 'FOOD'),
      modifiers: modifiers.length ? modifiers : null,
      notes: pkgMode ? [notes, 'Included in package'].filter(Boolean).join(' · ') : notes || null
    };
    // The course the item lands in opens so you see it arrive.
    setCourseOpen((current) => ({ ...current, [line.course ?? 'NOW']: true }));
    if (!order) {
      // Optimistic first tap. The old path awaited TWO round trips (create,
      // then lines) with the board greyed out before anything appeared — the
      // register's one visibly slow beep. Now the sale paints immediately as
      // a pending- draft; tiles stay live and queue into it via pushLines'
      // local branch, while `busy` still gates charge/management until the
      // real order exists. Money stays server-authoritative: the draft is
      // display-only and every line is re-PUT until the server has the lot.
      const subtotal = line.unitPriceCents * line.quantity;
      const surcharge = offlineSurcharge(subtotal, cachedRules);
      const draftId = `pending-${Date.now()}`;
      setOrder({
        id: draftId,
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
      setBusy(true);
      try {
        const created = await api<Order>('/api/pos/orders', {
          method: 'POST',
          body: JSON.stringify({ venue, openedByName: operatorName || undefined, training: training || undefined })
        });
        // PUT whatever the draft holds, and keep re-PUTting until no taps
        // landed while the previous PUT was in flight. Converges in one
        // extra pass in practice; the identity check is what detects taps.
        let sent = orderNow.current?.id === draftId ? orderNow.current.lines : [line];
        let updated = await api<Order>(`/api/pos/orders/${created.id}/lines`, {
          method: 'PUT',
          body: JSON.stringify({ lines: sent })
        });
        while (orderNow.current?.id === draftId && orderNow.current.lines !== sent) {
          sent = orderNow.current.lines;
          updated = await api<Order>(`/api/pos/orders/${created.id}/lines`, {
            method: 'PUT',
            body: JSON.stringify({ lines: sent })
          });
        }
        setOrder(updated);
        setOffline(false);
      } catch (err) {
        if (isNetworkError(err)) {
          // Offline quick sale: the draft simply becomes a LOCAL order the
          // charge flow understands, keeping every line tapped so far.
          setOffline(true);
          setOrder((current) =>
            current && current.id === draftId ? { ...current, id: `local-${Date.now()}` } : current
          );
        } else {
          setError(messageForError(err, 'Could not start the sale.'));
          setOrder((current) => (current && current.id === draftId ? null : current));
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    // Modifier'd lines never merge — each configuration is its own line.
    // Package lines DO stack (same dish, same auto-note): a banquet's four
    // barramundi should read 4× on the docket, not four lines of one.
    const existing = modifiers.length === 0 && (!notes || pkgMode)
      ? order.lines.find(
          (candidate) =>
            candidate.recipeId === item.recipeId &&
            !candidate.modifiers &&
            (candidate.notes ?? null) === (line.notes ?? null) &&
            candidate.unitPriceCents === line.unitPriceCents &&
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
            printName: item.printTitle || null,
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

  /**
   * Put a gift card on the bill.
   *
   * The card is NOT created here. It becomes real when the bill is paid —
   * that is where the server activates it, emails the recipient and, if the
   * bill is later refunded in full, cancels it again. Selling the card and
   * taking the money are the same transaction, which is the point: the guest
   * pays for it on the same screen as everything else, and nobody has to
   * remember to go and issue it afterwards.
   *
   * A gift card also needs a bill to sit on, so a walk-in buying nothing else
   * gets one opened for them.
   */
  async function addGiftCardToBill() {
    if (!giftSale) return;
    const dollars = Number(giftSale.amountDollars);
    if (!Number.isFinite(dollars) || dollars < 5 || dollars > 1000) {
      setError('A gift card is between $5 and $1000.');
      return;
    }
    if (giftSale.recipientEmail.trim() && !giftSale.recipientEmail.includes('@')) {
      setError('That email address looks wrong — check it before charging.');
      return;
    }
    setGiftSale({ ...giftSale, saving: true });
    setError(null);
    try {
      let target = order;
      // A pending- draft is display-only and has no server id to hang a sale
      // on, so it cannot take one either.
      if (!target || target.id.startsWith('pending-')) {
        target = await api<Order>('/api/pos/orders', {
          method: 'POST',
          body: JSON.stringify({ venue, openedByName: operatorName || undefined, training: training || undefined })
        });
      }
      const updated = await api<Order>(`/api/pos/orders/${target.id}/gift-cards`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: Math.round(dollars * 100),
          code: giftSale.physical ? giftSale.code.trim().toUpperCase() || undefined : undefined,
          recipientName: giftSale.recipientName.trim() || undefined,
          recipientEmail: giftSale.recipientEmail.trim() || undefined
        })
      });
      setOrder(updated);
      setGiftSale(null);
      setView('register');
      setInfo(
        giftSale.physical
          ? `$${dollars} card on the bill — write ${giftSale.code.trim().toUpperCase() || 'the number'} on the physical card. It goes live when the bill is paid.`
          : giftSale.recipientEmail.trim()
            ? `$${dollars} card on the bill — emailed to ${giftSale.recipientEmail.trim()} once the bill is paid.`
            : `$${dollars} card on the bill. It goes live when the bill is paid.`
      );
    } catch (err) {
      setError(messageForError(err, 'Could not add the gift card.'));
      setGiftSale((current) => (current ? { ...current, saving: false } : current));
    }
  }

  // Tap to Pay: the shell collects the card on this phone, then the payment
  // is recorded against the bill exactly like any other card tender.
  async function takeTapToPay() {
    if (!order || !charge || busy) return;
    const amountCents = (charge.amountCents ?? balance) + charge.tipCents;
    const bridge = (window as { almaNative?: { charge?: (request: unknown) => Promise<{ paymentIntentId?: string }> } }).almaNative;
    if (!bridge?.charge) {
      setError('Tap to Pay needs the ALMA POS app on this device.');
      return;
    }
    setBusy(true);
    try {
      // We hold the session, so we mint both: the reader's connection token
      // and the intent on THIS venue's Stripe account. The shell only drives
      // the card — it has no session of its own.
      const [connection, intent] = await Promise.all([
        api<{ secret: string }>('/api/pos/terminal/connection-token', {
          method: 'POST',
          body: JSON.stringify({ venue })
        }),
        api<{ clientSecret: string }>('/api/pos/terminal/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            amountCents,
            venue,
            description: `ALMA ${venue} · ${order.tableLabel ? `table ${order.tableLabel}` : `bill #${order.orderNumber}`}`
          })
        })
      ]);
      const result = await bridge.charge({
        amountCents,
        clientSecret: intent.clientSecret,
        connectionToken: connection.secret
      });
      const updated = await api<Order>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          method: 'STRIPE_TERMINAL',
          amountCents: charge.amountCents ?? balance,
          tipCents: charge.tipCents,
          reference: result.paymentIntentId
        })
      });
      setReceipt(updated as Order & { changeCents?: number | null });
      setOrder(null);
      setCharge(null);
      void refreshOpenOrders();
    } catch (err) {
      setError(messageForError(err, 'The card was not charged.'));
    } finally {
      setBusy(false);
    }
  }

  // Where the split screen goes next. With a card machine paired the guest
  // picks their own tip on it, so the register never asks — the tip screen is
  // for cash and EFTPOS, where nobody else can.
  // Whatever the browser last complained about. A staff member reporting
  // "it went weird" is far more useful with the actual exception attached.
  const lastClientError = useRef<string>('');
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      lastClientError.current = `${event.message} @ ${event.filename}:${event.lineno}`;
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      lastClientError.current = `unhandled rejection: ${String(event.reason).slice(0, 300)}`;
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  async function sendBugReport() {
    if (!reporting || busy) return;
    setBusy(true);
    try {
      await api('/api/pos/bug-reports', {
        method: 'POST',
        body: JSON.stringify({
          venue,
          body: reporting.text,
          severity: reporting.blocking ? 'BLOCKING' : 'NORMAL',
          screen: view,
          orderId: order?.id ?? null,
          reportedBy: operatorName || null,
          appVersion: document.querySelector('script[src*="/assets/"]')?.getAttribute('src') ?? null,
          userAgent: navigator.userAgent,
          clientError: lastClientError.current || null
        })
      });
      setReporting({ ...reporting, sent: true });
    } catch (err) {
      setError(messageForError(err, 'Could not send the report.'));
    } finally {
      setBusy(false);
    }
  }

  const tipStage = squareTerminals.length > 0 ? ('method' as const) : ('tip' as const);

  // Turn one bill into N bills of its own — 71 (1), 71 (2), 71 (3) — each
  // with a share of every item. Each is then an ordinary bill: its guest taps
  // their own card and picks their own tip on the machine.
  async function splitIntoBills(ways: number) {
    if (!order || busy) return;
    setBusy(true);
    setError(null);
    try {
      const bills = await api<Order[]>(`/api/pos/orders/${order.id}/split-evenly`, {
        method: 'POST',
        body: JSON.stringify({ ways })
      });
      setCharge(null);
      setOrder(null);
      await refreshOpenOrders();
      setInfo(`Split into ${bills.length} bills — ${bills.map((bill) => bill.tableLabel).join(', ')}`);
    } catch (err) {
      setError(messageForError(err, 'Could not split the bill.'));
    } finally {
      setBusy(false);
    }
  }

  // Square Terminal: the register pushes the amount to the paired hardware and
  // then waits. Square owns the card — we tender the bill only once Square
  // confirms, so a terminal that times out or gets cancelled leaves the bill
  // exactly as it was.
  async function payWithSquareTerminal(deviceId: string) {
    if (!order || !charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await api<{ checkoutId: string; deviceName: string; status: string }>(
        `/api/pos/orders/${order.id}/terminal-checkout`,
        {
          method: 'POST',
          body: JSON.stringify({
            deviceId,
            amountCents: charge.amountCents ?? balance,
            tipCents: charge.tipCents
          })
        }
      );
      setSquareCheckout({ id: started.checkoutId, deviceName: started.deviceName, status: started.status });

      // Poll until Square is done with the card. Give up after five minutes —
      // long past the point where staff should be looking at the terminal.
      const deadline = Date.now() + 5 * 60_000;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (Date.now() > deadline) {
          setError('The terminal did not respond. Check it, then cancel or retry.');
          break;
        }
        const poll = await api<{ status: string; settled?: boolean; reason?: string; order?: Order }>(
          `/api/pos/terminal-checkouts/${started.checkoutId}`
        );
        setSquareCheckout((current) => (current ? { ...current, status: poll.status } : current));
        if (poll.settled && poll.order) {
          setSquareCheckout(null);
          if (poll.order.status === 'PAID') {
            collectIssuedGiftCards(poll.order.id);
            setReceipt(poll.order);
            setOrder(null);
            setCharge(null);
            void refreshOpenOrders();
          } else {
            setOrder(poll.order);
            setCharge({ stage: 'pay', tipCents: 0, amountCents: null });
          }
          return;
        }
        if (poll.status === 'CANCELED') {
          setSquareCheckout(null);
          setError(poll.reason ?? 'The card was cancelled on the terminal.');
          return;
        }
      }
    } catch (err) {
      setSquareCheckout(null);
      setError(messageForError(err, 'The card was not charged.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSquareCheckout() {
    if (!squareCheckout) return;
    try {
      await api(`/api/pos/terminal-checkouts/${squareCheckout.id}/cancel`, { method: 'POST' });
    } catch (err) {
      setError(messageForError(err, 'Could not cancel — check the terminal.'));
    } finally {
      setSquareCheckout(null);
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
        collectIssuedGiftCards(result.id);
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        void refreshOpenOrders();
      } else {
        setOrder(result);
        setCharge({ stage: 'pay', tipCents: 0, amountCents: null });
      }
    } catch (err) {
      setError(messageForError(err, 'Payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  // An outside gift card (Gift Up, a paper voucher): we can't check or debit
  // a balance we don't hold, so it lands as an external tender with the
  // number on the payment for reconciliation. Staff verify the balance in
  // the other system before accepting.
  // A settled bill may have just issued gift cards. Fetch the codes so staff
  // can write them on the cards before the guest walks off.
  function collectIssuedGiftCards(orderId: string) {
    void api<Array<{ amountCents: number; issuedCode: string | null }>>(`/api/pos/orders/${orderId}/gift-cards`)
      .then((sales) => {
        const issued = sales
          .filter((sale) => sale.issuedCode)
          .map((sale) => ({ code: sale.issuedCode as string, amountCents: sale.amountCents }));
        if (issued.length > 0) setGiftIssued(issued);
      })
      .catch(() => undefined);
  }

  async function takeExternalGiftPayment(amountCents: number) {
    if (!order || !charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Order>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          method: 'CARD_EXTERNAL',
          amountCents,
          tipCents: charge.tipCents,
          reference: `GIFTCARD ${gift.code.trim().toUpperCase()}`
        })
      });
      setOrder(result);
      setCharge(null);
      setGift({ code: '', balanceCents: null, checking: false, take: '' });
      setInfo(`Outside gift card ${gift.code.trim().toUpperCase()} taken for ${money(amountCents)}.`);
      void refreshOpenOrders();
    } catch (err) {
      setError(messageForError(err, 'Could not record the gift card.'));
    } finally {
      setBusy(false);
    }
  }

  async function takeGiftPayment(appliesCents: number, coversAll: boolean) {
    if (!order || !charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The tip rides on the payment that finishes the bill, never on a part
      // payment — otherwise it gets charged more than once.
      const amountCents = Math.max(1, appliesCents);
      const tipCents = coversAll ? charge.tipCents : 0;
      const code = gift.code.trim().toUpperCase();
      const result = await api<Order & { status: string; giftCardRemainingCents?: number | null }>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method: 'GIFT_CARD', giftCardCode: code, amountCents, tipCents })
      });
      const remaining = result.giftCardRemainingCents ?? null;
      setGiftApplied((current) => [...current, { code, amountCents, remainingCents: remaining }]);
      if (result.status === 'PAID') {
        collectIssuedGiftCards(result.id);
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        setGiftApplied([]);
        void refreshOpenOrders();
        setInfo(remaining !== null ? `${code} — ${money(remaining)} left on the card.` : 'Paid by gift card.');
      } else {
        // Still owing: stay right here so the next card goes straight in.
        setOrder(result);
        setCharge({ ...charge, amountCents: null });
        setInfo(
          remaining !== null
            ? `${money(amountCents)} taken · ${money(remaining)} left on ${code}. Next card, or pay the rest another way.`
            : `${money(amountCents)} taken from ${code}.`
        );
      }
      setGift({ code: '', balanceCents: null, checking: false, take: '' });
    } catch (err) {
      setError(messageForError(err, 'Gift card payment failed.'));
    } finally {
      setBusy(false);
    }
  }

  // Put a member on the bill (or take them off). Attaching is what makes the
  // points happen — earn fires at settle for whoever is attached, whatever
  // tender pays the bill.
  async function attachLoyalty(handle: string) {
    if (!order || loyalty.working) return;
    setLoyalty((current) => ({ ...current, working: true }));
    setError(null);
    try {
      const result = await api<{ member: LoyaltyMember; order: Order }>(`/api/pos/orders/${order.id}/loyalty`, {
        method: 'POST',
        body: JSON.stringify({ handle })
      });
      setOrder(result.order);
      setLoyalty({ handle: '', joinName: '', joining: false, working: false, member: result.member });
      setInfo(`${result.member.firstName || 'Member'} on the bill — ${result.member.points} points (${money(result.member.creditCents)}).`);
    } catch (err) {
      setLoyalty((current) => ({ ...current, working: false }));
      const message = messageForError(err, 'Could not find that member.');
      if (/join them first/i.test(message)) {
        // Not a member yet: flip straight into the join mini-form with the
        // phone number already in place.
        setLoyalty((current) => ({ ...current, joining: true, working: false }));
      } else {
        setError(message);
      }
    }
  }

  async function joinLoyaltyAndAttach() {
    if (!order || loyalty.working) return;
    setLoyalty((current) => ({ ...current, working: true }));
    setError(null);
    try {
      const joined = await api<{ member: LoyaltyMember; alreadyMember: boolean }>('/api/pos/loyalty/join', {
        method: 'POST',
        body: JSON.stringify({ phone: loyalty.handle, firstName: loyalty.joinName, venue })
      });
      const result = await api<{ member: LoyaltyMember; order: Order }>(`/api/pos/orders/${order.id}/loyalty`, {
        method: 'POST',
        body: JSON.stringify({ handle: joined.member.code })
      });
      setOrder(result.order);
      setLoyalty({ handle: '', joinName: '', joining: false, working: false, member: result.member });
      setInfo(
        joined.alreadyMember
          ? `${result.member.firstName || 'Member'} was already a member — on the bill with ${result.member.points} points.`
          : `${result.member.firstName || 'New member'} joined — points start with this bill.`
      );
    } catch (err) {
      setLoyalty((current) => ({ ...current, working: false }));
      setError(messageForError(err, 'Could not join them up.'));
    }
  }

  async function takeLoyaltyPayment(appliesCents: number, coversAll: boolean) {
    if (!order || !charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const amountCents = Math.max(1, appliesCents);
      const tipCents = coversAll ? charge.tipCents : 0;
      const result = await api<Order & { status: string; loyaltyPointsRemaining?: number | null; loyaltyPointsEarned?: number | null }>(
        `/api/pos/orders/${order.id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ method: 'LOYALTY', amountCents, tipCents })
        }
      );
      const remaining = result.loyaltyPointsRemaining ?? null;
      if (result.status === 'PAID') {
        collectIssuedGiftCards(result.id);
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        setGiftApplied([]);
        void refreshOpenOrders();
        setInfo(remaining !== null ? `Paid with points — ${remaining} left on the account.` : 'Paid with points.');
      } else {
        setOrder(result);
        setCharge({ ...charge, amountCents: null });
        setInfo(`${money(amountCents)} taken in points${remaining !== null ? ` · ${remaining} points left` : ''}. Pay the rest another way.`);
      }
    } catch (err) {
      setError(messageForError(err, 'Points payment failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveOrderMeta(meta: { notes?: string; dietary?: Array<{ tag: string; seat: number | null }> }) {
    if (!order) return;
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/meta`, { method: 'POST', body: JSON.stringify(meta) });
      setOrder(updated);
      setNoteSheet(null);
      setDietSheet(null);
    } catch (err) {
      setError(messageForError(err, 'Could not save.'));
    }
  }

  // Change user: device registers drop to the staff PIN screen; personal
  // logins sign out fully (back to the Alma Home button).
  function switchUser() {
    if (me !== 'loading' && me && me.kind === 'device') {
      setApiPinToken(null);
      void api('/api/device/pin-logout', { method: 'POST' })
        .catch(() => undefined)
        .then(() => refreshAuth());
      return;
    }
    setSwitchSheet({ pin: '' });
  }

  // Any active staff member's code becomes THEIR session on this register.
  async function submitSwitch(pin: string) {
    setBusy(true);
    try {
      const res = await api<{ user?: { firstName?: string; lastName?: string }; token?: string }>('/api/device/staff-pin-login', {
        method: 'POST',
        body: JSON.stringify({ pin })
      });
      setApiAuthToken(res.token);
      setApiPinToken(null);
      setSwitchSheet(null);
      await refreshAuth();
      setInfo(`On the till: ${`${res.user?.firstName ?? ''} ${res.user?.lastName ?? ''}`.trim() || 'signed in'}.`);
    } catch (err) {
      setSwitchSheet({ pin: '' });
      setError(messageForError(err, 'That code did not match.'));
    } finally {
      setBusy(false);
    }
  }

  function signOutFully() {
    clearApiTokens();
    setSwitchSheet(null);
    void api('/api/auth/logout', { method: 'POST' })
      .catch(() => undefined)
      .then(() => refreshAuth());
  }

  async function unlockWithPin(pin: string) {
    setBusy(true);
    try {
      // Whoever unlocks is on the till: their code switches the session to
      // them; if that fails, fall back to a plain unlock for this account.
      try {
        const res = await api<{ token?: string }>('/api/device/staff-pin-login', { method: 'POST', body: JSON.stringify({ pin }) });
        setApiAuthToken(res.token);
        setApiPinToken(null);
        await refreshAuth();
      } catch {
        await api('/api/pos/unlock', { method: 'POST', body: JSON.stringify({ pin }) });
      }
      setLockScreen(false);
      setLockPin('');
    } catch (err) {
      setLockPin('');
      setError(messageForError(err, 'That code did not match.'));
    } finally {
      setBusy(false);
    }
  }

  function printTillReceipt(orderId: string) {
    void api<{ queued: number }>(`/api/pos/orders/${orderId}/print-receipt`, { method: 'POST' })
      .then(() => setInfo('Receipt printing at the till.'))
      .catch((err) => setError(messageForError(err, 'Could not print the receipt.')));
  }

  useEffect(() => {
    if (!customise) return;
    void api<Array<{ recipeId: string }>>(`/api/pos/top-items?venue=${encodeURIComponent(venue)}`)
      .then((rows) => setTopSellers(rows.map((row) => row.recipeId)))
      .catch(() => undefined);
  }, [customise, venue]);

  async function loadSettled() {
    try {
      const rows = await api<Order[]>(`/api/pos/orders?venue=${encodeURIComponent(venue)}&status=ALL`);
      setSettled(rows.filter((row) => row.status !== 'OPEN'));
    } catch (err) {
      setError(messageForError(err, 'Could not load bills.'));
    }
  }

  // What a management tile does when tapped — one definition, wherever the
  // tile happens to be sitting on the board.
  // Call away: offer the courses that still have unsent lines on them.
  function openFireSheet() {
    if (!order) return;
    const held = new Map<string, number>();
    for (const line of order.lines) {
      if ((line as { sentAt?: string | null }).sentAt) continue;
      const course = line.course ?? 'Mains';
      held.set(course, (held.get(course) ?? 0) + line.quantity);
    }
    const courseList = courses
      .filter((course) => held.has(course))
      .concat([...held.keys()].filter((course) => !courses.includes(course)));
    setFireSheet(courseList.map((course, index) => ({ course, count: held.get(course) ?? 0, picked: index === 0 })));
  }

  const nothingToFire = !order || order.lines.every((line) => (line as { sentAt?: string | null }).sentAt);

  // The whole bill as ONE docket, course-ordered, built client-side: nothing
  // is fired and no line is stamped sentAt — print at order time, call the
  // courses away individually after.
  function printFullOrder() {
    if (!order) return;
    const sorted = [...order.lines].sort((a, b) => courses.indexOf(a.course ?? 'NOW') - courses.indexOf(b.course ?? 'NOW'));
    setDockets([
      {
        profile: 'Full order',
        printerIp: null,
        kind: 'FULL',
        orderType: orderTypeOf(order),
        tableLabel: order.tableLabel,
        orderNumber: order.orderNumber,
        covers: order.covers,
        // The person who took the order, not whoever is standing at the till.
        openedByName: (order as Order & { openedByName?: string | null }).openedByName ?? operatorName,
        firedByName: null,
        orderedAt: order.createdAt,
        firedAt: null,
        // These were missing: a docket without its allergens is dangerous.
        orderNotes: order.notes ?? null,
        dietary: (order.dietary as Array<{ tag: string; seat: number | null }> | null) ?? [],
        lines: sorted.map((line) => ({
          id: line.id ?? line.recipeId ?? line.name,
          // The kitchen's own name for this dish, if it has one.
          name: line.printName ?? line.name,
          quantity: line.quantity,
          course: line.course ?? 'NOW',
          seat: line.seat ?? null,
          modifiers: (line.modifiers as Array<{ name: string; priceCents: number }> | null) ?? [],
          notes: line.notes ?? null
        }))
      } as Docket
    ]);
  }

  function runManagement(key: string) {
    if (key === 'open-till') {
      // The drawer is wired to the receipt printer, so kick it as well as
      // opening the till screen. Silent if no till printer is set up — the
      // screen is still the point of the button.
      void api('/api/pos/open-drawer', { method: 'POST', body: JSON.stringify({ venue }) })
        .then(() => setInfo('Drawer opened.'))
        .catch(() => undefined);
      void (async () => {
        const [gate, drawer] = await Promise.all([
          api<CloseGate>(`/api/pos/close-day?venue=${encodeURIComponent(venue)}`),
          api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
        ]);
        setClosing({ gate, drawer, stage: 'checklist', float: '', counts: {}, report: null });
      })().catch(() => undefined);
    } else if (key === 'gift-sell') {
      if (!order) {
        setError('Start a sale first, then add the gift card to it.');
        return;
      }
      setGiftSell({ amount: '50', recipientName: '', recipientEmail: '', code: '' });
    } else if (key === 'wastage') {
      setWastage({ search: '', recipeId: '', itemName: '', quantity: '1', reason: '' });
    } else if (key === 'discount') {
      if (order && order.lines.length > 0) setDiscounting({ mode: 'percent', value: '10', reason: '' });
      else setError('Start a sale first, then apply the discount.');
    } else if (order && order.lines.length > 0) {
      // Comp and price changes need a line — offer the picker rather than
      // telling the operator to go hunting for the tap target.
      setPickLine(key === 'comp' ? 'COMP' : 'PRICE_CHANGE');
    } else {
      setError(`Start a sale first, then ${key === 'comp' ? 'comp the item' : 'change the price'}.`);
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

  // One balance check for both roads into the gift tender: the typed code
  // and the camera scan. A miss keeps the outside-card path open — old
  // Gift Up cards are still out there.
  function checkGiftCard(raw?: string) {
    const codeValue = (raw ?? gift.code).trim().toUpperCase();
    if (!codeValue) return;
    setGift({ code: codeValue, balanceCents: null, checking: true, take: '' });
    void api<{ code: string; balanceCents: number; recipientName?: string | null }>(
      `/api/pos/gift-card?code=${encodeURIComponent(codeValue)}`
    )
      .then((card) => {
        const outstanding = (charge?.amountCents ?? balance) + (charge?.tipCents ?? 0);
        // Default to whichever runs out first, then let staff type over it.
        const suggested = Math.min(card.balanceCents, Math.max(0, outstanding));
        setGift({
          code: card.code,
          balanceCents: card.balanceCents,
          checking: false,
          take: (suggested / 100).toFixed(2),
          holder: card.recipientName ?? null
        });
      })
      .catch((err) => {
        // Not an ALMA card. Old Gift Up cards are still out there, so offer
        // to take it as an outside card with the number recorded against the
        // payment rather than turning the guest away.
        setGift({ code: codeValue, balanceCents: null, checking: false, external: true, take: '' });
        setError(messageForError(err, 'Could not find that gift card.'));
      });
  }

  return (
    <div className="pos-shell">
      {design === 'rail' ? (
        <aside className="pos-rail">
          <div
            className="pos-rail-brand"
            onClick={() => {
              setOrder(null);
              setView('register');
              void refreshOpenOrders();
            }}
          >
            <img src={ALMA_MARK} alt="" />
            <strong>{venueIdentity.businessName.toLowerCase()}</strong>
            <span>POS</span>
          </div>
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
            className={view === 'bills' ? 'pos-rail-item is-on' : 'pos-rail-item'}
            onClick={() => {
              setView('bills');
              void refreshOpenOrders();
              void loadSettled();
            }}
          >
            Bills
          </button>
          {/* An action, not a view — dropped glasses don't wait for someone
              to remember which board the wastage pin lives on. */}
          <button
            type="button"
            className="pos-rail-item"
            onClick={() => setWastage({ search: '', recipeId: '', itemName: '', quantity: '1', reason: '' })}
          >
            Wastage
          </button>
          {/* Also an action: somebody at the counter buying a card is not on a
              table and has nothing to add to a board. */}
          <button
            type="button"
            className="pos-rail-item"
            onClick={() =>
              setGiftSale({ amountDollars: '', recipientName: '', recipientEmail: '', code: '', physical: false, saving: false })
            }
          >
            Gift card
          </button>
          {/* The nav is READ-ONLY here — it is arranged in the board editor,
              so a busy service can't reorder it by accident. */}
          <div className="pos-rail-eyebrow">
            Menu
            <button type="button" className="pos-rail-editbtn" title="Edit the menu nav in the board editor" onClick={() => setView('board')}>
              ✎ Edit
            </button>
          </div>
          <div className="pos-rail-cats">
            <button type="button" className={activeCategory === HOME_TAB && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'} onClick={() => { setView('register'); setActiveCategory(HOME_TAB); }}>
              ★ Home
            </button>
            <button type="button" className={activeCategory === '__all__' && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'} onClick={() => { setView('register'); setActiveCategory('__all__'); }}>
              Full menu
            </button>
            {wines.length > 0 ? (
              <button
                type="button"
                className={activeCategory === WINE_TAB && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'}
                onClick={() => { setView('register'); setActiveCategory(WINE_TAB); }}
              >
                Wine <span className="pos-rail-count">{wines.length}</span>
              </button>
            ) : null}
            {visibleTabs.map((token) => {
              const isGroup = token.startsWith('g:');
              const groupName = isGroup ? token.slice(2) : null;
              const target = isGroup ? `__group__${groupName}` : token;
              return (
                <button
                  key={token}
                  type="button"
                  className={activeCategory === target && view === 'register' ? 'pos-rail-item is-on' : 'pos-rail-item'}
                  onClick={() => {
                    setView('register');
                    setActiveCategory(target);
                  }}
                >
                  {isGroup ? (hasMark(groupName ?? '') ? <Mark name={groupName ?? ''} /> : <i className="pos-nav-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', iconStyle === 'off' ? 'line' : iconStyle) }} />) : <Mark name={token} />}
                  {isGroup ? groupName : token}
                </button>
              );
            })}
          </div>
          <div className="pos-rail-foot">
            <strong>{operatorName}</strong>
            <small>On the till · {venueIdentity.businessName}</small>
            <button type="button" className="pos-rail-switch" onClick={switchUser}>
              ⇄ Change user
            </button>
          </div>
        </aside>
      ) : null}
      <div className="pos-main">
      {serviceCalls.length > 0 ? (
        <div className="pos-callbar">
          {serviceCalls.map((call) => (
            <button
              key={call.id}
              type="button"
              title="Tap once you've been over"
              onClick={() => {
                void api(`/api/pos/service-calls/${call.id}/clear`, {
                  method: 'POST',
                  body: JSON.stringify({ staffName: operatorName })
                })
                  .then(() => setServiceCalls((current) => current.filter((entry) => entry.id !== call.id)))
                  .catch(() => undefined);
              }}
            >
              {call.kind === 'BILL' ? '🧾' : '🙋'} Table {call.tableLabel}
              <em>{call.kind === 'BILL' ? 'wants the bill' : 'needs someone'}</em>
            </button>
          ))}
        </div>
      ) : null}
      <header className="pos-header">
        <img src={ALMA_MARK} alt="" className="pos-mark" onClick={() => { setOrder(null); void refreshOpenOrders(); }} />
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
            {/* Tap to flip — it heads every docket, so it must be one tap. */}
            <button
              type="button"
              className={`pos-covers-chip pos-type-chip is-${orderTypeOf(order) === 'TAKEAWAY' ? 'away' : 'in'}`}
              title="Dine in or takeaway — prints at the top of every docket"
              disabled={busy}
              onClick={() => {
                const next = orderTypeOf(order) === 'TAKEAWAY' ? 'DINE_IN' : 'TAKEAWAY';
                setOrder({ ...order, orderType: next });
                void api<Order>(`/api/pos/orders/${order.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ orderType: next })
                })
                  .then(setOrder)
                  .catch((err) => setError(messageForError(err, 'Could not change the order type.')));
              }}
            >
              {orderTypeOf(order) === 'TAKEAWAY' ? '🥡 Takeaway' : '🍽 Dine in'}
            </button>
            {/* While ON, tapped items land at $0 with an "Included in
                package" note — ring the set menu first, then the dishes. */}
            <button
              type="button"
              className={`pos-covers-chip pos-pkg-chip${pkgMode ? ' is-on' : ''}`}
              title="Items added while this is on go on the bill at $0 — for dishes and drinks included in a set menu or package"
              disabled={busy}
              onClick={() => setPkgMode(!pkgMode)}
            >
              {pkgMode ? '◉ Package items · $0' : '○ Package items'}
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
        {/* One search bar, never two. Full menu and Wine each carry their own
            search — richer than this one (a wine is found by grape, region or
            a word from the note; a dish by what it suits) and sitting right
            above the list it filters. Showing this as well was two boxes
            competing for the same job and a row of screen nobody got back. */}
        {view === 'register' && !pageOwnsSearch ? (
          <PosSearchBox onTerm={setSearchTerm} />
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="pos-theme-btn pos-help-btn"
          title="How this register works"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
        <button
          type="button"
          className="pos-theme-btn"
          title="Other ALMA apps"
          onClick={() => setAppsOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.1" />))}
          </svg>
        </button>
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
            onClick={switchUser}
          >
            {operatorName} · switch
          </button>
        ) : null}
        {view === 'board' ? (
          <button type="button" className="pos-ghost" onClick={closeBoardEditor}>
            ← Register
          </button>
        ) : view === 'register' ? (
          // The top nav is NAVIGATION only — where you go. What you do to the
          // bill (send, more, charge) sits on the bill itself.
          <>
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                setView('bills');
                void refreshOpenOrders();
                void loadSettled();
              }}
            >
              Bills
            </button>
            <button type="button" className="pos-ghost" onClick={() => { setView('tables'); void refreshOpenOrders(); }}>
              Tables
            </button>
            <button type="button" className="pos-ghost" onClick={() => { setOrder(null); setView('register'); }}>
              ＋ New order
            </button>
          </>
        ) : (
          <>
            <button type="button" className="pos-ghost" onClick={() => setView('register')}>
              Register
            </button>
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                setOrder(null);
                setView('register');
              }}
            >
              ＋ New order
            </button>
            <button type="button" className={`pos-ghost ${editLayout ? 'pos-ghost-active' : ''}`} onClick={() => setEditLayout(!editLayout)}>
              {editLayout ? 'Done editing' : 'Edit layout'}
            </button>
            <button type="button" className="pos-ghost" onClick={() => void openDay()}>
              Day
            </button>
            {me.kind === 'staff' ? (
              // A button, not an anchor: the lone <a> in this row missed the
              // button font/centering reset and its label sat high in the pill.
              <button
                type="button"
                className="pos-ghost"
                onClick={() => {
                  window.location.hash = 'office';
                }}
              >
                Office
              </button>
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
      {updateReady ? (
        <div className="pos-update">
          <span>New version ready</span>
          <button type="button" onClick={() => window.location.reload()}>
            Update now
          </button>
        </div>
      ) : null}
      {training ? (
        <div
          className={trainingLocked ? 'pos-training is-locked' : 'pos-training'}
          onClick={
            trainingLocked
              ? undefined
              : () => {
                  setTrainingSwitch(false);
                  localStorage.setItem('alma.pos.training', '0');
                }
          }
        >
          {trainingLocked
            ? "TRAINING TILL — sales don't count, nothing reaches the kitchen. This account is practice only."
            : "TRAINING MODE — sales don't count, nothing reaches the kitchen. Tap to end."}
        </div>
      ) : null}
      {offline || queue.length > 0 ? (
        <div className={offline ? 'pos-offline' : 'pos-offline is-syncing'}>
          {offline ? 'OFFLINE — quick sales keep working and queue on this device' : 'Back online'}
          {queue.length > 0 ? ` · ${queue.length} sale${queue.length === 1 ? '' : 's'} queued` : ''}
          {!offline && queue.length > 0 ? ' · syncing…' : ''}
        </div>
      ) : null}

      {view === 'board' ? (
        <Suspense fallback={null}>
        <BoardEditor
          home={home}
          menu={menu}
          topSellers={topSellers}
          boardSlots={boardSlots}
          boardCols={boardCols}
          operatorName={operatorName}
          iconStyle={iconStyle}
          onIconStyle={(next) => {
            setIconStyle(next);
            localStorage.setItem(ICONS_KEY, next);
          }}
          textScale={textScale}
          onTextScale={setTextScale}
          onChange={queueBoardSave}
          onClose={closeBoardEditor}
        />
        </Suspense>
      ) : null}
      {view === 'bills' ? (
        <BillsPage
          openOrders={openOrders}
          settled={settled}
          busy={busy}
          onOpen={(row) => {
            setOrder(row);
            setView('register');
          }}
          onMore={(row) => {
            setOrder(row);
            setView('register');
            setBillActions(true);
          }}
          onReinstate={(row) => {
            const attempt = (pin?: string) => {
              void api<Order>(`/api/pos/orders/${row.id}/reopen`, { method: 'POST', body: JSON.stringify({ managerPin: pin }) })
                .then((reopened) => {
                  setManagerGate(null);
                  setOrder(reopened);
                  setView('register');
                  void refreshOpenOrders();
                  setInfo(`${reopened.tableLabel ? `Table ${reopened.tableLabel}` : `#${reopened.orderNumber}`} is open again — the payment stays on it.`);
                })
                .catch((err) => {
                  const message = messageForError(err, 'Could not reinstate that bill.');
                  if (/manager/i.test(message)) setManagerGate({ message, pin: '', retry: attempt });
                  else setError(message);
                });
            };
            attempt();
          }}
          onRefund={(row) => {
            const refunded = row.payments
              .filter((payment) => payment.amountCents < 0)
              .reduce((sum, payment) => sum - payment.amountCents, 0);
            setRefunding({
              order: row,
              amount: String((row.totalCents + row.tipCents - refunded) / 100),
              reason: '',
              method: 'REFUND'
            });
          }}
          onSplit={(row) => {
            setOrder(row);
            setView('register');
            setCharge({ stage: 'pay', tipCents: 0, amountCents: null });
          }}
          onReceipt={(row) => setReceipt(row as Order & { changeCents?: number | null })}
          onNewOrder={() => {
            setOrder(null);
            setView('register');
          }}
          onRefresh={() => {
            void refreshOpenOrders();
            void loadSettled();
          }}
        />
      ) : null}
      {view === 'tables' ? (
        // Tables IS the floor plan now — the old card list moved to Bills,
        // which is also where a sale with no table shows up.
        <div className="pos-home">
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
        </div>
      ) : view === 'bills' || view === 'board' ? null : (
        <div className="pos-body">
          <div className="pos-menu">
            {!searchTerm ? (
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
                <button
                  type="button"
                  className={activeCategory === '__all__' ? 'is-active' : ''}
                  onClick={() => setActiveCategory('__all__')}
                >
                  Full menu
                </button>
                {wines.length > 0 ? (
                  <button
                    type="button"
                    className={activeCategory === WINE_TAB ? 'is-active' : ''}
                    onClick={() => setActiveCategory(WINE_TAB)}
                  >
                    Wine
                  </button>
                ) : null}
                {/* Read-only: the tab bar is arranged in the board editor. */}
                {visibleTabs.map((token) => {
                  const isGroup = token.startsWith('g:');
                  const groupName = isGroup ? token.slice(2) : null;
                  const active = isGroup ? activeCategory === `__group__${groupName}` : activeCategory === token;
                  return (
                    <button
                      key={token}
                      type="button"
                      className={`${active ? 'is-active' : ''} ${isGroup ? 'is-group' : ''}`}
                      onClick={() => setActiveCategory(isGroup ? `__group__${groupName}` : token)}
                    >
                      {isGroup ? (hasMark(groupName ?? '') ? <Mark name={groupName ?? ''} /> : <i className="pos-nav-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', iconStyle === 'off' ? 'line' : iconStyle) }} />) : <Mark name={token} />}
                      {isGroup ? groupName : token}
                    </button>
                  );
                })}
                {boardEdit ? (
                  <button type="button" className="pos-tab-newfolder" onClick={() => setView('board')}>
                    ⚙ Editor
                  </button>
                ) : null}
              </nav>
            ) : null}
            {activeCategory === WINE_TAB ? (
              (() => {
                const chip = (
                  key: string,
                  label: string,
                  on: boolean,
                  count: number,
                  toggle: () => void,
                  // Colour chips wear the colour they filter for, so the chip
                  // and the wines it finds are recognisably the same thing.
                  colour?: string
                ) => (
                  <button
                    key={key}
                    type="button"
                    className="pos-wine-chip"
                    data-colour={colour}
                    aria-pressed={on}
                    disabled={count === 0}
                    onClick={toggle}
                  >
                    {label}
                    <span className="pos-wine-n">{count}</span>
                  </button>
                );
                const countIf = (test: (wine: RegisterWine) => boolean) => wines.filter(test).length;
                // Nothing to clear, no Clear button. On an iPad the filter bar
                // is competing with the list for the same screen, and a button
                // that does nothing is the first thing that should go.
                const filtersOn =
                  wineFilters.q.trim() !== '' ||
                  wineFilters.pour !== 'any' ||
                  wineFilters.colours.length > 0 ||
                  wineFilters.band !== null ||
                  wineFilters.pairs.length > 0;
                let section: string | null = null;
                let styleBand: string | null = null;
                return (
                  <div className="pos-wine">
                    <div className="pos-wine-filters">
                      {/* Search, tally and Clear share one line. Each had its
                          own row before, and on a 270px column that cost two
                          rows of wine for a word and a button. */}
                      <div className="pos-wine-find">
                        <input
                          className="pos-wine-search"
                          type="search"
                          value={wineFilters.q}
                          placeholder="Grape, region, producer, or a word from the note"
                          onChange={(event) => setWineFilters({ ...wineFilters, q: event.currentTarget.value, open: null })}
                        />
                        <span className="pos-wine-count">
                          {shownWines.length === wines.length
                            ? `${wines.length} wines`
                            : `${shownWines.length} of ${wines.length}`}
                        </span>
                        {filtersOn ? (
                          <button
                            type="button"
                            className="pos-wine-clear"
                            onClick={() => setWineFilters({ q: '', pour: 'any', colours: [], band: null, pairs: [], open: null })}
                          >
                            Clear
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="pos-wine-fold"
                          aria-expanded={chipsOpen}
                          onClick={toggleChips}
                        >
                          {chipsOpen ? 'Fewer filters' : 'Filters'}
                        </button>
                      </div>
                      {chipsOpen ? (
                      <>
                      <div className="pos-wine-chips">
                        <span className="pos-wine-label">Pour</span>
                        {chip('any', 'Everything', wineFilters.pour === 'any', wines.length, () =>
                          setWineFilters({ ...wineFilters, pour: 'any', open: null })
                        )}
                        {chip('glass', 'By the glass', wineFilters.pour === 'glass', countIf(winePoured), () =>
                          setWineFilters({ ...wineFilters, pour: 'glass', open: null })
                        )}
                        {chip('bottle', 'Bottle only', wineFilters.pour === 'bottle', countIf((wine) => !winePoured(wine)), () =>
                          setWineFilters({ ...wineFilters, pour: 'bottle', open: null })
                        )}
                      </div>
                      <div className="pos-wine-chips">
                        <span className="pos-wine-label">Colour</span>
                        {WINE_COLOURS.map((colour) =>
                          chip(
                            colour.id,
                            colour.label,
                            wineFilters.colours.includes(colour.id),
                            countIf((wine) => wineColour(wine) === colour.id),
                            () =>
                              setWineFilters({
                                ...wineFilters,
                                colours: wineFilters.colours.includes(colour.id)
                                  ? wineFilters.colours.filter((id) => id !== colour.id)
                                  : [...wineFilters.colours, colour.id],
                                open: null
                              }),
                            colour.id
                          )
                        )}
                      </div>
                      <div className="pos-wine-chips">
                        <span className="pos-wine-label">Price</span>
                        {WINE_BANDS.map((band) =>
                          chip(
                            band.id,
                            band.label,
                            wineFilters.band === band.id,
                            countIf((wine) => band.test(wineFrom(wine))),
                            () => setWineFilters({ ...wineFilters, band: wineFilters.band === band.id ? null : band.id, open: null })
                          )
                        )}
                        {WINE_PAIRS.map((pair) =>
                          chip(
                            pair.id,
                            pair.label,
                            wineFilters.pairs.includes(pair.id),
                            countIf((wine) => wine.pairsWith.includes(pair.id)),
                            () =>
                              setWineFilters({
                                ...wineFilters,
                                pairs: wineFilters.pairs.includes(pair.id)
                                  ? wineFilters.pairs.filter((id) => id !== pair.id)
                                  : [...wineFilters.pairs, pair.id],
                                open: null
                              })
                          )
                        )}
                      </div>
                      </>
                      ) : null}
                    </div>
                    <div className="pos-wine-rows">
                      {shownWines.length === 0 ? (
                        <p className="pos-wine-empty">Nothing on the list matches that. Clear a filter and try again.</p>
                      ) : null}
                      {shownWines.map((wine) => {
                        const rows = [];
                        if (wine.section !== section || wine.styleBand !== styleBand) {
                          section = wine.section;
                          styleBand = wine.styleBand;
                          rows.push(
                            <div key={`h-${wine.id}`} className="pos-wine-group" data-colour={wineColour(wine)}>
                              {section ?? 'Wine'}
                              {styleBand ? <span className="pos-wine-band">{styleBand}</span> : null}
                            </div>
                          );
                        }
                        const off = wineOff(wine);
                        rows.push(
                          <div key={wine.id} className={`pos-wine-row${off ? ' is-86' : ''}`} data-colour={wineColour(wine)}>
                            <span className="pos-wine-main">
                              <span className="pos-wine-name">
                                <span className="pos-wine-vintage">{wine.vintage ?? 'NV'}</span>
                                {wine.name}
                                {off ? <span className="pos-wine-tag is-out">86'd</span> : null}
                                {wine.sommelierPour ? <span className="pos-wine-tag is-som">Sommelier</span> : null}
                                {wine.limitedStock ? <span className="pos-wine-tag is-ltd">Limited</span> : null}
                                {wine.serveChilled ? <span className="pos-wine-tag">Serve chilled</span> : null}
                              </span>
                              <span className="pos-wine-meta">
                                {[wine.grape, [wine.region, wine.origin].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                                {wine.pairsWith.length > 0 ? (
                                  <span className="pos-wine-marks"> {wine.pairsWith.map((mark) => WINE_MARK[mark]).join(' ')}</span>
                                ) : null}
                              </span>
                              {wine.tastingNote ? <span className="pos-wine-note">{wine.tastingNote}</span> : null}
                            </span>
                            <span className="pos-wine-pours">
                              {wine.pours.map((pour) => (
                                <button
                                  key={pour.recipeId}
                                  type="button"
                                  className="pos-wine-pour"
                                  disabled={eightySix.has(pour.recipeId)}
                                  onClick={() => addWinePour(wine, pour)}
                                >
                                  <span className="pos-wine-size">{pour.ml >= 700 ? 'Bottle' : `${pour.ml} mL`}</span>
                                  <span className="pos-wine-price">{money(pour.priceCents)}</span>
                                </button>
                              ))}
                              <button
                                type="button"
                                className="pos-wine-like"
                                onClick={() =>
                                  setWineFilters({ ...wineFilters, open: wineFilters.open === wine.id ? null : wine.id })
                                }
                              >
                                Like<br />this
                              </button>
                            </span>
                          </div>
                        );
                        if (wineFilters.open === wine.id) {
                          const near = similarWines(wine);
                          rows.push(
                            <div key={`s-${wine.id}`} className="pos-wine-similar">
                              <span className="pos-wine-similar-head">Instead of {wine.name}</span>
                              {near.length === 0 ? (
                                <span className="pos-wine-meta">Nothing else on the list is close to it.</span>
                              ) : null}
                              {near.map(({ wine: other, why }) => (
                                <span key={other.id} className="pos-wine-similar-row">
                                  <span className="pos-wine-similar-name">
                                    {other.name} — {other.grape ?? other.section}, {other.region}
                                  </span>
                                  <span className="pos-wine-meta">{why}</span>
                                  <span className="pos-wine-meta">{money(wineFrom(other))}</span>
                                </span>
                              ))}
                            </div>
                          );
                        }
                        return rows;
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (activeCategory === '__all__' && !searchTerm) ||
            (tabsConfig.looks?.[activeCategory] === 'list' && menu.some((category) => category.name === activeCategory) && !searchTerm) ? (
              <div className="pos-list">
                {activeCategory === '__all__' ? (() => {
                  // Counts come from the same rows the list will render, so a
                  // chip never offers a filter that finds nothing.
                  const all = menu.flatMap((category) =>
                    category.items.filter((item) => !item.variantOf).map((item) => ({ item, kind: category.kind }))
                  );
                  const countIf = (test: (entry: { item: MenuItem; kind: string }) => boolean) => all.filter(test).length;
                  const shown = menuShownCount;
                  const chip = (key: string, label: string, on: boolean, count: number, toggle: () => void) => (
                    <button key={key} type="button" className="pos-wine-chip" aria-pressed={on} disabled={count === 0 && !on} onClick={toggle}>
                      {label}
                      <span className="pos-wine-n">{count}</span>
                    </button>
                  );
                  return (
                    <div className="pos-wine-filters pos-menu-filters">
                      <div className="pos-wine-find">
                        <input
                          className="pos-wine-search"
                          placeholder="Search the menu…"
                          value={menuFilters.q}
                          onChange={(event) => setMenuFilters({ ...menuFilters, q: event.currentTarget.value })}
                        />
                        <span className="pos-wine-count">
                          {shown} item{shown === 1 ? '' : 's'}
                        </span>
                        {menuFiltersOn ? (
                          <button
                            type="button"
                            className="pos-wine-clear"
                            onClick={() => setMenuFilters({ q: '', kind: 'any', avail: 'any', diet: null })}
                          >
                            Clear
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="pos-wine-fold"
                          aria-expanded={chipsOpen}
                          onClick={toggleChips}
                        >
                          {chipsOpen ? 'Fewer filters' : 'Filters'}
                        </button>
                      </div>
                      {chipsOpen ? (
                      <>
                      <div className="pos-wine-chips">
                        <span className="pos-wine-label">Where</span>
                        {chip('k-any', 'Everything', menuFilters.kind === 'any', all.length, () =>
                          setMenuFilters({ ...menuFilters, kind: 'any' })
                        )}
                        {chip('k-food', 'Kitchen', menuFilters.kind === 'FOOD', countIf((entry) => entry.kind === 'FOOD'), () =>
                          setMenuFilters({ ...menuFilters, kind: 'FOOD' })
                        )}
                        {chip('k-bev', 'Bar', menuFilters.kind === 'BEVERAGE', countIf((entry) => entry.kind === 'BEVERAGE'), () =>
                          setMenuFilters({ ...menuFilters, kind: 'BEVERAGE' })
                        )}
                        {countIf((entry) => entry.kind === 'SET_MENU') > 0
                          ? chip('k-set', 'Set menus', menuFilters.kind === 'SET_MENU', countIf((entry) => entry.kind === 'SET_MENU'), () =>
                              setMenuFilters({ ...menuFilters, kind: 'SET_MENU' })
                            )
                          : null}
                      </div>
                      {/* Only what the kitchen has actually marked. A venue
                          that has not walked the menu yet gets no row here
                          rather than a row that finds nothing. */}
                      {all.some((entry) => (entry.item.dietary ?? []).length > 0) ? (
                        <div className="pos-wine-chips">
                          <span className="pos-wine-label">Suits</span>
                          {chip('d-any', 'Anyone', menuFilters.diet === null, all.length, () =>
                            setMenuFilters({ ...menuFilters, diet: null })
                          )}
                          {answerableGuestTags().map((tag) =>
                            chip(
                              `d-${tag}`,
                              tag,
                              menuFilters.diet === tag,
                              countIf((entry) => {
                                const verdict = dishAnswersGuest(entry.item.dietary ?? [], tag);
                                // An allergy chip counts what it will SHOW: everything
                                // not marked as containing the allergen (none of which
                                // is thereby safe — the caveat below says so). A diet
                                // chip counts real yes/ask claims only.
                                return guestTagIsAllergy(tag) ? verdict !== 'no' : verdict === 'yes' || verdict === 'ask';
                              }),
                              () => setMenuFilters({ ...menuFilters, diet: menuFilters.diet === tag ? null : tag })
                            )
                          )}
                        </div>
                      ) : null}
                      {/* Only worth showing once something is actually 86'd. */}
                      {countIf((entry) => eightySix.has(entry.item.recipeId)) > 0 ? (
                        <div className="pos-wine-chips">
                          <span className="pos-wine-label">On now</span>
                          {chip('a-any', 'Everything', menuFilters.avail === 'any', all.length, () =>
                            setMenuFilters({ ...menuFilters, avail: 'any' })
                          )}
                          {chip('a-on', 'Available', menuFilters.avail === 'on', countIf((entry) => !eightySix.has(entry.item.recipeId)), () =>
                            setMenuFilters({ ...menuFilters, avail: 'on' })
                          )}
                          {chip('a-off', "86'd", menuFilters.avail === 'off', countIf((entry) => eightySix.has(entry.item.recipeId)), () =>
                            setMenuFilters({ ...menuFilters, avail: 'off' })
                          )}
                        </div>
                      ) : null}
                      </>
                      ) : null}
                      {menuFilters.diet ? (
                        guestTagIsAllergy(menuFilters.diet) ? (
                          <p className="pos-menu-caveat">
                            Hiding dishes marked as containing it. <strong>Everything left is unverified, not safe</strong> —
                            nothing on the menu is checked allergen-free. Always tell the kitchen about a{' '}
                            <strong>{menuFilters.diet.toLowerCase()}</strong>.
                          </p>
                        ) : (
                          <p className="pos-menu-caveat">
                            Showing dishes the kitchen has marked <strong>{menuFilters.diet}</strong>. Anything not marked is
                            hidden because nobody has checked it — not because it is unsuitable. Ask the kitchen.
                          </p>
                        )
                      ) : null}
                    </div>
                  );
                })() : null}
                {(activeCategory === '__all__'
                  ? visibleTabs
                      .map((token) => {
                        if (token.startsWith('g:')) {
                          const folderName = token.slice(2);
                          // The whole subtree: a dish filed into a SUB-folder
                          // still belongs to this section on the Full menu —
                          // before this it rendered nowhere while the header
                          // count still included it.
                          const cats = groupSubtreeCats(tabsConfig, folderName)
                            .map((name) => menu.find((category) => category.name === name))
                            .filter((category): category is MenuCategory => Boolean(category));
                          return { token, folderName, cats };
                        }
                        const category = menu.find((candidate) => candidate.name === token);
                        return category ? { token, folderName: null as string | null, cats: [category] } : null;
                      })
                      .filter((unit): unit is { token: string; folderName: string | null; cats: MenuCategory[] } => unit !== null)
                  : menu
                      .filter((category) => category.name === activeCategory)
                      .map((category) => ({ token: category.name, folderName: null as string | null, cats: [category] }))
                ).map(({ token, folderName, cats }) => {
                  const qtyOf = (recipeId: string) =>
                    (order?.lines ?? []).filter((line) => line.recipeId === recipeId).reduce((sum, line) => sum + line.quantity, 0);
                  // A search stays open: a match hidden inside a collapsed
                  // <details> is a match nobody finds. Text, dietary and
                  // availability filters are searches. The WHERE filter
                  // (kind — Kitchen/Bar/Set menus) is a scope, not a search:
                  // browsing Kitchen's sections you still want to fold the
                  // ones you are not working, so those stay collapsible.
                  const searching =
                    Boolean(searchTerm) ||
                    menuFilters.q.trim() !== '' ||
                    menuFilters.diet !== null ||
                    menuFilters.avail !== 'any';
                  const collapsible = activeCategory === '__all__' && !searching;
                  const total = cats.reduce(
                    (sum, category) =>
                      sum +
                      category.items.filter(
                        (item) => !item.variantOf && (activeCategory !== '__all__' || menuMatch(item, category.kind))
                      ).length,
                    0
                  );
                  // Nothing left after filtering is not an empty section, it is
                  // a section this search does not concern.
                  if (total === 0 && (menuFiltersOn || !boardEdit)) return null;
                  return (
                    <details key={token} className="pos-list-section" {...(collapsible ? {} : { open: true })}>
                      <summary
                        className="pos-list-head"
                        onClick={(event) => {
                          if (!collapsible) event.preventDefault();
                        }}
                      >
                        {folderName && hasMark(folderName) ? (
                          <Mark name={folderName} className="pos-nav-icon pos-list-icon" />
                        ) : folderName ? (
                          <i className="pos-nav-icon pos-list-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', iconStyle === 'off' ? 'line' : iconStyle) }} />
                        ) : hasMark(token) ? (
                          <Mark name={token} className="pos-nav-icon pos-list-icon" />
                        ) : (
                          <i className={`pos-list-dot ${hueClass(hueForCategory(cats[0]?.name ?? token))}`} />
                        )}
                        <h3>{folderName ?? token}</h3>
                        <small>
                          {total} item{total === 1 ? '' : 's'}
                        </small>
                      </summary>
                      <div className="pos-list-card">
                        {cats.map((category) => {
                          const rows = category.items.filter(
                            (item) => !item.variantOf && (activeCategory !== '__all__' || menuMatch(item, category.kind))
                          );
                          if (rows.length === 0) return null;
                          return (
                            <div key={category.name} className="pos-list-subgroup">
                              {folderName ? <div className="pos-list-subhead">{category.name}</div> : null}
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
                                    {(item.dietary ?? []).length > 0 ? (
                                      <span className="pos-list-diet">
                                        {parseDishDietary(item.dietary ?? []).map((id) => (
                                          <i key={id} data-kind={dietaryKind(id)} title={dietaryLabel(id)}>
                                            {dietaryShort(id)}
                                          </i>
                                        ))}
                                      </span>
                                    ) : null}
                                    {quantity > 0 ? <em>×{quantity}</em> : null}
                                    <b>{eightySix.has(item.recipeId) ? "86'd" : money(item.priceCents)}</b>
                                    <u>＋</u>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
                {activeCategory === '__all__' && menuFiltersOn && menuShownCount === 0 ? (
                  <p className="pos-menu-none">
                    Nothing on the menu matches that.
                    <button type="button" onClick={() => setMenuFilters({ q: '', kind: 'any', avail: 'any', diet: null })}>
                      Clear the filters
                    </button>
                  </p>
                ) : null}
                {activeCategory === '__all__' ? (
                  <button
                    type="button"
                    className="pos-list-editfab"
                    title="Arrange the menu nav in the board editor"
                    onClick={() => setView('board')}
                  >
                    ✎
                  </button>
                ) : null}
              </div>
            ) : !searchTerm && activeCategory === HOME_TAB ? (
              <div className="pos-home-wrap">
              <div
                className="pos-board-pager"
                ref={boardPagerRef}
                onPointerDown={(event) => {
                  // While editing, a press on a TILE is a drag — that has its
                  // own edge-flip and must not also swipe the page. But a
                  // swipe on the empty part of the board still needs to turn
                  // the page: this used to bail on boardEdit outright, which
                  // left page 2 reachable only by dragging a tile to the edge.
                  if (boardEdit && (event.target as HTMLElement).closest('[data-pin-index]')) return;
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
                      {/* pos-pin-act marks these as the tile's own controls,
                          so the drag handler leaves their taps alone. */}
                      <i className="pos-pin-x pos-pin-act" onClick={removePin}>✕</i>
                      <i className="pos-pin-size pos-pin-act" onClick={cycleSize}>⤢</i>
                      <i className="pos-pin-rename pos-pin-act" onClick={startRename}>✎</i>
                      {pin.t === 'f' ? (
                        <i
                          className="pos-pin-look pos-pin-act"
                          title={pin.look === 'list' ? 'Showing as list — tap for tiles' : 'Showing as tiles — tap for list'}
                          onClick={(event) => {
                            event.stopPropagation();
                            const board = {
                              ...home,
                              pins: home.pins.map((candidate, i) =>
                                i === index && candidate.t === 'f'
                                  ? { ...candidate, look: candidate.look === 'list' ? undefined : ('list' as const) }
                                  : candidate
                              )
                            };
                            setHome(board);
                            saveBoard(board);
                          }}
                        >
                          {pin.look === 'list' ? '≣' : '▦'}
                        </i>
                      ) : null}
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
                  if (pin.t === 'm') {
                    return (
                      <button
                        key={`m-${pin.key}-${index}`}
                        type="button"
                        data-pin-index={index}
                        className={`pos-item pos-item-pin ${hueClass(pin.c)} ${sizeClass} ${boardEdit ? 'is-editing' : ''}`}
                        style={hueStyle(pin.c)}
                        {...editProps}
                        onClick={() => {
                          if (dragMoved.current) {
                            dragMoved.current = false;
                            return;
                          }
                          if (boardEdit) {
                            cycleColour();
                            return;
                          }
                          runManagement(pin.key);
                        }}
                      >
                        {badges}
                        {renameInput ?? <span className={pinDisplay(pin, MGMT_LABELS[pin.key] ?? pin.key).cls}>{pinDisplay(pin, MGMT_LABELS[pin.key] ?? pin.key).main}</span>}
                      </button>
                    );
                  }
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
                            <span className={pinDisplay(pin, pin.name).cls}>
                              {hasMark(pin.name) ? <Mark name={pin.name} className="pos-tile-icon" /> : <i className="pos-tile-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', iconStyle === 'off' ? 'line' : iconStyle) }} />}
                              {pinDisplay(pin, pin.name).main}
                            </span>
                            <small>
                              {pin.folders?.length ? `${pin.folders.length} folder${pin.folders.length === 1 ? '' : 's'} · ` : ''}
                              {folderDishCount(pin)} items
                            </small>
                          </>
                        )}
                      </button>
                    );
                  }
                  const item = resolvePinItem(pin.id);
                  if (!item) return null;
                  return (
                    <button
                      key={pin.id}
                      type="button"
                      data-pin-index={index}
                      className={`pos-item pos-item-pin ${hueClass(pin.c)} ${sizeClass} ${boardEdit ? 'is-editing' : ''} ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                      style={hueStyle(pin.c)}
                                            {...editProps}
                      onClick={() => (boardEdit ? cycleColour() : addItem(item))}
                    >
                      {badges}
                      {renameInput ?? (
                        <>
                          <span className={pinDisplay(pin, item.title).cls}>
                            {/* The dish's own mark, else its category's. */}
                            <Mark name={hasMark(item.title) ? item.title : categoryOf(item)} className="pos-tile-icon" />
                            {pinDisplay(pin, item.title).main}
                          </span>
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
                    <button type="button" className="pos-item pos-item-edit" onClick={() => setView('board')}>
                      <span>⚙ Board editor</span>
                      <small>arrange with buttons</small>
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
            ) : !searchTerm && activeCategory.startsWith('__folder__') ? (
              <div className="pos-grid pos-grid-home">
                {(() => {
                  // Path token: `__folder__3` = root pin 3, `__folder__3.0`
                  // = its first subfolder — Back walks up one level at a time.
                  const path = parseFolderPath(activeCategory) ?? [];
                  const pin = folderAtPath(home.pins, path);
                  const parentToken = path.length > 1 ? folderPathToken(path.slice(0, -1)) : HOME_TAB;
                  const parentName = path.length > 1 ? folderAtPath(home.pins, path.slice(0, -1))?.name ?? 'back' : 'home';
                  const back = (
                    <button key="back" type="button" className="pos-item pos-item-edit" onClick={() => setActiveCategory(parentToken)}>
                      <span>← Back</span>
                      <small>{parentName}</small>
                    </button>
                  );
                  if (!pin) return back;
                  const patchFolder = (update: (folder: FolderPin) => FolderPin | null) => {
                    const board = { ...home, pins: updateFolderAtPath(home.pins, path, update) };
                    setHome(board);
                    saveBoard(board);
                    return board;
                  };
                  const subTiles = (pin.folders ?? []).map((sub, subIndex) => {
                    const subToken = folderPathToken([...path, subIndex]);
                    const subRenaming = renaming?.kind === 'sub' && renaming.key === subToken;
                    return (
                      <button
                        key={`sub-${subIndex}`}
                        type="button"
                        data-fsub-index={subIndex}
                        className={`pos-item pos-item-pin ${hueClass(sub.c ?? pin.c)} ${boardEdit ? 'is-editing' : ''}`}
                        style={hueStyle(sub.c ?? pin.c)}
                        onClick={() => {
                          if (dragMoved.current) {
                            dragMoved.current = false;
                            return;
                          }
                          if (subRenaming) return;
                          setActiveCategory(subToken);
                        }}
                      >
                        {boardEdit ? (
                          <>
                            <i
                              className="pos-pin-x pos-pin-act"
                              title="Dissolve — its items move up into this folder"
                              onClick={(event) => {
                                event.stopPropagation();
                                patchFolder((folder) => {
                                  const child = folder.folders?.[subIndex];
                                  if (!child) return folder;
                                  const folders = [
                                    ...(folder.folders ?? []).filter((_, i) => i !== subIndex),
                                    ...(child.folders ?? [])
                                  ];
                                  const rebuilt: FolderPin = {
                                    ...folder,
                                    items: [...folder.items, ...child.items.filter((id) => !folder.items.includes(id))],
                                    folders
                                  };
                                  if (!folders.length) delete rebuilt.folders;
                                  return rebuilt;
                                });
                              }}
                            >
                              ✕
                            </i>
                            <i
                              className="pos-pin-rename pos-pin-act"
                              onClick={(event) => {
                                event.stopPropagation();
                                setRenaming({ kind: 'sub', key: subToken, value: sub.name });
                              }}
                            >
                              ✎
                            </i>
                          </>
                        ) : null}
                        {subRenaming ? (
                          <input
                            className="pos-pin-rename-input"
                            autoFocus
                            defaultValue={renaming.value}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onBlur={(event) => commitSubRename([...path, subIndex], event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitSubRename([...path, subIndex], event.currentTarget.value);
                              if (event.key === 'Escape') setRenaming(null);
                            }}
                          />
                        ) : (
                          <>
                            <span className={pinDisplay(sub, sub.name).cls}>
                              {hasMark(sub.name) ? <Mark name={sub.name} className="pos-tile-icon" /> : <i className="pos-tile-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', iconStyle === 'off' ? 'line' : iconStyle) }} />}
                              {pinDisplay(sub, sub.name).main}
                            </span>
                            <small>
                              {sub.folders?.length ? `${sub.folders.length} folder${sub.folders.length === 1 ? '' : 's'} · ` : ''}
                              {folderDishCount(sub)} items
                            </small>
                          </>
                        )}
                      </button>
                    );
                  });
                  // A folder often holds BOTH venues' ids for the same wine —
                  // resolved to this venue's twin they'd render twice. Show
                  // each dish once; edit mode stays raw so the stray copy can
                  // still be seen and removed.
                  const seenResolved = new Set<string>();
                  const asList = pin.look === 'list' && !boardEdit;
                  const itemTiles = pin.items.map((recipeId, itemIndex) => {
                    const item = resolvePinItem(recipeId);
                    if (!item) return null;
                    if (!boardEdit) {
                      if (seenResolved.has(item.recipeId)) return null;
                      seenResolved.add(item.recipeId);
                    }
                    if (asList) {
                      return (
                        <button
                          key={recipeId}
                          type="button"
                          className={`pos-list-row pos-list-row--fill ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                          disabled={busy}
                          onClick={() => addItem(item)}
                        >
                          <i className={`pos-list-dot ${hueClass(pin.c)}`} />
                          <span>{item.title}</span>
                          <b>{eightySix.has(item.recipeId) ? "86'd" : money(item.priceCents)}</b>
                          <u>＋</u>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={recipeId}
                        type="button"
                        data-fitem-index={itemIndex}
                        className={`pos-item pos-item-pin ${hueClass(pin.c)} ${boardEdit ? 'is-editing' : ''} ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                        style={hueStyle(pin.c)}
                        onPointerDown={boardEdit ? (event) => folderItemPointerDown(event, path, itemIndex) : undefined}
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
                                patchFolder((folder) => ({ ...folder, items: folder.items.filter((candidateId) => candidateId !== recipeId) }));
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
                  const editTiles = boardEdit ? (
                    <>
                      {path.length < MAX_FOLDER_DEPTH ? (
                        <button
                          key="new-sub"
                          type="button"
                          className="pos-item pos-item-edit"
                          onClick={() => setFolderDraft({ name: '', c: '#4f8f6b', items: [], search: '', at: [...path] })}
                        >
                          <span>📁 New folder</span>
                          <small>inside {pin.name}</small>
                        </button>
                      ) : null}
                      <button
                        key="add-items"
                        type="button"
                        className="pos-item pos-item-edit"
                        onClick={() => setFolderDraft({ name: pin.name, c: pin.c ?? '#4f8f6b', items: [], search: '', into: [...path] })}
                      >
                        <span>＋ Add items</span>
                        <small>search the menu</small>
                      </button>
                    </>
                  ) : null;
                  return (
                    <>
                      {back}
                      {subTiles}
                      {itemTiles}
                      {editTiles}
                    </>
                  );
                })()}
              </div>
            ) : !searchTerm && activeCategory.startsWith('__group__') ? (
              <div className="pos-grid-groups">
                {(() => {
                  const group = tabsConfig.groups.find((candidate) => candidate.name === activeCategory.slice('__group__'.length));
                  if (!group) return null;
                  // Editor-chosen look: square tiles (the Home-page look) or
                  // full-menu list rows. Tiles unless the folder says list.
                  const asList = group.look === 'list';
                  const qtyOf = (recipeId: string) =>
                    (order?.lines ?? []).filter((line) => line.recipeId === recipeId).reduce((sum, line) => sum + line.quantity, 0);
                  // Sub-folders of this folder open into their own page; a
                  // nested folder gets a way back to the one it sits inside.
                  const subFolders = childNavGroups(tabsConfig, group.name);
                  const backTo = group.parent ? `__group__${group.parent}` : '__all__';
                  return (
                    <>
                      <button type="button" className="pos-group-back" onClick={() => setActiveCategory(backTo)}>
                        ‹ {group.parent ?? 'Full menu'}
                      </button>
                      {subFolders.length > 0 ? (
                        <div className="pos-group-subfolders">
                          {subFolders.map((sub) => {
                            // The whole subtree, variant children folded
                            // under their parent — the same way every other
                            // surface counts a menu.
                            const count = groupSubtreeCats(tabsConfig, sub.name).reduce(
                              (sum, catName) =>
                                sum +
                                (menu.find((candidate) => candidate.name === catName)?.items.filter((item) => !item.variantOf).length ?? 0),
                              0
                            );
                            return (
                              <button
                                key={sub.name}
                                type="button"
                                className="pos-group-subfolder"
                                onClick={() => setActiveCategory(`__group__${sub.name}`)}
                              >
                                {hasMark(sub.name) ? (
                                  <Mark name={sub.name} className="pos-nav-icon" />
                                ) : (
                                  <i className="pos-nav-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', iconStyle === 'off' ? 'line' : iconStyle) }} />
                                )}
                                <span>{sub.name}</span>
                                <small>{count} item{count === 1 ? '' : 's'}</small>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {group.cats.map((catName) => {
                    const category = menu.find((candidate) => candidate.name === catName);
                    if (!category) return null;
                    return (
                      <section key={catName}>
                        <h3 className="pos-group-head">{catName}</h3>
                        {asList ? (
                          <div className="pos-list-rows">
                            {/* Variant children (a wine's pours, the grilled
                                twin) fold under their parent tile, as on
                                every other surface. */}
                            {category.items.filter((item) => !item.variantOf).map((item) => {
                              const quantity = qtyOf(item.recipeId);
                              return (
                                <button
                                  key={item.recipeId}
                                  type="button"
                                  className={`pos-list-row ${eightySix.has(item.recipeId) ? 'is-86d' : ''}`}
                                  onClick={() => addItem(item)}
                                >
                                  <i className={`pos-list-dot ${hueClass(hueForCategory(catName))}`} />
                                  <span>{item.title}</span>
                                  {quantity > 0 ? <em>×{quantity}</em> : null}
                                  <b>{eightySix.has(item.recipeId) ? "86'd" : money(item.priceCents)}</b>
                                  <u>＋</u>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="pos-grid">
                            {category.items.filter((item) => !item.variantOf).map((item) => (
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
                        )}
                      </section>
                    );
                      })}
                    </>
                  );
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
                              setRawMenu((current) => current.map((category) => ({ ...category, items: category.items.filter((candidate) => candidate.recipeId !== item.recipeId) })));
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
                {visibleItems.length === 0 ? <p className="pos-muted">No items{searchTerm ? ' match' : ''}.</p> : null}
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
              {order ? (
                <div className="pos-meta-chips">
                  {(order.dietary ?? []).length ? (
                    <div className="pos-diet-banner">
                      ⚠ {(order.dietary ?? []).map((tag) => (tag.seat ? `${tag.tag} S${tag.seat}` : tag.tag)).join(' · ')}
                    </div>
                  ) : null}
                  <button type="button" onClick={() => setNoteSheet({ value: order.notes ?? '' })}>
                    ✎ {order.notes ? 'Edit comment' : 'Add comment'}
                  </button>
                  <button type="button" onClick={() => setDietSheet({ tags: [...(order.dietary ?? [])], custom: '', seat: '' })}>
                    ⚠ Dietary{(order.dietary ?? []).length ? ` ${(order.dietary ?? []).length}` : ''}
                  </button>
                  {order.notes ? (
                    <button type="button" className="pos-order-note" onClick={() => setNoteSheet({ value: order.notes ?? '' })}>
                      ✎ {order.notes}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {(order?.lines ?? []).length === 0 && !targetCourse ? (
                <div className="pos-cart-empty">
                  <img src={ALMA_FISH} alt="" className="pos-fish-empty" />
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
                        {line.course ?? 'NOW'}
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
                  <span className="pos-line-total">
                    {line.unitPriceCents === 0 && (line.packagedBy || line.notes?.includes('Included in package'))
                      ? 'incl.'
                      : money(line.unitPriceCents * line.quantity)}
                  </span>
                </div>
              )) : null}
                </div>
              ))}
              {giftLines.length > 0 ? (
                <div className="pos-course-group is-open">
                  <div className="pos-course-head pos-course-head-static">
                    <span>Gift cards</span>
                    <small>
                      {giftLines.reduce((sum, entry) => sum + entry.line.quantity, 0)} item
                      {giftLines.length === 1 && giftLines[0]!.line.quantity === 1 ? '' : 's'}
                    </small>
                  </div>
                  {giftLines.map(({ line, index }) => (
                    <div key={`${line.recipeId ?? 'gift'}-${index}`} className="pos-line">
                      <span className="pos-line-main">
                        <span className="pos-line-name">{line.name}</span>
                        {line.notes ? <small className="pos-line-mods">{line.notes}</small> : null}
                      </span>
                      <span className="pos-line-total">{money(line.unitPriceCents * line.quantity)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
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
                  title="Discount, comp, split, merge, print, void"
                  onClick={() => setBillActions(true)}
                >
                  More
                </button>
                {/* Send sits with the bill, not in the nav — it's the action
                    you reach for most, and Void no longer lives beside Charge. */}
                <button
                  type="button"
                  className="pos-ghost"
                  disabled={busy || nothingToFire}
                  title="Call away — choose which courses go to the kitchen"
                  onClick={openFireSheet}
                >
                  Send
                </button>
                <button
                  type="button"
                  className="pos-charge"
                  disabled={!order || order.lines.length === 0 || busy || balance <= 0}
                  onClick={() => setCharge({ stage: 'pay', tipCents: 0, amountCents: null })}
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
                <p className="pos-muted">Cash and EFTPOS only — on a card machine the guest picks their own.</p>
                <div className="pos-choice-row">
                  {[0, 5, 10].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setCharge({ ...charge, stage: 'method', tipCents: Math.round(((charge.amountCents ?? balance) * pct) / 100) })}
                    >
                      {pct === 0 ? 'No tip' : `+${pct}% (${money(Math.round((balance * pct) / 100))})`}
                    </button>
                  ))}
                </div>
                {/* A regular leaving $50 on a big table shouldn't be capped by
                    whichever percentages we happened to pick. */}
                <input
                  className="pos-tender"
                  inputMode="decimal"
                  placeholder="Or a custom tip $"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const cents = Math.round(Number(event.currentTarget.value || '0') * 100);
                    if (cents > 0) setCharge({ ...charge, stage: 'method', tipCents: cents });
                  }}
                  onBlur={(event) => {
                    const cents = Math.round(Number(event.currentTarget.value || '0') * 100);
                    if (cents > 0) setCharge({ ...charge, tipCents: cents });
                  }}
                />
                {charge.tipCents > 0 ? (
                  <button
                    type="button"
                    className="pos-charge"
                    onClick={() => setCharge({ ...charge, stage: 'method' })}
                  >
                    Tip {money(charge.tipCents)} — continue
                  </button>
                ) : null}
              </>
            ) : null}
            {charge.stage === 'pay' ? (
              <>
                <h2 className="pos-charge-total">{money(balance + charge.tipCents)}</h2>
                {/* The plain payments screen: pay it all, or step into the
                    split/part-payment screen on purpose. Filled buttons here
                    — the choice-row's default transparent style disappears
                    against the panel for the two decisions that matter most. */}
                <div className="pos-choice-row">
                  <button
                    type="button"
                    className="pos-charge"
                    onClick={() => setCharge({ ...charge, stage: tipStage, amountCents: null })}
                  >
                    Pay in full
                  </button>
                  <button
                    type="button"
                    className="pos-charge pos-charge-secondary"
                    onClick={() => setCharge({ ...charge, stage: 'split' })}
                  >
                    Split
                  </button>
                </div>
              </>
            ) : null}
            {charge.stage === 'split' ? (
              <>
                <h2 className="pos-charge-total">{money(balance + charge.tipCents)}</h2>
                {charge.tipCents > 0 ? <p className="pos-muted">includes {money(charge.tipCents)} tip on this payment</p> : null}
                <div className="pos-choice-row">
                  <button type="button" onClick={() => setCharge({ ...charge, stage: tipStage, amountCents: null })}>
                    Pay in full
                  </button>
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCharge({ ...charge, stage: tipStage, amountCents: Math.ceil(balance / n) })}
                    >
                      Split ÷{n} ({money(Math.ceil(balance / n))})
                    </button>
                  ))}
                </div>
                <div className="pos-choice-row">
                  <button type="button" onClick={() => setSplitPick({ mode: 'item', picked: [], seat: null })}>
                    Split by item
                  </button>
                  <button type="button" onClick={() => setSplitPick({ mode: 'seat', picked: [], seat: null })}>
                    Split by seat
                  </button>
                </div>
                {/* Separate bills, not part-payments: each one is its own
                    table, so each guest taps their own card and picks their
                    own tip on the machine. */}
                {paidCents(order) === 0 ? (
                  <>
                    <p className="pos-muted">Or give everyone their own bill:</p>
                    <div className="pos-choice-row">
                      {[2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" disabled={busy} onClick={() => void splitIntoBills(n)}>
                          {n} separate bills
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
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
                <h2 className="pos-charge-total">{money((charge.amountCents ?? balance) + charge.tipCents)}</h2>
                {squareCheckout ? (
                  <div className="pos-terminal-wait">
                    <strong>On {squareCheckout.deviceName}</strong>
                    <p>
                      {squareCheckout.status === 'IN_PROGRESS'
                        ? 'Guest is paying…'
                        : 'Waiting for the guest to tap…'}
                    </p>
                    <button type="button" className="pos-ghost" onClick={() => void cancelSquareCheckout()}>
                      Cancel on terminal
                    </button>
                  </div>
                ) : null}
                <div className="pos-choice-row">
                  {nativeTapToPay ? (
                    <button type="button" className="pos-tap-btn" disabled={busy} onClick={() => void takeTapToPay()}>
                      📲 Tap to Pay
                    </button>
                  ) : null}
                  {squareTerminals.map((terminal) => (
                    <button
                      key={terminal.id}
                      type="button"
                      className="pos-charge"
                      disabled={busy}
                      onClick={() => void payWithSquareTerminal(terminal.id)}
                    >
                      Card · {terminal.name}
                    </button>
                  ))}
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
                        setGift({ code: '', balanceCents: null, checking: false, take: '' });
                        setGiftScan(false);
                        setCharge({ ...charge, stage: 'gift' });
                      }}
                    >
                      Gift card
                    </button>
                  ) : null}
                  {!order.id.startsWith('local-') ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setLoyalty({ handle: '', joinName: '', joining: false, working: false, member: null });
                        setCharge({ ...charge, stage: 'loyalty' });
                        const code = order.guest?.loyaltyCode;
                        if (code) {
                          void api<LoyaltyMember>(`/api/pos/loyalty/member?handle=${encodeURIComponent(code)}`)
                            .then((member) => setLoyalty((current) => ({ ...current, member })))
                            .catch(() => undefined);
                        }
                      }}
                    >
                      {order.guest?.loyaltyCode ? `Points · ${order.guest.firstName}` : 'Loyalty'}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            {charge.stage === 'gift' && order ? (
              <>
                <h2>Gift card — {money((charge.amountCents ?? balance) + charge.tipCents)}</h2>
                {gift.balanceCents === null && !gift.checking ? (
                  <button type="button" className="pos-charge" disabled={busy} onClick={() => setGiftScan(true)}>
                    ▣ Scan the card
                  </button>
                ) : null}
                {giftScan ? (
                  <Suspense fallback={null}>
                    <ScanSheet
                      onCode={(scanned) => {
                        setGiftScan(false);
                        checkGiftCard(scanned);
                      }}
                      onClose={() => setGiftScan(false)}
                    />
                  </Suspense>
                ) : null}
                <input
                  className="pos-tender"
                  placeholder="Or type the code (e.g. ALMA-XXXX-XXXX)"
                  value={gift.code}
                  onChange={(event) => setGift({ code: event.currentTarget.value.toUpperCase(), balanceCents: null, checking: false, take: '' })}
                />
                {gift.balanceCents === null ? (
                  <>
                  <button
                    type="button"
                    className="pos-charge"
                    disabled={busy || gift.checking || gift.code.trim().length < 4}
                    onClick={() => checkGiftCard()}
                  >
                    {gift.checking ? 'Checking…' : 'Check balance'}
                  </button>
                  {gift.external ? (
                    <>
                      <p className="pos-muted">
                        Not an ALMA card. If it's an old Gift Up card, take it here — the number is
                        recorded against the payment so it can be reconciled.
                      </p>
                      <button
                        type="button"
                        className="pos-ghost"
                        disabled={busy}
                        onClick={() => {
                          const wanted = (charge.amountCents ?? balance) + charge.tipCents;
                          void takeExternalGiftPayment(wanted);
                        }}
                      >
                        Take as outside gift card
                      </button>
                    </>
                  ) : null}
                  </>
                ) : (
                  <>
                    <p className="pos-change">
                      Card balance {money(gift.balanceCents)}
                      {gift.holder ? ` · ${gift.holder}` : ''}
                    </p>
                    {(() => {
                      const outstanding = (charge.amountCents ?? balance) + charge.tipCents;
                      const most = Math.min(gift.balanceCents ?? 0, outstanding);
                      const takeCents = Math.round(Number(gift.take || 0) * 100);
                      const valid = takeCents > 0 && takeCents <= (gift.balanceCents ?? 0);
                      const coversAll = takeCents >= outstanding;
                      return (
                        <>
                          <p className="pos-muted">
                            {money(outstanding)} left on this bill. Take any amount up to{' '}
                            {money(gift.balanceCents ?? 0)} — it doesn't have to clear the bill.
                          </p>
                          <div className="pos-choice-row">
                            <button type="button" onClick={() => setGift({ ...gift, take: (most / 100).toFixed(2) })}>
                              {most >= outstanding ? 'Pay it off' : 'Whole card'}
                            </button>
                            {[20, 50].map((value) =>
                              value * 100 <= (gift.balanceCents ?? 0) ? (
                                <button key={value} type="button" onClick={() => setGift({ ...gift, take: value.toFixed(2) })}>
                                  ${value}
                                </button>
                              ) : null
                            )}
                          </div>
                          <input
                            className="pos-tender"
                            inputMode="decimal"
                            placeholder="Take from this card $"
                            value={gift.take}
                            onChange={(event) => setGift({ ...gift, take: event.currentTarget.value.replace(/[^0-9.]/g, '') })}
                          />
                          <button
                            type="button"
                            className="pos-charge"
                            disabled={busy || !valid}
                            onClick={() => void takeGiftPayment(takeCents, coversAll)}
                          >
                            Take {valid ? money(takeCents) : '—'}
                            {valid && !coversAll ? ` · ${money(outstanding - takeCents)} still owing` : ''}
                          </button>
                          {takeCents > (gift.balanceCents ?? 0) ? (
                            <p className="pos-muted">That's more than the card holds.</p>
                          ) : null}
                        </>
                      );
                    })()}
                  </>
                )}
                {giftApplied.length > 0 ? (
                  <button
                    type="button"
                    className="pos-ghost"
                    onClick={() => setCharge({ ...charge, stage: 'split', amountCents: null })}
                  >
                    Pay the rest another way
                  </button>
                ) : null}
                {giftApplied.length > 0 ? (
                  <div className="pos-gift-applied">
                    <p className="pos-actions-head">Taken from cards</p>
                    {giftApplied.map((entry, index) => (
                      <p key={`${entry.code}-${index}`} className="pos-sumline">
                        <span>{entry.code}</span>
                        <span>
                          −{money(entry.amountCents)}
                          {entry.remainingCents !== null ? ` (${money(entry.remainingCents)} left)` : ''}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {charge.stage === 'loyalty' && order ? (
              <>
                <h2>Points — {money((charge.amountCents ?? balance) + charge.tipCents)}</h2>
                {order.guest?.loyaltyCode ? (
                  loyalty.member ? (
                    (() => {
                      const member = loyalty.member;
                      const outstanding = (charge.amountCents ?? balance) + charge.tipCents;
                      const minCents = member.minRedeemPoints * member.pointValueCents;
                      const usable = Math.min(member.creditCents, outstanding);
                      const belowMin = member.creditCents < minCents;
                      return (
                        <>
                          <p className="pos-change">
                            {member.firstName} {member.lastName} · {member.points} points = {money(member.creditCents)}
                          </p>
                          {belowMin ? (
                            <p className="pos-muted">
                              Redemptions start at {member.minRedeemPoints} points ({money(minCents)}) — {member.points} so far. The
                              points still build on this bill.
                            </p>
                          ) : (
                            <button
                              type="button"
                              className="pos-charge"
                              disabled={busy || usable < 1}
                              onClick={() => void takeLoyaltyPayment(usable, usable >= outstanding)}
                            >
                              {usable >= outstanding
                                ? `Pay ${money(outstanding)} with points`
                                : `Use all ${money(usable)} of points`}
                            </button>
                          )}
                          <button
                            type="button"
                            className="pos-ghost"
                            disabled={busy}
                            onClick={() => {
                              void api<Order>(`/api/pos/orders/${order.id}/loyalty`, { method: 'DELETE' })
                                .then((updatedOrder) => {
                                  setOrder(updatedOrder);
                                  setLoyalty({ handle: '', joinName: '', joining: false, working: false, member: null });
                                })
                                .catch((err) => setError(messageForError(err, 'Could not take them off.')));
                            }}
                          >
                            Different member
                          </button>
                        </>
                      );
                    })()
                  ) : (
                    <p className="pos-muted">Fetching their points…</p>
                  )
                ) : (
                  <>
                    <p className="pos-muted">
                      Phone number or LOY- code. Points build on every bill their name is on — whatever way it is paid.
                    </p>
                    <input
                      className="pos-tender"
                      inputMode="tel"
                      placeholder="Phone or LOY-XXXXXX"
                      value={loyalty.handle}
                      onChange={(event) => setLoyalty((current) => ({ ...current, handle: event.currentTarget.value, joining: false }))}
                    />
                    {loyalty.joining ? (
                      <>
                        <p className="pos-muted">Not a member yet — first name and they are in.</p>
                        <input
                          className="pos-tender"
                          placeholder="First name"
                          value={loyalty.joinName}
                          onChange={(event) => setLoyalty((current) => ({ ...current, joinName: event.currentTarget.value }))}
                        />
                        <button
                          type="button"
                          className="pos-charge"
                          disabled={loyalty.working || loyalty.joinName.trim().length === 0}
                          onClick={() => void joinLoyaltyAndAttach()}
                        >
                          {loyalty.working ? 'Joining…' : 'Join and put on the bill'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="pos-charge"
                        disabled={loyalty.working || loyalty.handle.trim().length < 4}
                        onClick={() => void attachLoyalty(loyalty.handle)}
                      >
                        {loyalty.working ? 'Looking…' : 'Find member'}
                      </button>
                    )}
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
              {venueIdentity.receiptLogo ? <img src={venueIdentity.receiptLogo} alt="" className="pos-receipt-logo" /> : null}
              <h2>{venueIdentity.businessName}</h2>
              {venueIdentity.abn ? <p className="pos-abn">ABN {venueIdentity.abn}</p> : null}
              {[venueIdentity.address, venueIdentity.phone, venueIdentity.email, venueIdentity.website].some(Boolean) ? (
                <p className="pos-abn">
                  {[venueIdentity.address, venueIdentity.phone, venueIdentity.email, venueIdentity.website].filter(Boolean).join(' · ')}
                </p>
              ) : null}
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
              {/* Everything you'd want while looking at a guest's bill —
                  discount, comp, split, merge, and both prints — is already in
                  the register's options sheet, so open that rather than
                  keeping a second, smaller set of actions in sync here. */}
              <button
                type="button"
                className="pos-charge"
                onClick={() => {
                  setBill(null);
                  setBillActions(true);
                }}
              >
                More
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-receipt">
            <button type="button" className="pos-ghost pos-till-print" onClick={() => printTillReceipt(receipt.id)}>
              ⚡ Print at the till
            </button>
            {venueIdentity.receiptLogo ? <img src={venueIdentity.receiptLogo} alt="" className="pos-receipt-logo" /> : null}
            <p className="pos-receipt-brand">
              {venueIdentity.businessName}
              {venueIdentity.abn ? ` · ABN ${venueIdentity.abn}` : ''}
            </p>
            {[venueIdentity.address, venueIdentity.phone].some(Boolean) ? (
              <p className="pos-receipt-brand pos-receipt-details">
                {[venueIdentity.address, venueIdentity.phone, venueIdentity.email, venueIdentity.website].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            <h2>
              Paid — {receipt.tableLabel ? `Table ${receipt.tableLabel}` : `order #${receipt.orderNumber}`}
            </h2>
            {receipt.changeCents ? <p className="pos-change">Change due: {money(receipt.changeCents)}</p> : null}
            {(receipt as Order & { loyaltyPointsEarned?: number | null }).loyaltyPointsEarned ? (
              <p className="pos-change">
                ★ {(receipt as Order & { loyaltyPointsEarned?: number | null }).loyaltyPointsEarned} points earned
                {receipt.guest?.firstName ? ` for ${receipt.guest.firstName}` : ''}
              </p>
            ) : null}
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
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                setBills(null);
                setOrder(null);
                setView('register');
              }}
            >
              ＋ New order
            </button>
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
                            const attempt = (pin?: string) => {
                              void api<Order>(`/api/pos/orders/${row.id}/reopen`, { method: 'POST', body: JSON.stringify({ managerPin: pin }) })
                                .then((reopened) => {
                                  setManagerGate(null);
                                  setOrder(reopened);
                                  setBills(null);
                                  setView('register');
                                })
                                .catch((err) => {
                                  const message = messageForError(err, 'Could not reopen.');
                                  if (/manager/i.test(message)) setManagerGate({ message, pin: '', retry: attempt });
                                  else setError(message);
                                });
                            };
                            attempt();
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
                    ) : (() => {
                      // An OPEN bill paid past its total (edited down after a
                      // payment) owes the guest change — offer the refund here,
                      // pre-filled with exactly the overpayment.
                      const takenAll = row.payments.reduce((sum, payment) => sum + payment.amountCents + payment.tipCents, 0);
                      const overCents = takenAll - (row.totalCents + row.tipCents);
                      return row.status === 'OPEN' && overCents > 0 ? (
                        <button
                          type="button"
                          className="pos-ghost"
                          onClick={() => {
                            setBills(null);
                            setRefunding({ order: row, amount: String(overCents / 100), reason: '', method: 'REFUND' });
                          }}
                        >
                          Refund {money(overCents)} over
                        </button>
                      ) : null;
                    })()}
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
              {/* Only offered when the bill actually has a Square card payment
                  with money left on it — this one moves real money, the other
                  two just record that someone else did. */}
              {refundCards.length > 0 && refundCards[0]!.devices.length > 0 ? (
                <button
                  type="button"
                  className={refunding.method === 'TERMINAL' ? 'is-on' : ''}
                  onClick={() => setRefunding({ ...refunding, method: 'TERMINAL' })}
                >
                  To the card (terminal)
                </button>
              ) : null}
              <button
                type="button"
                className={refunding.method === 'REFUND' ? 'is-on' : ''}
                onClick={() => setRefunding({ ...refunding, method: 'REFUND' })}
              >
                Card (recorded only)
              </button>
              <button
                type="button"
                className={refunding.method === 'CASH' ? 'is-on' : ''}
                onClick={() => setRefunding({ ...refunding, method: 'CASH' })}
              >
                Cash from till
              </button>
            </div>
            {refunding.method === 'TERMINAL' ? (
              <p className="pos-muted">
                Goes back on {refundCards[0]!.devices[0]!.name} — up to {money(refundCards[0]!.refundableCents)}.
              </p>
            ) : null}
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
                const amountCents = Math.round(Number(snapshot.amount) * 100);
                const card = refundCards[0];

                // Money actually going back on the card: push it to the
                // terminal and wait for Square, exactly like taking one.
                const attemptTerminal = (pin?: string) => {
                  void api<{ refundId: string; deviceName: string }>(
                    `/api/pos/orders/${snapshot.order.id}/terminal-refund`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        amountCents,
                        reason: snapshot.reason,
                        staffName: operatorName || 'Unknown',
                        deviceId: card?.devices[0]?.id,
                        squarePaymentId: card?.squarePaymentId,
                        managerPin: pin
                      })
                    }
                  )
                    .then(async (started) => {
                      setManagerGate(null);
                      setInfo(`Refund sent to ${started.deviceName}…`);
                      const deadline = Date.now() + 5 * 60_000;
                      for (;;) {
                        await new Promise((resolve) => setTimeout(resolve, 1500));
                        if (Date.now() > deadline) {
                          setError('The terminal did not respond. Check Square before refunding again.');
                          return;
                        }
                        const poll = await api<{ status: string; settled?: boolean; reason?: string }>(
                          `/api/pos/terminal-refunds/${started.refundId}`
                        );
                        if (poll.settled) {
                          setRefunding(null);
                          setBills(null);
                          setInfo('Refunded to the card.');
                          void refreshOpenOrders();
                          return;
                        }
                        if (poll.status === 'CANCELED') {
                          setError(poll.reason ?? 'The refund was cancelled on the terminal.');
                          return;
                        }
                      }
                    })
                    .catch((err) => {
                      const message = messageForError(err, 'Refund failed.');
                      if (/manager/i.test(message)) setManagerGate({ message, pin: '', retry: attemptTerminal });
                      else setError(message);
                    });
                };

                const attempt = (pin?: string) => {
                  void api(`/api/pos/orders/${snapshot.order.id}/refund`, {
                    method: 'POST',
                    body: JSON.stringify({
                      amountCents,
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

                if (snapshot.method === 'TERMINAL') attemptTerminal();
                else attempt();
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

      {reporting ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            {reporting.sent ? (
              <>
                <h2>Sent — thank you</h2>
                <p className="pos-muted">
                  It's on the list with what you were doing, which bill, and which version of the register. Nobody needs to
                  ring anyone.
                </p>
                <button type="button" className="pos-charge" onClick={() => setReporting(null)}>
                  Back to service
                </button>
              </>
            ) : (
              <>
                <h2>What went wrong?</h2>
                <p className="pos-muted">
                  In your own words — what you were doing and what happened. The venue, the screen, the bill and the version
                  are attached automatically.
                </p>
                <textarea
                  className="pos-tender"
                  rows={4}
                  autoFocus
                  placeholder="e.g. hit Send and the docket never printed at the bar"
                  value={reporting.text}
                  onChange={(event) => setReporting({ ...reporting, text: event.currentTarget.value })}
                />
                <label className="pos-check-row">
                  <input
                    type="checkbox"
                    checked={reporting.blocking}
                    onChange={(event) => setReporting({ ...reporting, blocking: event.currentTarget.checked })}
                  />
                  <span>It's stopping us serving right now</span>
                </label>
                <button
                  type="button"
                  className="pos-charge"
                  disabled={busy || reporting.text.trim().length < 3}
                  onClick={() => void sendBugReport()}
                >
                  Send it
                </button>
                <button type="button" className="pos-ghost pos-modal-close" onClick={() => setReporting(null)}>
                  Cancel
                </button>
              </>
            )}
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
                const item = resolvePinItem(recipeId);
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

      {helpOpen ? (
        <div className="pos-modal" role="dialog" onClick={closeHelp}>
          <div className="pos-modal-panel pos-help-panel" onClick={(event) => event.stopPropagation()}>
            <h2>Welcome to ALMA POS</h2>
            <p className="pos-help-lead">
              {helpOperator ? `Hi ${helpOperator.split(' ')[0]} — here` : 'Here'}&apos;s the 30-second tour. Everything is
              already set up; this is just how it works.
            </p>
            <div className="pos-help-list">
              <div className="pos-help-item">
                <strong>★ Home is YOUR board</strong>
                <span>
                  It&apos;s saved to your name, not to this till. Sign into any register at either venue and your board
                  comes with you — and changes you make only ever change yours.
                </span>
              </div>
              <div className="pos-help-item">
                <strong>✎ Make it yours</strong>
                <span>
                  The last tile on Home is “✎ Edit this page”: drag tiles around, recolour them, remove them. “＋ Add
                  pins” searches the whole menu, and 📁 folders keep it tidy — folders can even live inside folders.
                </span>
              </div>
              <div className="pos-help-item">
                <strong>Search beats browsing</strong>
                <span>Mid-rush, type a few letters into “Search menu…” up top and tap the dish — no tab-hunting.</span>
              </div>
              <div className="pos-help-item">
                <strong>Sale · Tables · Bills</strong>
                <span>
                  Sale is the register. Tables is every open bill on the floor — yours and everyone else&apos;s. Bills is
                  the history: reprints, refunds, finding that table from earlier.
                </span>
              </div>
              <div className="pos-help-item">
                <strong>Loyalty</strong>
                <span>
                  On the charge screen, Loyalty joins a guest up with just a phone number, and their points pay bills like a
                  gift card. Points build on every bill their name is on, however it is paid.
                </span>
              </div>
              <div className="pos-help-item">
                <strong>Clock-in kiosk</strong>
                <span>
                  Open <em>alma-pos.web.app/#clock</em> on a wall tablet (signed in as this venue) and staff clock in, out and
                  breaks with their PIN — no Deputy needed.
                </span>
              </div>
              <div className="pos-help-item">
                <strong>The rest of ALMA</strong>
                <span>The nine dots up top hop to Staff, Stock, Gift cards and the other apps — already signed in.</span>
              </div>
            </div>
            <a
              className="pos-help-support"
              href={`mailto:timchristensen89+almapos@gmail.com?subject=${encodeURIComponent(`ALMA POS support — ${venue}`)}&body=${encodeURIComponent(`Hi — I need a hand with ALMA POS.\n\nWhat happened:\n\n\nWhat I expected:\n\n\n— ${operatorName || 'someone'} on the ${venue} till`)}`}
            >
              <strong>✉ Stuck? Email support</strong>
              <span>Opens an email straight to ALMA&apos;s developer — just say what happened.</span>
            </a>
            <p className="pos-help-foot">Tap ? in the top bar any time to read this again.</p>
            <button type="button" className="pos-help-go" onClick={closeHelp}>
              Got it — let&apos;s go
            </button>
          </div>
        </div>
      ) : null}

      {appsOpen ? (
        <div className="pos-modal" role="dialog" onClick={() => setAppsOpen(false)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2>ALMA apps</h2>
            <p className="pos-apps-group">This register</p>
            <div className="pos-apps-list">
              {POS_SURFACES.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  onClick={() => {
                    setAppsOpen(false);
                    if (surface.ownWindow) {
                      // A named window, so tapping Live twice raises the one
                      // that's already open instead of stacking a second.
                      const opened = window.open(
                        `${window.location.origin}${window.location.pathname}${surface.hash}`,
                        `alma-${surface.id}`
                      );
                      // Popup blocked, or a phone that has no second window to
                      // give: fall through to the ordinary navigation rather
                      // than leaving the tap doing nothing. Live's own header
                      // knows which case it is in and offers the way back.
                      if (opened) {
                        opened.focus();
                        return;
                      }
                    }
                    // main.tsx reloads on hashchange, so this IS the navigation.
                    window.location.hash = surface.hash;
                  }}
                >
                  <strong>{surface.label}</strong>
                  <small>{surface.hint}</small>
                </button>
              ))}
            </div>
            <p className="pos-apps-group">The suite</p>
            <div className="pos-apps-list">
              {SUITE_APP_LINKS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  disabled={appsBusy !== null}
                  onClick={() => {
                    setAppsBusy(app.id);
                    void openSuiteApp(app.href).finally(() => setAppsBusy(null));
                  }}
                >
                  <strong>{app.label}{appsBusy === app.id ? ' …' : ''}</strong>
                  <small>{app.hint}</small>
                </button>
              ))}
            </div>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setAppsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {folderDraft ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>
              {folderDraft.into
                ? `Add items to ${folderAtPath(home.pins, folderDraft.into)?.name ?? 'folder'}`
                : folderDraft.at
                  ? `New folder in ${folderAtPath(home.pins, folderDraft.at)?.name ?? 'folder'}`
                  : 'New folder'}
            </h2>
            {folderDraft.into ? null : (
              <>
                <input
                  className="pos-tender"
                  placeholder="Folder name (e.g. Happy hour, Kids)"
                  value={folderDraft.name}
                  onChange={(event) => setFolderDraft({ ...folderDraft, name: event.currentTarget.value })}
                />
                <span className="pos-swatches pos-swatches-row">
                  {['#4f8f6b', '#7f9ac4', '#d9a05a', '#c4655a', '#a98ac4', '#9aa4ab'].map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      className={`pos-swatch ${folderDraft.c === colour ? 'is-on' : ''}`}
                      style={{ background: colour }}
                      title={colour}
                      onClick={() => setFolderDraft({ ...folderDraft, c: colour })}
                    />
                  ))}
                </span>
              </>
            )}
            <input
              className="pos-tender"
              placeholder="Search items to add…"
              value={folderDraft.search}
              onChange={(event) => setFolderDraft({ ...folderDraft, search: event.currentTarget.value })}
            />
            <div className="pos-reason-list pos-pick-scroll">
              {menu
                .flatMap((category) => category.items)
                .filter((item) => !item.variantOf)
                .filter((item) => !folderDraft.search || item.title.toLowerCase().includes(folderDraft.search.toLowerCase()))
                .slice(0, 60)
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
              disabled={
                folderDraft.into
                  ? folderDraft.items.length === 0
                  : // A subfolder may start empty (drag items in from its
                    // parent later); a root folder still needs at least one.
                    !folderDraft.name.trim() || (!folderDraft.at && folderDraft.items.length === 0)
              }
              onClick={() => {
                const draft = folderDraft;
                let next: HomeConfig;
                if (draft.into) {
                  next = {
                    ...home,
                    pins: updateFolderAtPath(home.pins, draft.into, (folder) => ({
                      ...folder,
                      items: [...folder.items, ...draft.items.filter((id) => !folder.items.includes(id))]
                    }))
                  };
                } else if (draft.at) {
                  const child: FolderPin = { t: 'f', name: draft.name.trim(), c: draft.c, items: draft.items };
                  next = {
                    ...home,
                    pins: updateFolderAtPath(home.pins, draft.at, (folder) => ({ ...folder, folders: [...(folder.folders ?? []), child] }))
                  };
                } else {
                  next = {
                    ...home,
                    pins: [...home.pins, { t: 'f' as const, name: draft.name.trim(), c: draft.c, items: draft.items }]
                  };
                }
                setHome(next);
                setFolderDraft(null);
                saveBoard(next);
              }}
            >
              {folderDraft.into
                ? `Add ${folderDraft.items.length} item${folderDraft.items.length === 1 ? '' : 's'}`
                : `Create folder (${folderDraft.items.length} items)`}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setFolderDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {banquet ? (
        (() => {
          const { plan, covers, step, picks } = banquet;
          const asking = askableCourses(plan);
          const course = step >= 0 ? asking[step] ?? null : null;
          const owed = course ? banquetOwed(course, covers) : 0;
          const chosen = course ? banquetChosen(course.id) : 0;
          const left = owed - chosen;
          const last = step === asking.length - 1;
          return (
            <div className="pos-modal" role="dialog">
              <div className="pos-modal-panel pos-banquet">
                <div className="pos-banquet-head">
                  <h2>{plan.title}</h2>
                  {covers > 0 ? (
                    <span className="pos-banquet-covers">
                      {covers} {covers === 1 ? 'cover' : 'covers'}
                      {plan.salePriceCents ? ` · ${money(plan.salePriceCents)} each` : ''}
                    </span>
                  ) : null}
                </div>

                {course === null ? (
                  // How many are eating. Everything after this counts against
                  // it, so it is the one thing worth a screen of its own.
                  <div className="pos-banquet-covers-step">
                    <p className="pos-muted">How many are eating?</p>
                    <div className="pos-banquet-quick">
                      {[2, 4, 6, 8, 10, 12, 15, 18, 20, 25, 30, 40].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={covers === n ? 'is-on' : ''}
                          onClick={() => setBanquet({ ...banquet, covers: n })}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="pos-banquet-stepper">
                      <button type="button" onClick={() => setBanquet({ ...banquet, covers: Math.max(0, covers - 1) })}>
                        −
                      </button>
                      <input
                        className="pos-tender"
                        inputMode="numeric"
                        value={covers > 0 ? String(covers) : ''}
                        placeholder="0"
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value.replace(/\D/g, ''));
                          setBanquet({ ...banquet, covers: Number.isFinite(value) ? Math.min(200, value) : 0 });
                        }}
                      />
                      <button type="button" onClick={() => setBanquet({ ...banquet, covers: Math.min(200, covers + 1) })}>
                        +
                      </button>
                    </div>
                    {plan.fixed.length > 0 ? (
                      <p className="pos-banquet-fixed">
                        Everyone gets: {plan.fixed.map((component) => component.name).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <p className="pos-muted pos-banquet-ask">
                      {course.name} — {course.pick === 1 ? 'one each' : `${course.pick} each`}
                      {course.perGuests && course.perGuests > 1
                        ? `, shared between ${course.perGuests}`
                        : ''}
                    </p>
                    <div className="pos-banquet-options">
                      {course.options.map((option) => {
                        const heads = picks[course.id]?.[option.recipeId] ?? 0;
                        const off = eightySix.has(option.recipeId);
                        return (
                          <div key={option.id} className={`pos-banquet-option${heads > 0 ? ' is-on' : ''}${off ? ' is-86' : ''}`}>
                            <button
                              type="button"
                              className="pos-banquet-option-main"
                              disabled={off || left <= 0}
                              onClick={() => banquetPick(course, option.recipeId, 1)}
                            >
                              <span className="pos-banquet-option-name">{option.title}</span>
                              <span className="pos-banquet-option-meta">
                                {off
                                  ? "86'd"
                                  : option.supplementCents > 0
                                    ? `+${money(option.supplementCents)}`
                                    : option.salePriceCents
                                      ? `${money(option.salePriceCents)} à la carte`
                                      : ''}
                              </span>
                              {heads > 0 ? <span className="pos-banquet-count">{heads}</span> : null}
                              {heads > 0 && banquetPortions(course, heads) !== heads ? (
                                <span className="pos-banquet-portions">
                                  {banquetPortions(course, heads)} to plate
                                </span>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              className="pos-banquet-less"
                              aria-label={`One fewer ${option.title}`}
                              disabled={heads <= 0}
                              onClick={() => banquetPick(course, option.recipeId, -1)}
                            >
                              −
                            </button>
                            <button
                              type="button"
                              className="pos-banquet-rest"
                              disabled={off || left <= 0}
                              onClick={() => banquetFill(course, option.recipeId)}
                            >
                              Rest get this
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                <p className={`pos-banquet-progress${course && left === 0 ? ' is-done' : ''}`}>
                  {course === null
                    ? covers > 0
                      ? asking.length === 0
                        ? 'Nothing to choose — ring it and go'
                        : `${asking.length} ${asking.length === 1 ? 'course' : 'courses'} to choose`
                      : 'Set the number of covers to start'
                    : left === 0
                      ? `All ${owed} chosen`
                      : `${chosen} of ${owed} chosen · ${left} to go`}
                </p>

                <div className="pos-banquet-actions">
                  <button
                    type="button"
                    className="pos-ghost"
                    onClick={() => (step <= -1 ? setBanquet(null) : setBanquet({ ...banquet, step: step - 1 }))}
                  >
                    {step <= -1 ? 'Cancel' : 'Back'}
                  </button>
                  <button
                    type="button"
                    className="pos-charge"
                    // The guard that stops half-counted tables reaching the
                    // kitchen: you cannot move on until the heads add up.
                    disabled={busy || (course === null ? covers <= 0 : left !== 0)}
                    onClick={() => {
                      if (course === null) {
                        // A menu with nothing to choose is just an order —
                        // ring it and be done.
                        if (asking.length === 0) commitBanquet();
                        else setBanquet({ ...banquet, step: 0 });
                        return;
                      }
                      if (last) commitBanquet();
                      else setBanquet({ ...banquet, step: step + 1 });
                    }}
                  >
                    {course === null
                      ? asking.length === 0
                        ? 'Add to bill'
                        : 'Start'
                      : last
                        ? 'Add to bill'
                        : `Next: ${asking[step + 1]?.name ?? ''}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
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
                // Close the sheet and stamp the lines sent NOW — the sheet
                // used to sit frozen for the send round trip, then a second
                // redundant GET, before anything moved. Same optimistic
                // stamp fireCourse() already uses; the send response's
                // dockets still drive printing.
                setFireSheet(null);
                const stamp = new Date().toISOString();
                setOrder((current) =>
                  current
                    ? {
                        ...current,
                        lines: current.lines.map((line) =>
                          picked.includes(line.course ?? 'NOW') && !(line as { sentAt?: string | null }).sentAt
                            ? { ...line, sentAt: stamp }
                            : line
                        )
                      }
                    : current
                );
                void api<{ dockets: Docket[]; sent: number }>(`/api/pos/orders/${order.id}/send`, {
                  method: 'POST',
                  body: JSON.stringify({ courses: picked, firedByName: operatorName })
                })
                  .then((result) => {
                    if (result.dockets.length > 0) {
                      setAutoPrint(true);
                      setDockets(stampDockets(result.dockets, order));
                    }
                    setInfo(`${picked.join(' + ')} fired to the kitchen.`);
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

      {giftSale ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Sell a gift card</h2>

            <div className="pos-reason-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[50, 100, 150, 200, 250].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={Number(giftSale.amountDollars) === amount ? 'pos-chip is-on' : 'pos-chip'}
                  onClick={() => setGiftSale({ ...giftSale, amountDollars: String(amount) })}
                >
                  ${amount}
                </button>
              ))}
            </div>
            <input
              className="pos-tender"
              inputMode="decimal"
              placeholder="Or another amount"
              value={giftSale.amountDollars}
              onChange={(event) => setGiftSale({ ...giftSale, amountDollars: event.currentTarget.value })}
            />

            <input
              className="pos-tender"
              placeholder="Who is it for? (optional)"
              value={giftSale.recipientName}
              onChange={(event) => setGiftSale({ ...giftSale, recipientName: event.currentTarget.value })}
            />
            <input
              className="pos-tender"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Their email — we send the card here"
              value={giftSale.recipientEmail}
              onChange={(event) => setGiftSale({ ...giftSale, recipientEmail: event.currentTarget.value })}
            />

            <label className="pos-check-row">
              <input
                type="checkbox"
                checked={giftSale.physical}
                onChange={(event) => setGiftSale({ ...giftSale, physical: event.currentTarget.checked, code: '' })}
              />
              They are taking a physical card
            </label>
            {giftSale.physical ? (
              <>
                <input
                  className="pos-tender"
                  placeholder="Card number — leave blank and we'll make one up"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  value={giftSale.code}
                  onChange={(event) => setGiftSale({ ...giftSale, code: event.currentTarget.value.toUpperCase() })}
                />
                <p className="pos-hint">
                  Type the number already printed on the card, or leave it blank and write the number we generate onto a
                  blank one. Either way the card only goes live once the bill is paid.
                </p>
              </>
            ) : null}

            <p className="pos-hint">
              This goes on the bill now and is charged like anything else. The card itself is created, and the email
              sent, the moment the bill is paid — never before, so an abandoned sale cannot leave a live card behind.
            </p>

            <button
              type="button"
              className="pos-charge"
              disabled={giftSale.saving || !giftSale.amountDollars.trim()}
              onClick={() => void addGiftCardToBill()}
            >
              {giftSale.saving ? 'Adding…' : `Add $${giftSale.amountDollars.trim() || '0'} to the bill`}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setGiftSale(null)}>
              Cancel
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
                {/* Most real wastage is not a menu tile — a dropped tray of
                    prep, a blown keg, tomorrow's fish. The typed name is a
                    valid item; matching a tile only adds the recipe link. */}
                <button
                  type="button"
                  className="pos-wastage-freetext"
                  onClick={() => setWastage({ ...wastage, recipeId: '', itemName: wastage.search.trim() })}
                >
                  Use “{wastage.search.trim()}” as typed
                </button>
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
              {/* The reason list comes from the API; offline that map is
                  empty and the button dead-locked. This fallback mirrors the
                  server's ADJUST_REASONS.WASTAGE seed VERBATIM — the server
                  validates the reason against that list, so an invented
                  fallback would record nothing. */}
              {(reasons.WASTAGE?.length
                ? reasons.WASTAGE
                : ['Dropped / spilled', 'Kitchen error', 'Wrong order', 'Expired / off', 'Customer return', 'Over-prepped', 'Training']
              ).map((reason) => (
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

      {noteSheet && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Order note</h2>
            <p className="pos-muted">Prints on every docket for this bill.</p>
            <textarea
              className="pos-tender pos-note-area"
              autoFocus
              rows={4}
              value={noteSheet.value}
              onChange={(event) => setNoteSheet({ value: event.currentTarget.value })}
            />
            <button type="button" className="pos-charge" disabled={busy} onClick={() => void saveOrderMeta({ notes: noteSheet.value })}>
              Save note
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setNoteSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {dietSheet && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Dietaries</h2>
            <p className="pos-muted">
              Tag the whole table, or set a seat number first to tag one guest. Tags print on the docket header and
              under each dish — shared or unassigned dishes carry every tag, so when unsure it prints on everything.
            </p>
            <div className="pos-diet-current">
              {dietSheet.tags.map((tag, index) => (
                <button
                  key={`${tag.tag}-${index}`}
                  type="button"
                  onClick={() => setDietSheet({ ...dietSheet, tags: dietSheet.tags.filter((_, i) => i !== index) })}
                >
                  {tag.seat ? `${tag.tag} · S${tag.seat}` : tag.tag} ✕
                </button>
              ))}
              {dietSheet.tags.length === 0 ? <span className="pos-muted">No dietaries yet.</span> : null}
            </div>
            <input
              className="pos-tender"
              inputMode="numeric"
              placeholder="Seat number (blank = whole table)"
              value={dietSheet.seat}
              onChange={(event) => setDietSheet({ ...dietSheet, seat: event.currentTarget.value.replace(/\D/g, '').slice(0, 2) })}
            />
            <div className="pos-reason-list">
              {['GF', 'DF', 'Vegan', 'Vegetarian', 'Nut allergy', 'Shellfish allergy', 'Coeliac', 'Halal'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    setDietSheet({
                      ...dietSheet,
                      tags: [...dietSheet.tags, { tag: preset, seat: dietSheet.seat ? Number(dietSheet.seat) : null }]
                    })
                  }
                >
                  + {preset}
                </button>
              ))}
            </div>
            <div className="pos-diet-row">
              <input
                className="pos-tender"
                placeholder="Custom (e.g. anaphylaxis — sesame)"
                value={dietSheet.custom}
                onChange={(event) => setDietSheet({ ...dietSheet, custom: event.currentTarget.value })}
              />
              <button
                type="button"
                className="pos-ghost"
                disabled={!dietSheet.custom.trim()}
                onClick={() =>
                  setDietSheet({
                    ...dietSheet,
                    custom: '',
                    tags: [...dietSheet.tags, { tag: dietSheet.custom.trim().slice(0, 40), seat: dietSheet.seat ? Number(dietSheet.seat) : null }]
                  })
                }
              >
                Add
              </button>
            </div>
            <button type="button" className="pos-charge" disabled={busy} onClick={() => void saveOrderMeta({ dietary: dietSheet.tags })}>
              Save dietaries
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setDietSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {switchSheet ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Change user</h2>
            <p className="pos-muted">Enter your staff code — the register becomes yours.</p>
            <input
              className="pos-tender"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Staff code"
              value={switchSheet.pin}
              onChange={(event) => {
                const next = event.currentTarget.value.replace(/\D/g, '').slice(0, 8);
                setSwitchSheet({ pin: next });
                if (next.length === 4) void submitSwitch(next);
              }}
            />
            <PosKeypad
              value={switchSheet.pin}
              onChange={(next) => {
                setSwitchSheet({ pin: next });
                if (next.length === 4) void submitSwitch(next);
              }}
              onSubmit={() => {
                if (switchSheet.pin.length >= 4) void submitSwitch(switchSheet.pin);
              }}
            />
            <button type="button" className="pos-ghost" onClick={signOutFully}>
              Sign out of this register
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setSwitchSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {lockScreen ? (
        <div className="pos-modal pos-lock" role="dialog">
          <div className="pos-modal-panel">
            <img src={ALMA_MARK} alt="" className="pos-mark" />
            <h2>Register locked</h2>
            <p className="pos-muted">Idle for a minute — the bill is saved. Enter your staff code to keep going.</p>
            <input
              className="pos-tender"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Staff code"
              value={lockPin}
              onChange={(event) => {
                const next = event.currentTarget.value.replace(/\D/g, '').slice(0, 8);
                setLockPin(next);
                if (next.length === 4) void unlockWithPin(next);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && lockPin.length >= 4) void unlockWithPin(lockPin);
              }}
            />
            <PosKeypad
              value={lockPin}
              onChange={(next) => {
                setLockPin(next);
                if (next.length === 4) void unlockWithPin(next);
              }}
              onSubmit={() => {
                if (lockPin.length >= 4) void unlockWithPin(lockPin);
              }}
            />
            <button type="button" className="pos-charge" disabled={busy || lockPin.length < 4} onClick={() => void unlockWithPin(lockPin)}>
              Unlock
            </button>
          </div>
        </div>
      ) : null}
      {splitPick && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{splitPick.mode === 'seat' ? 'Split by seat' : 'Split by item'}</h2>
            {splitPick.mode === 'seat' ? (
              <>
                <p className="pos-muted">Whose seat is paying?</p>
                <div className="pos-reason-list">
                  {[...new Set(order.lines.map((line) => line.seat ?? 0))]
                    .sort((a, b) => a - b)
                    .map((seat) => (
                      <button
                        key={seat}
                        type="button"
                        className={splitPick.seat === seat ? 'is-on' : ''}
                        onClick={() =>
                          setSplitPick({
                            mode: 'seat',
                            seat,
                            picked: order.lines.filter((line) => (line.seat ?? 0) === seat).map((line) => line.id ?? '')
                          })
                        }
                      >
                        {seat === 0 ? 'Unassigned' : `Seat ${seat}`}
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <>
                <p className="pos-muted">Tap what this person is paying for.</p>
                <div className="pos-split-lines">
                  {order.lines.map((line) => {
                    const id = line.id ?? '';
                    const on = splitPick.picked.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={on ? 'is-on' : ''}
                        onClick={() =>
                          setSplitPick({
                            ...splitPick,
                            picked: on ? splitPick.picked.filter((entry) => entry !== id) : [...splitPick.picked, id]
                          })
                        }
                      >
                        <span>
                          {line.quantity}× {line.name}
                          {line.seat ? ` · S${line.seat}` : ''}
                        </span>
                        <b>{money(line.unitPriceCents * line.quantity)}</b>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {(() => {
              const picked = order.lines.filter((line) => splitPick.picked.includes(line.id ?? ''));
              const gross = picked.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
              // Their share of the bill's surcharge/discount, so the parts
              // still add up to the whole.
              const share = order.subtotalCents > 0 ? gross / order.subtotalCents : 0;
              const amountCents = Math.min(balance, Math.round(order.totalCents * share));
              return (
                <>
                  <div className="pos-totals">
                    <span>
                      {picked.length} item{picked.length === 1 ? '' : 's'}
                    </span>
                    <strong>{money(amountCents)}</strong>
                  </div>
                  <button
                    type="button"
                    className="pos-charge"
                    disabled={busy || amountCents <= 0}
                    onClick={() => {
                      setSplitPick(null);
                      setCharge({ stage: 'method', tipCents: 0, amountCents });
                    }}
                  >
                    Charge {money(amountCents)}
                  </button>
                </>
              );
            })()}
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setSplitPick(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {voidConfirm && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Void this bill?</h2>
            <p className="pos-muted">
              {order.lines.length === 0 ? (
                <>Nothing on this bill — voiding just closes the sale.</>
              ) : (
                <>
                  {order.lines.reduce((sum, line) => sum + line.quantity, 0)} item
                  {order.lines.reduce((sum, line) => sum + line.quantity, 0) === 1 ? '' : 's'} · {money(order.totalCents)}
                  {order.tableLabel ? ` · Table ${order.tableLabel}` : ''} — the whole bill is cancelled and the kitchen is
                  not told automatically.
                </>
              )}
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

      {/* The codes this bill just issued. Shown once, big enough to copy
          onto the physical cards. */}
      {giftIssued.length > 0 ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{giftIssued.length === 1 ? 'Gift card issued' : `${giftIssued.length} gift cards issued`}</h2>
            <p className="pos-muted">Write these on the cards and hand them over. Each is valid for three years.</p>
            {giftIssued.map((card) => (
              <div key={card.code}>
                <div className="pos-giftcode">{card.code}</div>
                <p className="pos-change">{money(card.amountCents)}</p>
              </div>
            ))}
            <button type="button" className="pos-charge" onClick={() => window.print()}>
              ⎙ Print
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setGiftIssued([])}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {/* Selling a gift card: it goes ON THE BILL and is paid for like
          anything else. The card itself is issued when the bill settles. */}
      {giftSell ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Add a gift card</h2>
            <p className="pos-muted">
              It goes on the bill and is paid for with everything else. The card is issued once the bill
              is settled — no GST, and no surcharge or discount applies to it.
            </p>
            <div className="pos-choice-row">
              {[50, 100, 150, 200].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={giftSell.amount === String(value) ? 'is-on' : ''}
                  onClick={() => setGiftSell({ ...giftSell, amount: String(value) })}
                >
                  ${value}
                </button>
              ))}
            </div>
            <input
              className="pos-tender"
              inputMode="decimal"
              placeholder="Amount $"
              value={giftSell.amount}
              onChange={(event) => setGiftSell({ ...giftSell, amount: event.currentTarget.value.replace(/[^0-9.]/g, '') })}
            />
            <input
              className="pos-tender"
              placeholder="Who it's for (optional)"
              value={giftSell.recipientName}
              onChange={(event) => setGiftSell({ ...giftSell, recipientName: event.currentTarget.value })}
            />
            <input
              className="pos-tender"
              inputMode="email"
              placeholder="Email it to them (optional)"
              value={giftSell.recipientEmail}
              onChange={(event) => setGiftSell({ ...giftSell, recipientEmail: event.currentTarget.value })}
            />
            <input
              className="pos-tender"
              placeholder="Pre-printed card number (leave blank to issue one)"
              value={giftSell.code}
              onChange={(event) => setGiftSell({ ...giftSell, code: event.currentTarget.value.toUpperCase() })}
            />
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !order || !(Number(giftSell.amount) >= 5)}
              onClick={() => {
                if (!order) return;
                setBusy(true);
                void api<Order>(`/api/pos/orders/${order.id}/gift-cards`, {
                  method: 'POST',
                  body: JSON.stringify({
                    amountCents: Math.round(Number(giftSell.amount) * 100),
                    recipientName: giftSell.recipientName.trim() || undefined,
                    recipientEmail: giftSell.recipientEmail.trim() || undefined,
                    code: giftSell.code.trim() || undefined
                  })
                })
                  .then((updated) => {
                    setOrder(updated);
                    setGiftSell(null);
                    setInfo('Gift card added to the bill — charge it to issue the card.');
                  })
                  .catch((err) => setError(messageForError(err, 'Could not add the gift card.')))
                  .finally(() => setBusy(false));
              }}
            >
              {order ? `Add ${Number(giftSell.amount) >= 5 ? money(Math.round(Number(giftSell.amount) * 100)) : 'card'} to the bill` : 'Start a sale first'}
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setGiftSell(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Everything you do TO a bill, in one chooser off the Discount button. */}
      {billActions && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{order.tableLabel ? `Table ${order.tableLabel}` : `Sale #${order.orderNumber}`}</h2>
            <p className="pos-muted">
              {order.lines.length} item{order.lines.length === 1 ? '' : 's'} · {money(order.totalCents)}
              {paidCents(order) > 0 ? ` · ${money(order.totalCents - paidCents(order))} owing` : ''}
            </p>

            <p className="pos-actions-head">Discount &amp; comp</p>
            <div className="pos-action-list">
              <button
                type="button"
                onClick={() => {
                  setBillActions(false);
                  setDiscounting({ mode: 'percent', value: '10', reason: '' });
                }}
              >
                <span>Discount %</span>
                <em>a percentage off the whole bill</em>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBillActions(false);
                  setDiscounting({ mode: 'amount', value: '', reason: '' });
                }}
              >
                <span>Discount $</span>
                <em>a fixed amount off the whole bill</em>
              </button>
              <button
                type="button"
                disabled={order.lines.length === 0}
                onClick={() => {
                  setBillActions(false);
                  setPickLine('COMP');
                }}
              >
                <span>Comp an item</span>
                <em>on the house — pick the item, give a reason</em>
              </button>
              <button
                type="button"
                disabled={order.lines.length === 0}
                onClick={() => {
                  setBillActions(false);
                  setPickLine('PRICE_CHANGE');
                }}
              >
                <span>Change an item price</span>
                <em>override one line's price</em>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBillActions(false);
                  setWastage({ search: '', recipeId: '', itemName: '', quantity: '1', reason: '' });
                }}
              >
                <span>Record wastage</span>
                <em>dropped, spilled or binned — comes off stock, not this bill</em>
              </button>
            </div>

            <p className="pos-actions-head">This bill</p>
            <div className="pos-action-list">
              <button
                type="button"
                disabled={order.lines.length === 0}
                onClick={() => {
                  setBillActions(false);
                  setBill(order);
                }}
              >
                <span>Print bill</span>
                <em>the guest's itemised bill</em>
              </button>
              <button
                type="button"
                disabled={order.lines.length === 0}
                onClick={() => {
                  setBillActions(false);
                  printFullOrder();
                }}
              >
                <span>Print docket</span>
                <em>the whole order for the kitchen — fires nothing</em>
              </button>
              <button
                type="button"
                disabled={order.lines.length === 0 || balance <= 0}
                onClick={() => {
                  setBillActions(false);
                  setCharge({ stage: 'split', tipCents: 0, amountCents: null });
                }}
              >
                <span>Split payment</span>
                <em>by guests, by item, by seat or a custom amount</em>
              </button>
              {order.tableLabel ? (
                <button
                  type="button"
                  onClick={() => {
                    setBillActions(false);
                    setMerging(openOrders.filter((open) => open.id !== order.id));
                  }}
                >
                  <span>Merge with another table</span>
                  <em>bring two bills together</em>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setBillActions(false);
                  setOrder(null);
                }}
              >
                <span>Leave this bill</span>
                <em>stays open on the floor</em>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBillActions(false);
                  setReporting({ text: '', blocking: false, sent: false });
                }}
              >
                <span>Report a problem</span>
                <em>something's wrong with the register — tell whoever fixes it</em>
              </button>
            </div>

            <p className="pos-actions-head">Careful</p>
            <div className="pos-action-list">
              <button
                type="button"
                className="pos-action-danger"
                disabled={busy || paidCents(order) > 0}
                onClick={() => {
                  setBillActions(false);
                  setVoidConfirm(true);
                }}
              >
                <span>Void this bill</span>
                <em>
                  {paidCents(order) > 0
                    ? 'already part-paid — refund it instead'
                    : order.lines.length === 0
                      ? 'nothing on it — just closes the sale'
                      : 'needs a manager'}
                </em>
              </button>
            </div>

            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setBillActions(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {/* Comp / price change need a line — pick it here rather than making
          the operator hunt for the tap target on the bill. */}
      {pickLine && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{pickLine === 'COMP' ? 'Comp which item?' : 'Change which price?'}</h2>
            <div className="pos-action-list">
              {order.lines.map((line) => (
                <button
                  key={line.id ?? `${line.recipeId}-${line.name}`}
                  type="button"
                  disabled={!line.id}
                  onClick={() => {
                    setPickLine(null);
                    setLineAction({ lineId: line.id!, name: line.name, kind: pickLine, reason: '', price: '' });
                  }}
                >
                  <span>
                    {line.quantity} × {line.name}
                  </span>
                  <em>
                    {money(line.unitPriceCents * line.quantity)}
                    {line.course ? ` · ${line.course}` : ''}
                  </em>
                </button>
              ))}
            </div>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setPickLine(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {variantSheet ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>{variantSheet.title}</h2>
            <p className="pos-muted">Which one?</p>
            <div className="pos-variant-list">
              {(variantSheet.variants ?? []).map((option) => (
                <button
                  key={option.recipeId}
                  type="button"
                  className={eightySix.has(option.recipeId) ? 'is-86d' : ''}
                  onClick={() => {
                    setVariantSheet(null);
                    // printTitle rides along so the kitchen sees the
                    // preparation ("Battered Barramundi Taco"), not the
                    // parent tile's name.
                    addItem({
                      recipeId: option.recipeId,
                      title: option.title,
                      printTitle: option.printTitle ?? null,
                      priceCents: option.priceCents,
                      venue: option.venue
                    });
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
              onChange={(event) => {
                const next = event.currentTarget.value.replace(/\D/g, '').slice(0, 8);
                setManagerGate({ ...managerGate, pin: next });
                if (next.length === 4) managerGate.retry(next);
              }}
            />
            <PosKeypad
              value={managerGate.pin}
              onChange={(next) => {
                setManagerGate({ ...managerGate, pin: next });
                if (next.length === 4) managerGate.retry(next);
              }}
              onSubmit={() => {
                if (managerGate.pin.length >= 4) managerGate.retry(managerGate.pin);
              }}
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
                Management buttons <small>{home.pins.filter((pin) => pin.t === 'm').length} on the board</small>
              </summary>
              <div className="pos-acc-body">
                {MGMT_KEYS.map((key) => {
                  const on = home.pins.some((pin) => pin.t === 'm' && pin.key === key);
                  return (
                    <label key={key} className="pos-check-row">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setHome({
                            ...home,
                            pins: on
                              ? home.pins.filter((pin) => !(pin.t === 'm' && pin.key === key))
                              : [...home.pins, { t: 'm' as const, key }]
                          })
                        }
                      />
                      {MGMT_LABELS[key]}
                    </label>
                  );
                })}
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
                    const label =
                      pin.t === 'f'
                        ? `📁 ${pin.name}`
                        : pin.t === 'm'
                          ? `⚙ ${MGMT_LABELS[pin.key] ?? pin.key}`
                          : resolvePinItem(pin.id)?.title ?? '?';
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
            <details className="pos-acc" open>
              <summary>Add item pins</summary>
              <div className="pos-acc-body">
                {(() => {
                  const pinned = new Set(home.pins.filter((pin) => pin.t === 'i').map((pin) => (pin as { id: string }).id));
                  const all = menu.flatMap((category) => category.items);
                  const suggestions = topSellers
                    .filter((recipeId) => !pinned.has(recipeId))
                    .map((recipeId) => all.find((item) => item.recipeId === recipeId))
                    .filter((item): item is MenuItem => Boolean(item))
                    .slice(0, 10);
                  const folders = [...menu]
                    .filter((category) => !home.pins.some((pin) => pin.t === 'f' && pin.name === category.name))
                    .sort((a, b) => b.items.length - a.items.length)
                    .slice(0, 6);
                  return (
                    <>
                      {suggestions.length > 0 ? (
                        <>
                          <p className="pos-muted">Your best sellers this month:</p>
                          <div className="pos-reason-list">
                            {suggestions.map((item) => (
                              <button
                                key={item.recipeId}
                                type="button"
                                onClick={() => setHome({ ...home, pins: [...home.pins, { t: 'i', id: item.recipeId }] })}
                              >
                                ＋ {item.title}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                      {folders.length > 0 ? (
                        <>
                          <p className="pos-muted">Suggested folders:</p>
                          <div className="pos-reason-list">
                            {folders.map((category) => (
                              <button
                                key={category.name}
                                type="button"
                                onClick={() =>
                                  setHome({
                                    ...home,
                                    pins: [
                                      ...home.pins,
                                      { t: 'f', name: category.name, items: category.items.filter((item) => !item.variantOf).map((item) => item.recipeId).slice(0, 40) }
                                    ]
                                  })
                                }
                              >
                                📁 {category.name} ({category.items.length})
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </>
                  );
                })()}
                <p className="pos-muted">Or search:</p>
                <input
                  className="pos-tender"
                  placeholder="Search items to pin…"
                  value={pinSearch}
                  onChange={(event) => setPinSearch(event.currentTarget.value)}
                />
                <div className="pos-reason-list pos-pick-scroll">
                  {menu
                    .flatMap((category) => category.items)
                    .filter((item) => !item.variantOf)
                    .filter((item) => !pinSearch || item.title.toLowerCase().includes(pinSearch.toLowerCase()))
                    .filter((item) => !home.pins.some((pin) => pin.t === 'i' && pin.id === item.recipeId))
                    .slice(0, 40)
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
                Training <small>{trainingLocked ? 'ON — this account' : training ? 'ON' : 'off'}</small>
              </summary>
              <div className="pos-acc-body">
                {trainingLocked ? (
                  <p className="pos-hint">
                    This account is a training till. Every bill it opens is a practice sale — no takings, no drawer, no
                    reports, nothing to the kitchen — and card terminals and gift cards are switched off on it. It cannot
                    be turned off from here; an admin changes it on the staff profile.
                  </p>
                ) : (
                  <label className="pos-check-row">
                    <input
                      type="checkbox"
                      checked={trainingSwitch}
                      onChange={() => {
                        const next = !trainingSwitch;
                        setTrainingSwitch(next);
                        localStorage.setItem('alma.pos.training', next ? '1' : '0');
                      }}
                    />
                    Training mode — practice sales that never post
                  </label>
                )}
              </div>
            </details>
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !userKey}
              onClick={() => {
                // Send the WHOLE config: the server rebuilds the row from the
                // body, so omitting categories/buttonSizes wipes the nav.
                void api('/api/pos/homescreen', {
                  method: 'PUT',
                  body: JSON.stringify({
                    userKey,
                    buttons: home.buttons,
                    pins: home.pins,
                    categories: home.categories ?? undefined,
                    buttonSizes: home.buttonSizes ?? undefined,
                    landingCategory: home.landingCategory ?? '',
                    updatedBy: operatorName
                  })
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
              <div key={index} className={`pos-docket ${docket.printerIp ? 'pos-print-skip' : ''}`} data-docket-index={index} data-direct={docket.printerIp ? '1' : undefined}>
                <div className="pos-docket-head">
                  <h2>
                    {docket.profile}
                    {docket.printerIp ? <em className="pos-docket-direct">⚡ printing at the station</em> : null}
                    {dockets.length > 1 ? (
                      <button
                        type="button"
                        className="pos-docket-printone"
                        onClick={() => {
                          document.querySelectorAll('.pos-docket').forEach((el) => {
                            if (el.getAttribute('data-docket-index') !== String(index)) el.classList.add('pos-print-skip');
                            else el.classList.remove('pos-print-skip');
                          });
                          const clear = () => {
                            document.querySelectorAll('.pos-docket').forEach((el) => {
                              el.classList.toggle('pos-print-skip', el.getAttribute('data-direct') === '1');
                            });
                            window.removeEventListener('afterprint', clear);
                          };
                          window.addEventListener('afterprint', clear);
                          window.print();
                        }}
                      >
                        ⎙ this station
                      </button>
                    ) : null}
                  </h2>
                  {/* The kitchen reads this top-down: what kind of docket,
                      where it goes, when it was called, who to ask. */}
                  <div className={`pos-docket-kind is-${(docket.kind ?? 'FIRE').toLowerCase()}`}>
                    {docket.kind === 'HOLD' ? 'HOLD — DO NOT MAKE' : docket.kind === 'FULL' ? 'FULL ORDER — REFERENCE' : '🔥 FIRE — MAKE NOW'}
                  </div>
                  <div className="pos-docket-where">
                    <strong>{docket.tableLabel ? `TABLE ${docket.tableLabel}` : `ORDER #${docket.orderNumber}`}</strong>
                    <span className={`pos-docket-type is-${(docket.orderType ?? 'DINE_IN') === 'TAKEAWAY' ? 'away' : 'in'}`}>
                      {(docket.orderType ?? 'DINE_IN') === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE IN'}
                    </span>
                    {docket.covers ? <span className="pos-docket-covers">{docket.covers} guests</span> : null}
                  </div>
                  <p className="pos-muted pos-docket-meta">
                    {docket.tableLabel ? `Order #${docket.orderNumber} · ` : ''}
                    Ordered {clockTime(docket.orderedAt) || '—'}
                    {docket.firedAt ? ` · Fired ${clockTime(docket.firedAt)}` : ''}
                    {` · Printed ${clockTime(new Date().toISOString())}`}
                  </p>
                  <p className="pos-muted pos-docket-meta">
                    Taken by {docket.openedByName || '—'}
                    {docket.firedByName ? ` · Called away by ${docket.firedByName}` : ''}
                  </p>
                </div>
                {(docket.dietary ?? []).length ? (
                  <div className="pos-docket-diet">
                    ⚠ DIETARY: {(docket.dietary ?? []).map((tag) => (tag.seat ? `${tag.tag} (S${tag.seat})` : tag.tag)).join(' · ')}
                  </div>
                ) : null}
                {docket.orderNotes ? <div className="pos-docket-note">✎ {docket.orderNotes}</div> : null}
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
                            {(() => {
                              const seat = (line as { seat?: number | null }).seat ?? null;
                              const tags = (docket.dietary ?? []).filter((tag) => tag.seat === null || seat === null || tag.seat === seat);
                              return tags.length ? <em className="pos-docket-diettag">⚠ {tags.map((tag) => tag.tag).join(' · ')}</em> : null;
                            })()}
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
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                setCashCount({ counts: {}, expected: null });
                void api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
                  .then((info) => setCashCount((current) => (current ? { ...current, expected: info.expectedCents } : current)))
                  .catch(() => undefined);
              }}
            >
              Cash count
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setDay(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {cashCount ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>Cash count</h2>
            <p className="pos-muted">How many of each — the total and variance work themselves out.</p>
            <div className="pos-cash-rows">
              {CASH_DENOMS.map(([label, cents]) => {
                const qty = Number(cashCount.counts[label] || '0');
                return (
                  <label key={label} className="pos-cash-row">
                    <b>{label.endsWith('c') ? label : `$${label}`}</b>
                    <input
                      inputMode="numeric"
                      placeholder="0"
                      value={cashCount.counts[label] ?? ''}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          counts: { ...cashCount.counts, [label]: event.currentTarget.value.replace(/\D/g, '').slice(0, 4) }
                        })
                      }
                    />
                    <span>{qty > 0 ? money(qty * cents) : '—'}</span>
                  </label>
                );
              })}
            </div>
            {(() => {
              const total = CASH_DENOMS.reduce((sum, [label, cents]) => sum + Number(cashCount.counts[label] || '0') * cents, 0);
              return (
                <div className="pos-cash-total">
                  <div>
                    <span>Counted</span>
                    <strong>{money(total)}</strong>
                  </div>
                  {cashCount.expected !== null ? (
                    <>
                      <div>
                        <span>Expected in drawer</span>
                        <strong>{money(cashCount.expected)}</strong>
                      </div>
                      <div className={total - cashCount.expected === 0 ? '' : total - cashCount.expected > 0 ? 'is-over' : 'is-under'}>
                        <span>Variance</span>
                        <strong>
                          {total - cashCount.expected >= 0 ? '+' : '−'}
                          {money(Math.abs(total - cashCount.expected))}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <p className="pos-muted">No open drawer to compare — total only.</p>
                  )}
                </div>
              );
            })()}
            <button type="button" className="pos-ghost" onClick={() => setCashCount({ ...cashCount, counts: {} })}>
              Clear
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setCashCount(null)}>
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
/**
 * The Bills page — what the floor actually asks: who is sitting where, how
 * long they've been there, what they owe, and who has already paid.
 *
 * This replaces the old bills popup. Splitting lives here too, because
 * "can we split this" is a question asked about a bill, not about a till.
 */
function BillsPage({
  openOrders,
  settled,
  busy,
  onOpen,
  onSplit,
  onMore,
  onReceipt,
  onNewOrder,
  onRefresh,
  onReinstate,
  onRefund
}: {
  openOrders: Order[];
  settled: Order[];
  busy: boolean;
  onOpen: (order: Order) => void;
  onSplit: (order: Order) => void;
  onMore: (order: Order) => void;
  onReceipt: (order: Order) => void;
  onNewOrder: () => void;
  onRefresh: () => void;
  onReinstate: (order: Order) => void;
  onRefund: (order: Order) => void;
}) {
  // Re-render each minute so the "sitting 1h 20m" stays honest without a poll.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const guestName = (order: Order) => {
    const guest = (order as Order & { guest?: { firstName?: string; lastName?: string } | null }).guest;
    const named = guest ? `${guest.firstName ?? ''} ${guest.lastName ?? ''}`.trim() : '';
    if (named) return named;
    // QR orders record the guest's name in the note as "QR: Sam".
    const fromNote = /QR:\s*([^·]+)/.exec(order.notes ?? '')?.[1]?.trim();
    return fromNote || '';
  };

  return (
    <div className="pos-home pos-bills-page">
      <div className="pos-bills-head">
        <h2>Bills</h2>
        <span className="pos-muted">
          {openOrders.length} open · {settled.length} settled today
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="pos-ghost" onClick={onRefresh}>
          ↻ Refresh
        </button>
        <button type="button" className="pos-ghost" onClick={onNewOrder}>
          ＋ New order
        </button>
      </div>

      {openOrders.length === 0 ? <p className="pos-muted">Nothing open right now.</p> : null}
      <div className="pos-bills-grid">
        {openOrders.map((row) => {
          const minutes = elapsedMinutes(row as Order & { createdAt?: string });
          const owing = row.totalCents - paidCents(row);
          const name = guestName(row);
          const waiting = (row.lines as Array<{ sentAt?: string | null }>).some((line) => !line.sentAt);
          return (
            <div key={row.id} className={`pos-bill-card ${stayClass(minutes)}`}>
              <div className="pos-bill-card-head">
                <strong>{row.tableLabel ? `Table ${row.tableLabel}` : `Sale #${row.orderNumber}`}</strong>
                {minutes !== null ? <em className="pos-bill-time">{elapsedLabel(minutes)}</em> : null}
              </div>
              {name ? <div className="pos-bill-guest">{name}</div> : null}
              <div className="pos-bill-meta">
                {row.covers ? `${row.covers} covers · ` : ''}
                {row.lines.reduce((sum, line) => sum + line.quantity, 0)} items
                {(row as Order & { openedByName?: string | null }).openedByName
                  ? ` · ${(row as Order & { openedByName?: string | null }).openedByName}`
                  : ''}
              </div>
              {(row.dietary ?? []).length > 0 ? (
                <div className="pos-bill-diet">⚠ {(row.dietary ?? []).map((tag) => tag.tag).join(' · ')}</div>
              ) : null}
              {row.notes ? <div className="pos-bill-note">✎ {row.notes}</div> : null}
              <div className="pos-bill-figures">
                <span>{paidCents(row) > 0 ? `${money(paidCents(row))} paid` : waiting ? 'Not yet sent' : 'Sent'}</span>
                <b>{money(owing)}</b>
              </div>
              <div className="pos-bill-actions">
                <button type="button" disabled={busy} onClick={() => onOpen(row)}>
                  Open
                </button>
                {/* Same screen as before — it just says what it's for. */}
                <button type="button" disabled={busy || row.lines.length === 0} onClick={() => onSplit(row)}>
                  Pay
                </button>
                {/* Never disabled for an empty bill: More is the only road to
                    Void, and an EMPTY abandoned sale is exactly the one that
                    needs voiding (the server voids empty bills freely). */}
                <button type="button" disabled={busy} onClick={() => onMore(row)}>
                  More
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {settled.length > 0 ? (
        <>
          <h3 className="pos-bills-subhead">Settled today</h3>
          <div className="pos-bills-grid">
            {settled.map((row) => {
              const refunded = row.payments
                .filter((payment) => payment.amountCents < 0)
                .reduce((sum, payment) => sum - payment.amountCents, 0);
              const name = guestName(row);
              return (
                <div key={row.id} className={`pos-bill-card is-settled ${row.status === 'VOID' ? 'is-void' : ''}`}>
                  <div className="pos-bill-card-head">
                    <strong>{row.tableLabel ? `Table ${row.tableLabel}` : `#${row.orderNumber}`}</strong>
                    <em className="pos-bill-time">{row.status === 'VOID' ? 'void' : 'paid'}</em>
                  </div>
                  {name ? <div className="pos-bill-guest">{name}</div> : null}
                  <div className="pos-bill-meta">
                    {row.payments.map((payment) => payment.method.replace(/_/g, ' ').toLowerCase()).join(', ') || '—'}
                    {refunded > 0 ? ` · ${money(refunded)} refunded` : ''}
                  </div>
                  <div className="pos-bill-figures">
                    <span>{row.covers ? `${row.covers} covers` : ''}</span>
                    <b>{money(row.totalCents)}</b>
                  </div>
                  <div className="pos-bill-actions">
                    <button type="button" onClick={() => onReceipt(row)}>
                      View
                    </button>
                    {/* A settled bill is not a closed book. A wrong item, a
                        return, a guest who came back for one more — all of it
                        happens after someone has paid. */}
                    {row.status === 'PAID' ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => onReinstate(row)}>
                          Reinstate
                        </button>
                        <button type="button" disabled={busy} onClick={() => onRefund(row)}>
                          Refund
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

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
              className={`pos-floor-table ${open ? `is-occupied is-${fireState(open.lines as Array<{ sentAt?: string | null }>)} ${stayClass(elapsedMinutes(open as Order & { createdAt?: string }))}` : ''} ${!open && nextByTable.has(table.label.toLowerCase()) ? 'is-reserved' : ''} ${table.shape === 'round' ? 'is-round' : ''}`}
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
            Sales without a table live on the Bills page.
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

// On-screen keypad for iPads: codes never rely on a hardware keyboard.
function PosKeypad({ value, onChange, onSubmit }: { value: string; onChange: (next: string) => void; onSubmit?: () => void }) {
  return (
    <div className="pos-keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((key) => (
        <button
          key={key}
          type="button"
          className={key === '✓' ? 'is-go' : ''}
          onClick={() => {
            if (key === '⌫') onChange(value.slice(0, -1));
            else if (key === '✓') onSubmit?.();
            else if (value.length < 8) onChange(value + key);
          }}
        >
          {key}
        </button>
      ))}
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
      const res = await api<{ pinToken?: string }>('/api/device/pin-login', {
        method: 'POST',
        body: JSON.stringify({ staffProfileId: selected.id, pin: nextPin })
      });
      setApiPinToken(res.pinToken);
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
  // We were sent to Alma Home to sign in and we're still here signed out.
  const [bounced] = useState(() => Boolean(sessionStorage.getItem(BOUNCE_KEY)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token?: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setApiAuthToken(res.token);
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
        <img src={ALMA_MARK} alt="" className="pos-mark pos-signin-mark" />
        <h1>ALMA POS</h1>
        {bounced ? (
          <>
            <p className="pos-muted">
              Alma Home sent you here but the sign-in didn't carry across. Rather than bounce you back
              and forth, sign in on this device below.
            </p>
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                sessionStorage.removeItem(BOUNCE_KEY);
                window.location.href = 'https://alma-home.web.app';
              }}
            >
              Try Alma Home once more
            </button>
          </>
        ) : (
          <>
            <p className="pos-muted">Sign in at Alma Home, then tap the POS button.</p>
            <button
              type="button"
              className="pos-charge"
              onClick={() => {
                // Remember we've been sent out once, so a failed handoff shows
                // the device sign-in instead of starting the round trip again.
                sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
                window.location.href = 'https://alma-home.web.app';
              }}
            >
              Sign in at Alma Home
            </button>
          </>
        )}
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
