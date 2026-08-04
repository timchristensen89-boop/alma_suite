// Pagination walkers.
//
// Square pages with an opaque `cursor` in the response body. Xero pages with a
// 1-based `page` query parameter and signals the end with a short page. Both
// are walked here with the same contract so the sync services do not each
// reinvent a loop that silently stops early.
//
// Every walker is resumable: it reports the cursor/page it reached so a run
// that dies mid-walk restarts from there rather than from the beginning.

export interface PageWalkResult<T> {
  items: T[];
  pagesFetched: number;
  /** Where to resume. Null when the walk completed. */
  nextCursor: string | null;
  /** True when the page cap stopped the walk before the data ran out. */
  truncated: boolean;
}

export interface CursorWalkOptions {
  startCursor?: string | null;
  /** Safety bound so a provider bug cannot spin forever. */
  maxPages?: number;
  onPage?: (page: number, count: number) => void;
}

/**
 * Walk a cursor-paginated endpoint (Square).
 *
 * `fetchPage` returns the items plus the next cursor; a null/undefined cursor
 * ends the walk.
 */
export async function walkCursor<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; cursor?: string | null }>,
  options: CursorWalkOptions = {},
): Promise<PageWalkResult<T>> {
  const maxPages = Math.max(1, options.maxPages ?? 200);
  const items: T[] = [];
  let cursor: string | null = options.startCursor ?? null;
  let pagesFetched = 0;
  const seenCursors = new Set<string>();

  while (pagesFetched < maxPages) {
    const page = await fetchPage(cursor);
    pagesFetched += 1;
    items.push(...page.items);
    options.onPage?.(pagesFetched, page.items.length);

    const next = page.cursor ?? null;
    if (!next) return { items, pagesFetched, nextCursor: null, truncated: false };
    // A provider repeating a cursor would loop forever. Stop — but report the
    // walk as TRUNCATED, not complete: a repeat means we cannot know whether
    // the data ran out, and quietly claiming completeness would understate a
    // cash position.
    if (seenCursors.has(next)) return { items, pagesFetched, nextCursor: next, truncated: true };
    seenCursors.add(next);
    cursor = next;
  }

  return { items, pagesFetched, nextCursor: cursor, truncated: true };
}

export interface PageNumberWalkOptions {
  startPage?: number;
  pageSize?: number;
  maxPages?: number;
  onPage?: (page: number, count: number) => void;
}

export interface PageNumberWalkResult<T> {
  items: T[];
  pagesFetched: number;
  /** Next page to fetch when truncated, else null. */
  nextPage: number | null;
  truncated: boolean;
}

/**
 * Walk a page-numbered endpoint (Xero). The walk ends on an empty page, or on
 * a page shorter than the page size — Xero's signal that there is no more.
 */
export async function walkPages<T>(
  fetchPage: (page: number) => Promise<T[]>,
  options: PageNumberWalkOptions = {},
): Promise<PageNumberWalkResult<T>> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = Math.max(1, options.maxPages ?? 200);
  const items: T[] = [];
  let page = Math.max(1, options.startPage ?? 1);
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const batch = await fetchPage(page);
    pagesFetched += 1;
    items.push(...batch);
    options.onPage?.(page, batch.length);

    if (batch.length === 0 || batch.length < pageSize) {
      return { items, pagesFetched, nextPage: null, truncated: false };
    }
    page += 1;
  }

  return { items, pagesFetched, nextPage: page, truncated: true };
}
