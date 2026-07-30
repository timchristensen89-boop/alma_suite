// Sales forecasting models.
//
// Deliberately statistical and auditable — no LLM invents a number here. Every
// model is a named, deterministic function of the history it was given, so a
// forecast run can be reproduced exactly from its stored inputs.
//
// Prediction intervals are EMPIRICAL: they come from the model's own backtest
// residuals, not from an assumed normal distribution. If a model has been
// wrong by 20% historically, its interval says so.

export interface Observation {
  /** UTC-midnight business date. */
  date: Date;
  valueCents: number;
  /** Closed day, one-off event, or anything not to be learned from. */
  abnormal?: boolean;
}

export interface ForecastPoint {
  date: Date;
  centralCents: number;
  lower80Cents: number;
  upper80Cents: number;
  lower95Cents: number;
  upper95Cents: number;
}

export type ModelKey = "SEASONAL_NAIVE" | "MOVING_AVERAGE" | "TREND_SEASONAL" | "ENSEMBLE";

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
const dayOfWeek = (date: Date): number => date.getUTCDay();

/** Abnormal days never train a model — a closure is not a demand signal. */
export function trainable(history: Observation[]): Observation[] {
  return history.filter((point) => !point.abnormal).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] as number;
  return (sorted[lower] as number) + ((sorted[upper] as number) - (sorted[lower] as number)) * (index - lower);
}

/**
 * Same weekday, most recent N weeks, median.
 *
 * The workhorse baseline for hospitality: a Saturday looks like recent
 * Saturdays far more than it looks like yesterday. Median rather than mean so
 * one big function night does not drag the whole weekday up.
 */
export function seasonalNaive(history: Observation[], target: Date, weeks = 8): number {
  const clean = trainable(history);
  const weekday = dayOfWeek(target);
  const sameWeekday = clean
    .filter((point) => dayOfWeek(point.date) === weekday && point.date < target)
    .slice(-weeks)
    .map((point) => point.valueCents)
    .sort((a, b) => a - b);
  if (sameWeekday.length === 0) return clean.length ? Math.round(mean(clean.map((p) => p.valueCents))) : 0;
  return Math.round(quantile(sameWeekday, 0.5));
}

/** Recent N-day mean. Blind to weekday, so it is a floor not a forecast. */
export function movingAverage(history: Observation[], target: Date, days = 28): number {
  const clean = trainable(history).filter((point) => point.date < target).slice(-days);
  return clean.length === 0 ? 0 : Math.round(mean(clean.map((point) => point.valueCents)));
}

/**
 * Weekday level × linear trend.
 *
 * Fits a least-squares trend on the weekly totals (weekly, so weekday effects
 * do not pollute the slope), then applies each weekday's share of a week.
 */
export function trendSeasonal(history: Observation[], target: Date, options: { weeks?: number } = {}): number {
  const clean = trainable(history).filter((point) => point.date < target);
  if (clean.length < 14) return seasonalNaive(history, target);

  const lookbackWeeks = options.weeks ?? 12;
  const cutoff = addDays(target, -lookbackWeeks * 7);
  const window = clean.filter((point) => point.date >= cutoff);
  if (window.length < 14) return seasonalNaive(history, target);

  // Weekly totals for the trend. Only COMPLETE weeks are fitted: a partial
  // week at either end carries fewer days, and a short final week would drag
  // the slope down and make a growing venue look like a shrinking one.
  const weekTotals = new Map<number, { total: number; days: number }>();
  const firstTime = (window[0] as Observation).date.getTime();
  for (const point of window) {
    const weekIndex = Math.floor((point.date.getTime() - firstTime) / (7 * DAY_MS));
    const bucket = weekTotals.get(weekIndex) ?? { total: 0, days: 0 };
    bucket.total += point.valueCents;
    bucket.days += 1;
    weekTotals.set(weekIndex, bucket);
  }
  const weeks = [...weekTotals.entries()]
    .filter(([, bucket]) => bucket.days === 7)
    .map(([index, bucket]) => [index, bucket.total] as const)
    .sort((a, b) => a[0] - b[0]);
  if (weeks.length < 2) return seasonalNaive(history, target);

  const xs = weeks.map(([index]) => index);
  const ys = weeks.map(([, total]) => total);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i += 1) {
    numerator += ((xs[i] as number) - xMean) * ((ys[i] as number) - yMean);
    denominator += ((xs[i] as number) - xMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;

  const targetWeekIndex = Math.floor((target.getTime() - firstTime) / (7 * DAY_MS));
  const projectedWeekTotal = Math.max(0, intercept + slope * targetWeekIndex);

  // Weekday share of a week, from the same window.
  const weekdayTotals = new Array(7).fill(0);
  const weekdayCounts = new Array(7).fill(0);
  for (const point of window) {
    const day = dayOfWeek(point.date);
    weekdayTotals[day] += point.valueCents;
    weekdayCounts[day] += 1;
  }
  const weekdayMeans = weekdayTotals.map((total, day) => (weekdayCounts[day] ? total / weekdayCounts[day] : 0));
  const weekMeanTotal = weekdayMeans.reduce((sum, value) => sum + value, 0);
  if (weekMeanTotal === 0) return seasonalNaive(history, target);

  const share = (weekdayMeans[dayOfWeek(target)] as number) / weekMeanTotal;
  return Math.round(projectedWeekTotal * share);
}

export const MODELS: Record<Exclude<ModelKey, "ENSEMBLE">, (history: Observation[], target: Date) => number> = {
  SEASONAL_NAIVE: (history, target) => seasonalNaive(history, target),
  MOVING_AVERAGE: (history, target) => movingAverage(history, target),
  TREND_SEASONAL: (history, target) => trendSeasonal(history, target),
};

/** Weighted blend. Weights come from backtest performance, not intuition. */
export function ensemble(
  history: Observation[],
  target: Date,
  weights: Partial<Record<Exclude<ModelKey, "ENSEMBLE">, number>>,
): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights) as Array<[Exclude<ModelKey, "ENSEMBLE">, number]>) {
    if (!weight || weight <= 0) continue;
    weighted += MODELS[key](history, target) * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? seasonalNaive(history, target) : Math.round(weighted / totalWeight);
}

export function predict(model: ModelKey, history: Observation[], target: Date, weights?: Partial<Record<Exclude<ModelKey, "ENSEMBLE">, number>>): number {
  if (model === "ENSEMBLE") return ensemble(history, target, weights ?? { SEASONAL_NAIVE: 1, TREND_SEASONAL: 1 });
  return MODELS[model](history, target);
}

/**
 * Empirical prediction intervals from backtest residual ratios.
 *
 * Using observed error rather than an assumed distribution means the band
 * widens honestly for a metric the model has struggled with, and for horizons
 * further out.
 */
export function buildIntervals(
  centralCents: number,
  residualRatios: number[],
  horizonDays: number,
): Omit<ForecastPoint, "date"> {
  const sorted = [...residualRatios].sort((a, b) => a - b);
  // Wider further out: uncertainty compounds with horizon.
  const widening = 1 + Math.min(1, Math.max(0, horizonDays) / 90) * 0.5;

  const fallback = { p10: 0.85, p90: 1.15, p025: 0.75, p975: 1.3 };
  const lo80 = sorted.length >= 8 ? quantile(sorted, 0.1) : fallback.p10;
  const hi80 = sorted.length >= 8 ? quantile(sorted, 0.9) : fallback.p90;
  const lo95 = sorted.length >= 20 ? quantile(sorted, 0.025) : fallback.p025;
  const hi95 = sorted.length >= 20 ? quantile(sorted, 0.975) : fallback.p975;

  const scale = (ratio: number) => {
    const spread = (ratio - 1) * widening;
    return Math.max(0, Math.round(centralCents * (1 + spread)));
  };

  return {
    centralCents: Math.max(0, Math.round(centralCents)),
    lower80Cents: scale(lo80),
    upper80Cents: scale(hi80),
    lower95Cents: scale(lo95),
    upper95Cents: scale(hi95),
  };
}

/** Forecast a horizon of days from history. */
export function forecastDaily(
  history: Observation[],
  options: {
    model: ModelKey;
    startDate: Date;
    days: number;
    residualRatios?: number[];
    weights?: Partial<Record<Exclude<ModelKey, "ENSEMBLE">, number>>;
    /** Dates the venue is closed — forecast zero, and say so. */
    closedDates?: Set<string>;
  },
): ForecastPoint[] {
  const points: ForecastPoint[] = [];
  const residuals = options.residualRatios ?? [];

  for (let offset = 0; offset < options.days; offset += 1) {
    const date = addDays(options.startDate, offset);
    const key = date.toISOString().slice(0, 10);
    if (options.closedDates?.has(key)) {
      points.push({ date, centralCents: 0, lower80Cents: 0, upper80Cents: 0, lower95Cents: 0, upper95Cents: 0 });
      continue;
    }
    const central = predict(options.model, history, date, options.weights);
    points.push({ date, ...buildIntervals(central, residuals, offset) });
  }
  return points;
}

/** Roll daily points into weeks (Monday-anchored) or calendar months. */
export function aggregate(points: ForecastPoint[], granularity: "WEEKLY" | "MONTHLY"): Array<{ periodStart: Date; periodEnd: Date } & Omit<ForecastPoint, "date">> {
  const buckets = new Map<string, ForecastPoint[]>();

  for (const point of points) {
    let key: string;
    if (granularity === "WEEKLY") {
      const day = point.date.getUTCDay();
      const monday = addDays(point.date, day === 0 ? -6 : 1 - day);
      key = monday.toISOString().slice(0, 10);
    } else {
      key = `${point.date.getUTCFullYear()}-${String(point.date.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }
    const bucket = buckets.get(key) ?? [];
    bucket.push(point);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bucket]) => {
      const sum = (pick: (point: ForecastPoint) => number) => bucket.reduce((total, point) => total + pick(point), 0);
      const dates = bucket.map((point) => point.date.getTime());
      return {
        periodStart: new Date(key + "T00:00:00Z"),
        periodEnd: new Date(Math.max(...dates)),
        centralCents: sum((p) => p.centralCents),
        lower80Cents: sum((p) => p.lower80Cents),
        upper80Cents: sum((p) => p.upper80Cents),
        lower95Cents: sum((p) => p.lower95Cents),
        upper95Cents: sum((p) => p.upper95Cents),
      };
    });
}
