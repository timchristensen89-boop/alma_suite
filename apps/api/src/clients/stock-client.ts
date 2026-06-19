/**
 * Stock API client (read-only).
 *
 * THE single approved way for the suite to read stock-domain data.
 *
 * Background: today several suite services (reports, integration, loaded-import,
 * staff costing) query stock tables directly via `prisma.stockItem`, `recipe`,
 * `stocktake`, etc. That direct coupling is what the stock-forward separation is
 * removing. As each call site is migrated, it should read through this client
 * instead of importing stock Prisma models. The boundary guard
 * (`scripts/check-domain-boundaries.mjs`) tracks remaining direct accesses.
 *
 * This is intentionally read-only. Writes to stock data must go through
 * stock-api's own routes/services — the suite should never mutate stock tables.
 *
 * Endpoints below are aligned to the ACTUAL stock-api routes (verified against
 * apps/stock-api/src/routes/*). Response typing is deliberately permissive for
 * now; tighten to shared types from stock-api as each endpoint is migrated.
 */

const STOCK_API_URL =
  process.env.STOCK_API_URL ??
  process.env.VITE_STOCK_API_URL ??
  'http://localhost:3019';

export interface StockClientOptions {
  /** Forwarded so stock-api can authorize the request as the acting user. */
  authToken?: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class StockClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'StockClientError';
  }
}

async function request<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  opts: StockClientOptions = {}
): Promise<T> {
  const url = new URL(`${STOCK_API_URL.replace(/\/$/, '')}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  const signal = opts.signal ?? controller.signal;

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.authToken ? { authorization: `Bearer ${opts.authToken}` } : {})
      },
      signal
    });
    const text = await res.text();
    const body = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new StockClientError(res.status, `Stock API ${res.status} for ${path}`, body);
    }
    return body as T;
  } catch (err) {
    if (err instanceof StockClientError) throw err;
    throw new StockClientError(
      0,
      `Cannot reach Stock API at ${STOCK_API_URL} (${path}). Is stock-api running?`,
      err instanceof Error ? err.message : err
    );
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Read-only stock data accessors used by the suite. Each maps to a verified
 * stock-api GET route. `venue` is the venue slug (matches stock-api's
 * `req.query.venue`). Shapes are `unknown`-ish until migrated to shared types.
 */
export const stockClient = {
  baseUrl: STOCK_API_URL,

  /** GET /api/items?venue= — items catalogue, optionally scoped to a venue slug. */
  listItems(params: { venue?: string } = {}, opts?: StockClientOptions) {
    return request<unknown[]>('/api/items', { venue: params.venue }, opts);
  },

  /** GET /api/recipes?withSales= — recipes, optionally with N-day sales lookback. */
  listRecipes(params: { withSalesLookbackDays?: number } = {}, opts?: StockClientOptions) {
    return request<unknown[]>('/api/recipes', { withSales: params.withSalesLookbackDays }, opts);
  },

  /** GET /api/recipes/:id */
  getRecipe(id: string, opts?: StockClientOptions) {
    return request<unknown>(`/api/recipes/${encodeURIComponent(id)}`, {}, opts);
  },

  /** GET /api/recipes/cost-of-goods?venue=&days= — COGS for reports/dish-margin. */
  costOfGoods(params: { venue?: string; days?: number } = {}, opts?: StockClientOptions) {
    return request<unknown>('/api/recipes/cost-of-goods', { venue: params.venue, days: params.days }, opts);
  },

  /** GET /api/stocktake — stocktakes for the acting user's scope. */
  listStocktakes(opts?: StockClientOptions) {
    return request<unknown[]>('/api/stocktake', {}, opts);
  },

  /** GET /api/stocktake/:id — one stocktake (with lines). */
  getStocktake(id: string, opts?: StockClientOptions) {
    return request<unknown>(`/api/stocktake/${encodeURIComponent(id)}`, {}, opts);
  },

  /** GET /api/invoices?includeNoItem= — supplier invoices (lines). COGS source. */
  listSupplierInvoices(params: { includeNoItem?: boolean } = {}, opts?: StockClientOptions) {
    return request<unknown[]>('/api/invoices', { includeNoItem: params.includeNoItem }, opts);
  },

  /** GET /api/suppliers */
  listSuppliers(opts?: StockClientOptions) {
    return request<unknown[]>('/api/suppliers', {}, opts);
  },

  /** GET /api/operations/wastage — wastage records (reports). */
  listWastage(params: { venue?: string; from?: string; to?: string } = {}, opts?: StockClientOptions) {
    return request<unknown[]>('/api/operations/wastage', params, opts);
  }
};

export type StockClient = typeof stockClient;
