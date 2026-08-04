// Accuracy measurement, time-series backtesting and champion/challenger.
//
// Two rules the brief is firm about, encoded here:
//
//   1. NEVER random train/test splits on dated financial data. Every backtest
//      uses expanding windows that only ever look backwards, because a model
//      that has seen next month's takings will look brilliant and be useless.
//   2. A challenger is promoted only when it beats the champion across
//      MULTIPLE windows — a single lucky fold is not evidence.

import { addDays, predict, trainable, type ModelKey, type Observation } from "./models.js";

export interface AccuracyMetrics {
  /** Weighted absolute percentage error — the headline for money series. */
  wape: number;
  mae: number;
  rmse: number;
  /** Signed: positive means the model runs high. */
  bias: number;
  mape: number;
  /** Share of periods where the model got the direction of change right. */
  directionalAccuracy: number;
  sampleCount: number;
}

export interface Prediction {
  date: Date;
  predictedCents: number;
  actualCents: number;
}

export function computeAccuracy(predictions: Prediction[]): AccuracyMetrics {
  const n = predictions.length;
  if (n === 0) {
    return { wape: 0, mae: 0, rmse: 0, bias: 0, mape: 0, directionalAccuracy: 0, sampleCount: 0 };
  }

  let absError = 0;
  let squaredError = 0;
  let signedError = 0;
  let actualTotal = 0;
  let percentErrorSum = 0;
  let percentErrorCount = 0;

  for (const prediction of predictions) {
    const error = prediction.predictedCents - prediction.actualCents;
    absError += Math.abs(error);
    squaredError += error * error;
    signedError += error;
    actualTotal += Math.abs(prediction.actualCents);
    if (prediction.actualCents !== 0) {
      percentErrorSum += Math.abs(error / prediction.actualCents);
      percentErrorCount += 1;
    }
  }

  // Direction: did the model move the same way the actuals moved?
  let directionalHits = 0;
  let directionalTotal = 0;
  for (let i = 1; i < n; i += 1) {
    const actualDelta = (predictions[i] as Prediction).actualCents - (predictions[i - 1] as Prediction).actualCents;
    const predictedDelta = (predictions[i] as Prediction).predictedCents - (predictions[i - 1] as Prediction).predictedCents;
    if (actualDelta === 0 && predictedDelta === 0) { directionalHits += 1; directionalTotal += 1; continue; }
    if (actualDelta === 0 || predictedDelta === 0) { directionalTotal += 1; continue; }
    if (Math.sign(actualDelta) === Math.sign(predictedDelta)) directionalHits += 1;
    directionalTotal += 1;
  }

  return {
    wape: actualTotal === 0 ? 0 : (absError / actualTotal) * 100,
    mae: absError / n,
    rmse: Math.sqrt(squaredError / n),
    bias: signedError / n,
    mape: percentErrorCount === 0 ? 0 : (percentErrorSum / percentErrorCount) * 100,
    directionalAccuracy: directionalTotal === 0 ? 0 : (directionalHits / directionalTotal) * 100,
    sampleCount: n,
  };
}

export interface BacktestWindow {
  windowStart: Date;
  windowEnd: Date;
  metrics: AccuracyMetrics;
  predictions: Prediction[];
}

export interface BacktestResult {
  model: ModelKey;
  windows: BacktestWindow[];
  /** Metrics across every window's predictions pooled together. */
  overall: AccuracyMetrics;
  /** predicted/actual ratios, for empirical prediction intervals. */
  residualRatios: number[];
}

export interface BacktestOptions {
  /** Days per test fold. */
  horizonDays?: number;
  /** Number of expanding-window folds. */
  folds?: number;
  /** Minimum history before the first fold. */
  minTrainDays?: number;
}

/**
 * Expanding-window (walk-forward) backtest.
 *
 * Fold k trains on everything before its window and predicts the window. The
 * model never sees a future observation — that is the whole point.
 */
export function backtest(history: Observation[], model: ModelKey, options: BacktestOptions = {}): BacktestResult {
  const horizon = options.horizonDays ?? 14;
  const folds = options.folds ?? 4;
  const minTrain = options.minTrainDays ?? 56;

  const clean = trainable(history);
  const windows: BacktestWindow[] = [];
  const residualRatios: number[] = [];
  const allPredictions: Prediction[] = [];

  if (clean.length === 0) {
    return { model, windows, overall: computeAccuracy([]), residualRatios };
  }

  const lastDate = (clean[clean.length - 1] as Observation).date;

  for (let fold = folds; fold >= 1; fold -= 1) {
    const windowEnd = addDays(lastDate, -(fold - 1) * horizon);
    const windowStart = addDays(windowEnd, -horizon + 1);

    const train = clean.filter((point) => point.date < windowStart);
    if (train.length < minTrain) continue;

    const actuals = clean.filter((point) => point.date >= windowStart && point.date <= windowEnd);
    if (actuals.length === 0) continue;

    const predictions: Prediction[] = actuals.map((actual) => ({
      date: actual.date,
      // Train set only — no leakage of the window being scored.
      predictedCents: predict(model, train, actual.date),
      actualCents: actual.valueCents,
    }));

    for (const prediction of predictions) {
      if (prediction.actualCents > 0) residualRatios.push(prediction.predictedCents / prediction.actualCents);
    }

    allPredictions.push(...predictions);
    windows.push({ windowStart, windowEnd, metrics: computeAccuracy(predictions), predictions });
  }

  return { model, windows, overall: computeAccuracy(allPredictions), residualRatios };
}

export interface ChampionDecision {
  championModel: ModelKey;
  challengerModel: ModelKey;
  promote: boolean;
  reason: string;
  championWape: number;
  challengerWape: number;
  /** Windows where the challenger beat the champion. */
  windowsWon: number;
  windowsCompared: number;
}

export interface PromotionPolicy {
  /** Challenger must win at least this share of windows. */
  minWindowWinRate?: number;
  /** And improve overall WAPE by at least this many percentage points. */
  minWapeImprovement?: number;
  /** When false, a qualifying challenger is reported but not promoted. */
  autoPromote?: boolean;
}

/**
 * Compare a challenger against the champion.
 *
 * Deliberately conservative: a challenger must beat the champion on the pooled
 * error AND win a majority of individual windows. Switching models on one good
 * fortnight is how a forecast becomes unstable.
 */
export function evaluateChallenger(
  champion: BacktestResult,
  challenger: BacktestResult,
  policy: PromotionPolicy = {},
): ChampionDecision {
  const minWinRate = policy.minWindowWinRate ?? 0.6;
  const minImprovement = policy.minWapeImprovement ?? 1;
  const autoPromote = policy.autoPromote ?? true;

  const comparable = Math.min(champion.windows.length, challenger.windows.length);
  let windowsWon = 0;
  for (let i = 0; i < comparable; i += 1) {
    if ((challenger.windows[i] as BacktestWindow).metrics.wape < (champion.windows[i] as BacktestWindow).metrics.wape) {
      windowsWon += 1;
    }
  }

  const championWape = champion.overall.wape;
  const challengerWape = challenger.overall.wape;
  const improvement = championWape - challengerWape;
  const winRate = comparable === 0 ? 0 : windowsWon / comparable;

  let promote = false;
  let reason: string;

  if (comparable < 2) {
    reason = `Not enough backtest windows to judge (${comparable}). Keeping ${champion.model}.`;
  } else if (challenger.overall.sampleCount === 0) {
    reason = `Challenger produced no predictions. Keeping ${champion.model}.`;
  } else if (improvement < minImprovement) {
    reason = `${challenger.model} improved WAPE by only ${improvement.toFixed(2)} points (needs ${minImprovement}). Keeping ${champion.model}.`;
  } else if (winRate < minWinRate) {
    reason = `${challenger.model} won ${windowsWon} of ${comparable} windows (needs ${Math.round(minWinRate * 100)}%). One good window is not evidence. Keeping ${champion.model}.`;
  } else if (!autoPromote) {
    reason = `${challenger.model} qualifies (WAPE ${challengerWape.toFixed(2)} vs ${championWape.toFixed(2)}, won ${windowsWon}/${comparable}) but automatic promotion is off — needs manual approval.`;
  } else {
    promote = true;
    reason = `${challenger.model} beat ${champion.model} on WAPE (${challengerWape.toFixed(2)} vs ${championWape.toFixed(2)}) and won ${windowsWon} of ${comparable} windows.`;
  }

  return {
    championModel: champion.model,
    challengerModel: challenger.model,
    promote,
    reason,
    championWape,
    challengerWape,
    windowsWon,
    windowsCompared: comparable,
  };
}

/** Backtest every candidate and rank by pooled WAPE. */
export function selectBestModel(
  history: Observation[],
  candidates: ModelKey[],
  options: BacktestOptions = {},
): { ranked: BacktestResult[]; best: BacktestResult | null } {
  const ranked = candidates
    .map((model) => backtest(history, model, options))
    .filter((result) => result.overall.sampleCount > 0)
    .sort((a, b) => a.overall.wape - b.overall.wape);
  return { ranked, best: ranked[0] ?? null };
}

/**
 * Attribute a variance between forecast and actual to a cause.
 *
 * Plain English, and only from what the data supports — no invented
 * explanations. Anything unexplained is said to be unexplained.
 */
export function explainVariance(input: {
  forecastSalesCents: number;
  actualSalesCents: number;
  forecastCovers?: number;
  actualCovers?: number;
  knownEvents?: Array<{ description: string; expectedSalesImpactPercent?: number | null }>;
}): string[] {
  const notes: string[] = [];
  const delta = input.actualSalesCents - input.forecastSalesCents;
  if (input.forecastSalesCents === 0) return ["No forecast to compare against."];

  const pct = (delta / input.forecastSalesCents) * 100;
  if (Math.abs(pct) < 2) return ["Sales landed within 2% of forecast."];

  notes.push(`Sales came in ${pct > 0 ? "above" : "below"} forecast by ${Math.abs(pct).toFixed(1)}%.`);

  if (input.forecastCovers && input.actualCovers && input.forecastCovers > 0) {
    const coverPct = ((input.actualCovers - input.forecastCovers) / input.forecastCovers) * 100;
    const forecastSpend = input.forecastSalesCents / input.forecastCovers;
    const actualSpend = input.actualSalesCents / Math.max(1, input.actualCovers);
    const spendPct = ((actualSpend - forecastSpend) / forecastSpend) * 100;

    if (Math.abs(coverPct) >= 2) notes.push(`Covers were ${coverPct > 0 ? "up" : "down"} ${Math.abs(coverPct).toFixed(1)}%.`);
    if (Math.abs(spendPct) >= 2) notes.push(`Average spend per cover was ${spendPct > 0 ? "up" : "down"} ${Math.abs(spendPct).toFixed(1)}%.`);
    if (Math.abs(coverPct) < 2 && Math.abs(spendPct) < 2) {
      notes.push("Neither covers nor spend per cover moved much — the difference is not explained by either.");
    }
  } else {
    notes.push("Covers were not available, so the split between volume and spend cannot be attributed.");
  }

  for (const event of input.knownEvents ?? []) {
    notes.push(`A recorded event overlaps this period: ${event.description}.`);
  }

  return notes;
}
