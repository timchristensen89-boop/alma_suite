import assert from "node:assert/strict";
import test from "node:test";
import {
  backtest,
  computeAccuracy,
  evaluateChallenger,
  explainVariance,
  selectBestModel,
} from "./accuracy.js";
import {
  addDays,
  aggregate,
  buildIntervals,
  forecastDaily,
  movingAverage,
  seasonalNaive,
  trainable,
  trendSeasonal,
  type Observation,
} from "./models.js";

const D = (dollars: number) => Math.round(dollars * 100);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Weekly pattern: quiet Mon–Wed, busy Fri/Sat. Optionally trending. */
function buildHistory(weeks: number, options: { start?: Date; weeklyGrowth?: number } = {}): Observation[] {
  const start = options.start ?? day("2026-01-05"); // a Monday
  const growth = options.weeklyGrowth ?? 0;
  const byWeekday = [D(2_000), D(1_200), D(1_300), D(1_600), D(2_400), D(4_200), D(3_800)]; // Sun..Sat
  const out: Observation[] = [];
  for (let d = 0; d < weeks * 7; d += 1) {
    const date = addDays(start, d);
    const base = byWeekday[date.getUTCDay()] as number;
    const factor = 1 + growth * Math.floor(d / 7);
    out.push({ date, valueCents: Math.round(base * factor) });
  }
  return out;
}

test("abnormal days are excluded from training", () => {
  const history: Observation[] = [
    { date: day("2026-07-01"), valueCents: D(4_000) },
    { date: day("2026-07-02"), valueCents: 0, abnormal: true },
    { date: day("2026-07-03"), valueCents: D(4_200) },
  ];
  const clean = trainable(history);
  assert.equal(clean.length, 2, "a closure is not a demand signal");
});

test("seasonal naive predicts from the same weekday, resisting one-off spikes", () => {
  const history = buildHistory(8);
  const nextSaturday = day("2026-03-07");
  const prediction = seasonalNaive(history, nextSaturday);
  assert.equal(prediction, D(3_800), "Saturday looks like recent Saturdays");

  // A single huge Saturday should not drag the median far.
  const withSpike = [...history, { date: day("2026-02-28"), valueCents: D(40_000) }];
  const resistant = seasonalNaive(withSpike, nextSaturday);
  assert.ok(resistant < D(5_000), `median resisted the spike, got ${resistant}`);
});

test("moving average is weekday-blind, so it differs from the weekday model", () => {
  const history = buildHistory(8);
  const saturday = day("2026-03-07");
  assert.notEqual(movingAverage(history, saturday), seasonalNaive(history, saturday));
});

test("trend-seasonal picks up sustained growth that a flat baseline misses", () => {
  const flat = buildHistory(16);
  const growing = buildHistory(16, { weeklyGrowth: 0.02 });
  const target = addDays(day("2026-01-05"), 16 * 7 + 5);

  const flatPrediction = trendSeasonal(flat, target);
  const growingPrediction = trendSeasonal(growing, target);
  assert.ok(growingPrediction > flatPrediction, "a growing venue should forecast higher");

  const naiveOnGrowing = seasonalNaive(growing, target);
  assert.ok(growingPrediction > naiveOnGrowing, "trend model leads the flat weekday median when growing");
});

test("models fall back sensibly when history is too short", () => {
  const short: Observation[] = [{ date: day("2026-07-01"), valueCents: D(1_000) }];
  assert.equal(trendSeasonal(short, day("2026-07-08")), seasonalNaive(short, day("2026-07-08")));
  assert.equal(seasonalNaive([], day("2026-07-08")), 0, "no history forecasts nothing, rather than guessing");
});

test("prediction intervals bracket the central forecast and widen with horizon", () => {
  const residuals = Array.from({ length: 40 }, (_, i) => 0.8 + (i / 39) * 0.4); // 0.8–1.2
  const near = buildIntervals(D(10_000), residuals, 1);
  const far = buildIntervals(D(10_000), residuals, 90);

  assert.ok(near.lower80Cents < near.centralCents && near.centralCents < near.upper80Cents);
  assert.ok(near.lower95Cents <= near.lower80Cents && near.upper95Cents >= near.upper80Cents);
  const nearWidth = near.upper80Cents - near.lower80Cents;
  const farWidth = far.upper80Cents - far.lower80Cents;
  assert.ok(farWidth > nearWidth, "further out is less certain, and says so");
});

test("intervals never go negative", () => {
  const intervals = buildIntervals(D(100), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 30);
  assert.ok(intervals.lower80Cents >= 0);
  assert.ok(intervals.lower95Cents >= 0);
});

test("a closed day forecasts zero rather than a busy Saturday", () => {
  const history = buildHistory(8);
  const points = forecastDaily(history, {
    model: "SEASONAL_NAIVE",
    startDate: day("2026-03-07"), // Saturday
    days: 2,
    closedDates: new Set(["2026-03-07"]),
  });
  assert.equal(points[0]?.centralCents, 0);
  assert.ok((points[1]?.centralCents ?? 0) > 0);
});

test("daily points roll up into weeks and months", () => {
  const history = buildHistory(8);
  const points = forecastDaily(history, { model: "SEASONAL_NAIVE", startDate: day("2026-03-02"), days: 28 });
  const weekly = aggregate(points, "WEEKLY");
  const monthly = aggregate(points, "MONTHLY");

  assert.equal(weekly.length, 4);
  assert.equal(weekly[0]?.periodStart.toISOString().slice(0, 10), "2026-03-02", "weeks are Monday-anchored");

  const dailyTotal = points.reduce((sum, point) => sum + point.centralCents, 0);
  const weeklyTotal = weekly.reduce((sum, week) => sum + week.centralCents, 0);
  const monthlyTotal = monthly.reduce((sum, month) => sum + month.centralCents, 0);
  assert.equal(weeklyTotal, dailyTotal, "aggregation conserves the total");
  assert.equal(monthlyTotal, dailyTotal);
});

// ── accuracy ───────────────────────────────────────────────────────────────

test("accuracy metrics are computed correctly", () => {
  const metrics = computeAccuracy([
    { date: day("2026-07-01"), predictedCents: 110, actualCents: 100 },
    { date: day("2026-07-02"), predictedCents: 90, actualCents: 100 },
  ]);
  assert.equal(metrics.mae, 10);
  assert.equal(metrics.wape, 10);
  assert.equal(metrics.bias, 0, "over and under cancel — that is the point of bias");
  assert.equal(metrics.rmse, 10);
  assert.equal(metrics.sampleCount, 2);
});

test("bias exposes a model that consistently runs high", () => {
  const metrics = computeAccuracy([
    { date: day("2026-07-01"), predictedCents: 120, actualCents: 100 },
    { date: day("2026-07-02"), predictedCents: 130, actualCents: 100 },
  ]);
  assert.ok(metrics.bias > 0, "positive bias means over-forecasting");
  assert.equal(metrics.wape, 25);
});

test("a perfect forecast scores zero error", () => {
  const metrics = computeAccuracy([{ date: day("2026-07-01"), predictedCents: 100, actualCents: 100 }]);
  assert.equal(metrics.wape, 0);
  assert.equal(metrics.mae, 0);
  assert.equal(metrics.rmse, 0);
});

test("backtest uses expanding windows and never sees the future", () => {
  const history = buildHistory(20);
  const result = backtest(history, "SEASONAL_NAIVE", { horizonDays: 14, folds: 3, minTrainDays: 56 });

  assert.ok(result.windows.length >= 2, "produced multiple folds");
  for (const window of result.windows) {
    for (const prediction of window.predictions) {
      assert.ok(prediction.date >= window.windowStart && prediction.date <= window.windowEnd);
    }
  }
  // Windows must not overlap, and must run forward in time.
  for (let i = 1; i < result.windows.length; i += 1) {
    const previous = result.windows[i - 1]!;
    const current = result.windows[i]!;
    assert.ok(current.windowStart > previous.windowEnd, "folds walk forward without overlapping");
  }
});

test("backtest on a clean repeating pattern is highly accurate", () => {
  const result = backtest(buildHistory(20), "SEASONAL_NAIVE", { horizonDays: 14, folds: 3 });
  assert.ok(result.overall.wape < 1, `a perfectly repeating pattern should be near-exact, got ${result.overall.wape}`);
  assert.ok(result.residualRatios.length > 0, "residuals captured for interval building");
});

test("backtest returns empty rather than throwing when history is too short", () => {
  const result = backtest(buildHistory(2), "TREND_SEASONAL", { minTrainDays: 56 });
  assert.equal(result.windows.length, 0);
  assert.equal(result.overall.sampleCount, 0);
});

test("a challenger is not promoted on a marginal improvement", () => {
  const history = buildHistory(20);
  const champion = backtest(history, "SEASONAL_NAIVE", { horizonDays: 14, folds: 3 });
  const decision = evaluateChallenger(champion, champion, { minWapeImprovement: 1 });
  assert.equal(decision.promote, false);
  assert.match(decision.reason, /improved WAPE by only/);
});

test("a challenger that wins on error but not on windows is not promoted", () => {
  const history = buildHistory(20);
  const champion = backtest(history, "MOVING_AVERAGE", { horizonDays: 14, folds: 3 });
  const challenger = backtest(history, "SEASONAL_NAIVE", { horizonDays: 14, folds: 3 });
  // Force the window-win test to fail while keeping the error improvement.
  const decision = evaluateChallenger(champion, challenger, { minWindowWinRate: 1.01 });
  assert.equal(decision.promote, false);
  assert.match(decision.reason, /One good window is not evidence/);
});

test("a genuinely better challenger is promoted with a stated reason", () => {
  const history = buildHistory(20);
  const champion = backtest(history, "MOVING_AVERAGE", { horizonDays: 14, folds: 3 });
  const challenger = backtest(history, "SEASONAL_NAIVE", { horizonDays: 14, folds: 3 });
  const decision = evaluateChallenger(champion, challenger);
  assert.equal(decision.promote, true, "weekday model should beat a weekday-blind average");
  assert.ok(decision.challengerWape < decision.championWape);
  assert.match(decision.reason, /beat/);
});

test("automatic promotion can be disabled for manual approval", () => {
  const history = buildHistory(20);
  const champion = backtest(history, "MOVING_AVERAGE", { horizonDays: 14, folds: 3 });
  const challenger = backtest(history, "SEASONAL_NAIVE", { horizonDays: 14, folds: 3 });
  const decision = evaluateChallenger(champion, challenger, { autoPromote: false });
  assert.equal(decision.promote, false);
  assert.match(decision.reason, /manual approval/);
});

test("model selection ranks candidates by pooled error", () => {
  const { ranked, best } = selectBestModel(buildHistory(20), ["SEASONAL_NAIVE", "MOVING_AVERAGE", "TREND_SEASONAL"], {
    horizonDays: 14,
    folds: 3,
  });
  assert.ok(ranked.length >= 2);
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok((ranked[i - 1] as { overall: { wape: number } }).overall.wape <= (ranked[i] as { overall: { wape: number } }).overall.wape);
  }
  assert.equal(best?.model, "SEASONAL_NAIVE", "the weekday model wins on a weekday-driven series");
});

test("variance is explained from data, and unexplained gaps are admitted", () => {
  const attributed = explainVariance({
    forecastSalesCents: D(10_000),
    actualSalesCents: D(12_000),
    forecastCovers: 100,
    actualCovers: 120,
  });
  assert.ok(attributed.some((note) => /above forecast by 20.0%/.test(note)));
  assert.ok(attributed.some((note) => /Covers were up/.test(note)));

  const noCovers = explainVariance({ forecastSalesCents: D(10_000), actualSalesCents: D(12_000) });
  assert.ok(noCovers.some((note) => /cannot be attributed/.test(note)), "does not invent a cause");

  const onTarget = explainVariance({ forecastSalesCents: D(10_000), actualSalesCents: D(10_100) });
  assert.deepEqual(onTarget, ["Sales landed within 2% of forecast."]);
});
