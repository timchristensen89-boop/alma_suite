export type HistoricalVenueKey = 'Alma Avalon' | 'St Alma';

type TradingDay = 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

type MonthlySales = Record<TradingDay, number>;

type HistoricalSalesTable = Record<HistoricalVenueKey, Record<number, MonthlySales>>;

const tradingDayByDateDay: Record<number, TradingDay | null> = {
  0: 'sunday',
  1: null,
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday'
};

// Weekdays (0=Sun … 6=Sat) each venue does NOT trade. Everyone is closed Monday;
// Alma Avalon is also closed Tuesday. Used to zero out historical baselines and
// suppress forecast bars on days a venue is shut, so the daily sales trend never
// shows trade on a closed day.
const closedWeekdaysByVenue: Record<HistoricalVenueKey, number[]> = {
  'Alma Avalon': [1, 2],
  'St Alma': [1]
};

// Whether a venue trades on the given date. Unknown venues are assumed open so
// we never hide real data for a venue we don't have a closure model for.
export function isVenueOpenOnDate(venue: string, date: Date): boolean {
  const venueKey = normaliseHistoricalVenue(venue);
  if (!venueKey) return true;
  return !closedWeekdaysByVenue[venueKey].includes(date.getDay());
}

export const historicalSalesByVenue: HistoricalSalesTable = {
  'Alma Avalon': {
    0: { tuesday: 5724.61, wednesday: 4592.2, thursday: 6666.11, friday: 9234.82, saturday: 11732.47, sunday: 7690.97 },
    1: { tuesday: 2505.06, wednesday: 3098.39, thursday: 2809.36, friday: 7956.44, saturday: 10976.26, sunday: 5249.8 },
    2: { tuesday: 2010.81, wednesday: 2520.69, thursday: 3095.5, friday: 8128.56, saturday: 10552.68, sunday: 5148 },
    3: { tuesday: 2067.79, wednesday: 2812.83, thursday: 2935.56, friday: 8069.8, saturday: 10326.2, sunday: 5077.53 },
    4: { tuesday: 1265.1, wednesday: 1783.02, thursday: 1692.5, friday: 5692.55, saturday: 7769.87, sunday: 4999.24 },
    5: { tuesday: 1219.81, wednesday: 1323, thursday: 1113.7, friday: 5566.45, saturday: 9174.3, sunday: 4241.87 },
    6: { tuesday: 1269.35, wednesday: 1583.09, thursday: 1548.56, friday: 5529, saturday: 9056.14, sunday: 3594.75 },
    7: { tuesday: 1913.13, wednesday: 1978.93, thursday: 1896.71, friday: 6709.56, saturday: 8210.82, sunday: 4187.21 },
    8: { tuesday: 1244.63, wednesday: 2451, thursday: 1731.93, friday: 6644.48, saturday: 9326.99, sunday: 5376.66 },
    9: { tuesday: 2235.4, wednesday: 2377.84, thursday: 2329.46, friday: 7162.66, saturday: 10347.32, sunday: 5464.33 },
    10: { tuesday: 2373.25, wednesday: 2688.21, thursday: 2466.65, friday: 7251.49, saturday: 9312.49, sunday: 6385.16 },
    11: { tuesday: 4759.34, wednesday: 3461.75, thursday: 5384.21, friday: 8356.6, saturday: 10807.94, sunday: 7168.35 }
  },
  'St Alma': {
    0: { tuesday: 4608.11, wednesday: 3886.75, thursday: 4536.6, friday: 8490.02, saturday: 10278.49, sunday: 6772.92 },
    1: { tuesday: 3467.36, wednesday: 2843.63, thursday: 3594.39, friday: 7724.63, saturday: 10879.17, sunday: 5319.26 },
    2: { tuesday: 2737.25, wednesday: 2298.84, thursday: 3652.38, friday: 7795.52, saturday: 11099.68, sunday: 5147.34 },
    3: { tuesday: 3105.87, wednesday: 3323.03, thursday: 3181.84, friday: 7109.05, saturday: 11040.3, sunday: 3734.01 },
    4: { tuesday: 3198.56, wednesday: 2195.46, thursday: 2618.75, friday: 8295.37, saturday: 12024.43, sunday: 6457.68 },
    5: { tuesday: 2701.25, wednesday: 1694, thursday: 2075.63, friday: 7343.63, saturday: 12081.22, sunday: 6451.38 },
    6: { tuesday: 2544.67, wednesday: 1832.24, thursday: 3270.81, friday: 8015.06, saturday: 10916.59, sunday: 4848.8 },
    7: { tuesday: 2586.84, wednesday: 1975.16, thursday: 2997.85, friday: 7646.66, saturday: 11882.7, sunday: 3751.11 },
    8: { tuesday: 2860.15, wednesday: 2589.13, thursday: 3219.56, friday: 7080.13, saturday: 11011.09, sunday: 5122.84 },
    9: { tuesday: 2591, wednesday: 2736.32, thursday: 3359.57, friday: 7409.05, saturday: 11445.99, sunday: 5522.4 },
    10: { tuesday: 3197.51, wednesday: 2583.79, thursday: 3355.16, friday: 8116.34, saturday: 12618.57, sunday: 5472.05 },
    11: { tuesday: 4312.24, wednesday: 4251.19, thursday: 5265.16, friday: 11097.99, saturday: 11537.14, sunday: 7901.65 }
  }
};

export function normaliseHistoricalVenue(venue: string): HistoricalVenueKey | null {
  const clean = venue.trim().toLowerCase();
  if (clean.includes('avalon')) return 'Alma Avalon';
  if (clean.includes('st alma') || clean.includes('freshwater')) return 'St Alma';
  return null;
}

export function historicalSalesForDate(venue: string, date: Date) {
  const venueKey = normaliseHistoricalVenue(venue);
  const tradingDay = tradingDayByDateDay[date.getDay()];
  if (!venueKey || !tradingDay) return 0;
  // No historical baseline on a day the venue doesn't trade (e.g. Avalon Tuesday),
  // even if the legacy table carries a figure for it.
  if (closedWeekdaysByVenue[venueKey].includes(date.getDay())) return 0;
  return historicalSalesByVenue[venueKey][date.getMonth()]?.[tradingDay] ?? 0;
}

export function historicalSalesForWeek(venue: string, weekStart: Date) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return {
      date,
      sales: historicalSalesForDate(venue, date)
    };
  });

  return {
    total: days.reduce((sum, day) => sum + day.sales, 0),
    days
  };
}
