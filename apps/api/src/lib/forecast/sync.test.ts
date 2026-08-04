import assert from "node:assert/strict";
import test from "node:test";
import { backoffMs, isRetryableStatus, parseRetryAfterMs, readRateLimit, requestJson, SyncHttpError } from "./http.js";
import { walkCursor, walkPages } from "./paginate.js";
import { expectedArrival, medianSettlementLagDays, reconcilePayouts } from "./reconcile.js";

const D = (dollars: number) => Math.round(dollars * 100);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// ── retry / rate limiting ──────────────────────────────────────────────────

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

test("429 and 5xx retry; other 4xx do not", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(401), false, "a bad token will not fix itself");
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
});

test("Retry-After is parsed as seconds and as an HTTP date", () => {
  assert.equal(parseRetryAfterMs("30"), 30_000);
  const now = Date.parse("2026-07-28T10:00:00Z");
  assert.equal(parseRetryAfterMs("Tue, 28 Jul 2026 10:00:20 GMT", now), 20_000);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs("nonsense"), null);
});

test("backoff grows exponentially and stays bounded", () => {
  const full = () => 1; // full jitter → the ceiling
  assert.equal(backoffMs(0, { baseMs: 500, random: full }), 500);
  assert.equal(backoffMs(1, { baseMs: 500, random: full }), 1000);
  assert.equal(backoffMs(3, { baseMs: 500, random: full }), 4000);
  assert.equal(backoffMs(20, { baseMs: 500, maxMs: 30_000, random: full }), 30_000, "capped");
  assert.ok(backoffMs(3, { baseMs: 500, random: () => 0.5 }) < backoffMs(3, { baseMs: 500, random: full }), "jitter spreads retries");
});

test("a rate-limited request retries, obeys Retry-After, then succeeds", async () => {
  const waits: number[] = [];
  let call = 0;
  const fetchImpl = (async () => {
    call += 1;
    if (call === 1) return jsonResponse(429, { error: "slow down" }, { "retry-after": "2", "x-ratelimit-remaining": "0" });
    return jsonResponse(200, { ok: true });
  }) as unknown as typeof fetch;

  const result = await requestJson<{ ok: boolean }>("https://example.test/v2/payouts", {
    fetchImpl,
    sleep: async (ms) => void waits.push(ms),
  });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.attempts, 2);
  assert.equal(result.rateLimitHits, 1);
  assert.deepEqual(waits, [2000], "waited exactly what the provider asked for");
});

test("a non-retryable status fails immediately without burning attempts", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(401, { error: "token revoked" });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => requestJson("https://example.test/v2/payouts", { fetchImpl, sleep: async () => {} }),
    (err: unknown) => err instanceof SyncHttpError && err.status === 401 && err.retryable === false,
  );
  assert.equal(calls, 1, "did not retry a revoked token");
});

test("retries are bounded and the final failure is reported as retryable", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(503, { error: "unavailable" });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => requestJson("https://example.test/x", { fetchImpl, sleep: async () => {}, maxAttempts: 3 }),
    (err: unknown) => err instanceof SyncHttpError && err.retryable === true,
  );
  assert.equal(calls, 3);
});

test("rate-limit headers are surfaced for logging", () => {
  const snapshot = readRateLimit(new Headers({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "7", "retry-after": "5" }));
  assert.equal(snapshot.limit, "100");
  assert.equal(snapshot.remaining, "7");
  assert.equal(snapshot.retryAfterMs, 5000);
});

// ── pagination ─────────────────────────────────────────────────────────────

test("cursor walk collects every page until the cursor runs out", async () => {
  const pages: Record<string, { items: number[]; cursor?: string | null }> = {
    START: { items: [1, 2], cursor: "c2" },
    c2: { items: [3, 4], cursor: "c3" },
    c3: { items: [5], cursor: null },
  };
  const result = await walkCursor<number>(async (cursor) => pages[cursor ?? "START"]!);
  assert.deepEqual(result.items, [1, 2, 3, 4, 5]);
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.nextCursor, null);
  assert.equal(result.truncated, false);
});

test("cursor walk resumes from a saved cursor", async () => {
  const pages: Record<string, { items: number[]; cursor?: string | null }> = {
    c2: { items: [3, 4], cursor: null },
  };
  const result = await walkCursor<number>(async (cursor) => pages[cursor ?? "START"]!, { startCursor: "c2" });
  assert.deepEqual(result.items, [3, 4], "did not re-download page one");
});

test("cursor walk stops and reports where to resume when the page cap is hit", async () => {
  let n = 0;
  const result = await walkCursor<number>(async () => ({ items: [1], cursor: `c${(n += 1)}` }), { maxPages: 3 });
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.nextCursor, "c3", "resumable rather than silently truncated");
});

test("a repeating cursor cannot loop forever, and is reported as incomplete", async () => {
  const result = await walkCursor<number>(async () => ({ items: [1], cursor: "same" }), { maxPages: 50 });
  assert.equal(result.pagesFetched, 2, "second identical cursor ends the walk");
  assert.equal(result.truncated, true, "we cannot claim the data ran out");
  assert.equal(result.nextCursor, "same");
});

test("page walk ends on a short page", async () => {
  const pages: Record<number, number[]> = { 1: [1, 2, 3], 2: [4, 5] };
  const result = await walkPages<number>(async (page) => pages[page] ?? [], { pageSize: 3 });
  assert.deepEqual(result.items, [1, 2, 3, 4, 5]);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.nextPage, null);
});

test("page walk ends on an empty page", async () => {
  const pages: Record<number, number[]> = { 1: [1, 2], 2: [] };
  const result = await walkPages<number>(async (page) => pages[page] ?? [], { pageSize: 2 });
  assert.deepEqual(result.items, [1, 2]);
  assert.equal(result.pagesFetched, 2);
});

// ── payout reconciliation ──────────────────────────────────────────────────

test("payouts match the bank line on amount and arrival date", () => {
  const payouts = [
    { id: "po_1", netPayoutCents: D(4_210.55), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-02") },
    { id: "po_2", netPayoutCents: D(3_980.10), payoutDate: day("2026-07-02"), arrivalDate: day("2026-07-03") },
  ];
  const bank = [
    { id: "bt_a", amountCents: D(3_980.10), txnDate: day("2026-07-03") },
    { id: "bt_b", amountCents: D(4_210.55), txnDate: day("2026-07-02") },
  ];
  const result = reconcilePayouts(payouts, bank);
  assert.equal(result.matches.length, 2);
  assert.equal(result.unmatchedPayoutIds.length, 0);
  const first = result.matches.find((m) => m.payoutId === "po_1");
  assert.equal(first?.bankTransactionId, "bt_b");
  assert.equal(first?.confidence, "EXACT");
});

test("an unmatched payout is reported, never guessed at", () => {
  const payouts = [{ id: "po_1", netPayoutCents: D(5_000), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-02") }];
  const bank = [{ id: "bt_a", amountCents: D(9_999), txnDate: day("2026-07-02") }];
  const result = reconcilePayouts(payouts, bank);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmatchedPayoutIds, ["po_1"]);
  assert.deepEqual(result.unmatchedBankTransactionIds, ["bt_a"]);
});

test("payments out of the bank are never treated as a payout landing", () => {
  const payouts = [{ id: "po_1", netPayoutCents: D(1_000), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-01") }];
  const bank = [{ id: "bt_out", amountCents: D(-1_000), txnDate: day("2026-07-01") }];
  const result = reconcilePayouts(payouts, bank);
  assert.deepEqual(result.matches, [], "a debit of the same size is not a deposit");
});

test("one bank line cannot satisfy two payouts", () => {
  const payouts = [
    { id: "po_1", netPayoutCents: D(1_000), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-02") },
    { id: "po_2", netPayoutCents: D(1_000), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-02") },
  ];
  const bank = [{ id: "bt_a", amountCents: D(1_000), txnDate: day("2026-07-02") }];
  const result = reconcilePayouts(payouts, bank);
  assert.equal(result.matches.length, 1);
  assert.equal(result.unmatchedPayoutIds.length, 1);
});

test("settlement drift within tolerance still matches, and is flagged CLOSE", () => {
  const payouts = [{ id: "po_1", netPayoutCents: D(2_000), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-02") }];
  const bank = [{ id: "bt_a", amountCents: D(2_000), txnDate: day("2026-07-04") }];
  const result = reconcilePayouts(payouts, bank, { toleranceDays: 3 });
  assert.equal(result.matches[0]?.confidence, "CLOSE");
  assert.equal(result.matches[0]?.dayDelta, 2);
});

test("cash arrival uses the actual arrival date when Square gives one", () => {
  const payout = { id: "po_1", netPayoutCents: D(1_000), payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-03") };
  const arrival = expectedArrival(payout, 1);
  assert.equal(arrival.basis, "ACTUAL_ARRIVAL");
  assert.equal(arrival.date.toISOString().slice(0, 10), "2026-07-03");
});

test("without an arrival date it applies the observed lag, not the sales date", () => {
  const payout = { id: "po_1", netPayoutCents: D(1_000), payoutDate: day("2026-07-01"), arrivalDate: null };
  const arrival = expectedArrival(payout, 2);
  assert.equal(arrival.basis, "ESTIMATED_LAG");
  assert.equal(arrival.date.toISOString().slice(0, 10), "2026-07-03", "not same-day");
});

test("median settlement lag is learned from history", () => {
  const payouts = [
    { id: "1", netPayoutCents: 1, payoutDate: day("2026-07-01"), arrivalDate: day("2026-07-02") },
    { id: "2", netPayoutCents: 1, payoutDate: day("2026-07-02"), arrivalDate: day("2026-07-04") },
    { id: "3", netPayoutCents: 1, payoutDate: day("2026-07-03"), arrivalDate: day("2026-07-05") },
  ];
  assert.equal(medianSettlementLagDays(payouts), 2);
  assert.equal(medianSettlementLagDays([]), 1, "sensible default with no history");
});
