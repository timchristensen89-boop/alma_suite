export type AustralianAwardCode = 'MA000119' | 'MA000009';
export type StaffAwardEmploymentType = 'CASUAL' | 'PART_TIME' | 'FULL_TIME';
export type StaffPayMode = 'AWARD' | 'MANUAL_FULL_TIME' | 'CASH';
export type ManualFullTimePayFrequency = 'ANNUAL_SALARY' | 'HOURLY_FULL_TIME';

export type AwardClassificationRate = {
  id: string;
  label: string;
  weeklyRateCents: number;
  ordinaryHourlyRateCents: number;
  casualLoadedHourlyRateCents: number;
};

export type AwardRateSet = {
  awardCode: AustralianAwardCode;
  awardName: string;
  rateEffectiveFrom: string;
  payGuidePublishedAt: string;
  rateSetVersion: string;
  sourceUrl: string;
  sourceLabel: string;
  classifications: AwardClassificationRate[];
};

export const AWARD_RATE_EFFECTIVE_FROM = '2025-07-01';
export const AWARD_RATE_SET_VERSION = '2025-07-01/FWO-2026-01';

const restaurantRates = [
  ['introductory', 'Introductory level', 92270, 2428, 3035],
  ['level-1-food-beverage-attendant-grade-1', 'Level 1 - food and beverage attendant grade 1', 94800, 2495, 3119],
  ['level-1-kitchen-attendant-grade-1', 'Level 1 - kitchen attendant grade 1', 94800, 2495, 3119],
  ['level-2-food-beverage-attendant-grade-2', 'Level 2 - food and beverage attendant grade 2', 98240, 2585, 3231],
  ['level-2-cook-grade-1', 'Level 2 - cook grade 1', 98240, 2585, 3231],
  ['level-2-kitchen-attendant-grade-2', 'Level 2 - kitchen attendant grade 2', 98240, 2585, 3231],
  ['level-2-clerical-grade-1', 'Level 2 - clerical grade 1', 98240, 2585, 3231],
  ['level-2-storeperson-grade-1', 'Level 2 - storeperson grade 1', 98240, 2585, 3231],
  ['level-2-door-security-grade-1', 'Level 2 - door person/security officer grade 1', 98240, 2585, 3231],
  ['level-3-food-beverage-attendant-grade-3', 'Level 3 - food and beverage attendant grade 3', 101470, 2670, 3338],
  ['level-3-cook-grade-2', 'Level 3 - cook grade 2', 101470, 2670, 3338],
  ['level-3-kitchen-attendant-grade-3', 'Level 3 - kitchen attendant grade 3', 101470, 2670, 3338],
  ['level-3-clerical-grade-2', 'Level 3 - clerical grade 2', 101470, 2670, 3338],
  ['level-3-storeperson-grade-2', 'Level 3 - storeperson grade 2', 101470, 2670, 3338],
  ['level-3-timekeeper-security-grade-2', 'Level 3 - timekeeper/security officer grade 2', 101470, 2670, 3338],
  ['level-3-handyperson', 'Level 3 - handyperson', 101470, 2670, 3338],
  ['level-4-food-beverage-attendant-grade-4', 'Level 4 - food and beverage attendant grade 4 (tradesperson)', 106840, 2812, 3515],
  ['level-4-cook-grade-3', 'Level 4 - cook grade 3 (tradesperson)', 106840, 2812, 3515],
  ['level-4-clerical-grade-3', 'Level 4 - clerical grade 3', 106840, 2812, 3515],
  ['level-4-storeperson-grade-3', 'Level 4 - storeperson grade 3', 106840, 2812, 3515],
  ['level-5-food-beverage-supervisor', 'Level 5 - food and beverage supervisor', 113550, 2988, 3735],
  ['level-5-cook-grade-4', 'Level 5 - cook grade 4 (tradesperson)', 113550, 2988, 3735],
  ['level-5-clerical-supervisor', 'Level 5 - clerical supervisor', 113550, 2988, 3735],
  ['level-6-cook-grade-5', 'Level 6 - cook grade 5 (tradesperson)', 116570, 3068, 3835]
] as const;

const hospitalityRates = [
  ['introductory', 'Introductory level', 92270, 2428, 3035],
  ['level-1-food-beverage-attendant-grade-1', 'Level 1 food and beverage attendant grade 1', 94800, 2495, 3119],
  ['level-1-guest-service-grade-1', 'Level 1 guest service grade 1', 94800, 2495, 3119],
  ['level-1-kitchen-attendant-grade-1', 'Level 1 kitchen attendant grade 1', 94800, 2495, 3119],
  ['level-2-clerical-grade-1', 'Level 2 clerical grade 1', 98240, 2585, 3231],
  ['level-2-cook-grade-1', 'Level 2 cook grade 1', 98240, 2585, 3231],
  ['level-2-door-security-grade-1', 'Level 2 door person/security officer grade 1', 98240, 2585, 3231],
  ['level-2-food-beverage-attendant-grade-2', 'Level 2 food and beverage attendant grade 2', 98240, 2585, 3231],
  ['level-2-front-office-grade-1', 'Level 2 front office grade 1', 98240, 2585, 3231],
  ['level-2-guest-service-grade-2', 'Level 2 guest service grade 2', 98240, 2585, 3231],
  ['level-2-kitchen-attendant-grade-2', 'Level 2 kitchen attendant grade 2', 98240, 2585, 3231],
  ['level-2-storeperson-grade-1', 'Level 2 storeperson grade 1', 98240, 2585, 3231],
  ['level-3-cook-grade-2', 'Level 3 cook grade 2', 101470, 2670, 3338],
  ['level-3-food-beverage-attendant-grade-3', 'Level 3 food and beverage attendant grade 3', 101470, 2670, 3338],
  ['level-3-front-office-grade-2', 'Level 3 front office grade 2', 101470, 2670, 3338],
  ['level-3-guest-service-grade-3', 'Level 3 guest service grade 3', 101470, 2670, 3338],
  ['level-3-handyperson', 'Level 3 handyperson', 101470, 2670, 3338],
  ['level-3-kitchen-attendant-grade-3', 'Level 3 kitchen attendant grade 3', 101470, 2670, 3338],
  ['level-3-storeperson-grade-2', 'Level 3 storeperson grade 2', 101470, 2670, 3338],
  ['level-3-timekeeper-security-grade-2', 'Level 3 timekeeper/security officer grade 2', 101470, 2670, 3338],
  ['level-4-clerical-grade-3', 'Level 4 clerical grade 3', 106840, 2812, 3515],
  ['level-4-cook-grade-3', 'Level 4 cook (tradesperson) grade 3', 106840, 2812, 3515],
  ['level-4-food-beverage-attendant-grade-4', 'Level 4 food and beverage attendant (tradesperson) grade 4', 106840, 2812, 3515],
  ['level-4-front-office-grade-3', 'Level 4 front office grade 3', 106840, 2812, 3515],
  ['level-4-guest-service-grade-4', 'Level 4 guest service grade 4', 106840, 2812, 3515],
  ['level-4-storeperson-grade-3', 'Level 4 storeperson grade 3', 106840, 2812, 3515],
  ['level-5-clerical-supervisor', 'Level 5 clerical supervisor', 113550, 2988, 3735],
  ['level-5-cook-grade-4', 'Level 5 cook (tradesperson) grade 4', 113550, 2988, 3735],
  ['level-5-food-beverage-supervisor', 'Level 5 food and beverage supervisor', 113550, 2988, 3735],
  ['level-5-front-office-supervisor', 'Level 5 front office supervisor', 113550, 2988, 3735],
  ['level-5-guest-service-supervisor', 'Level 5 guest service supervisor', 113550, 2988, 3735],
  ['level-6-cook-grade-5', 'Level 6 cook (tradesperson) grade 5', 116570, 3068, 3835],
  ['managerial-staff-hotel', 'Managerial staff - hotel', 116792, 3073, 3841]
] as const;

function classification(
  row: readonly [string, string, number, number, number]
): AwardClassificationRate {
  return {
    id: row[0],
    label: row[1],
    weeklyRateCents: row[2],
    ordinaryHourlyRateCents: row[3],
    casualLoadedHourlyRateCents: row[4]
  };
}

export const AWARD_RATE_SETS: AwardRateSet[] = [
  {
    awardCode: 'MA000119',
    awardName: 'Restaurant Industry Award',
    rateEffectiveFrom: AWARD_RATE_EFFECTIVE_FROM,
    payGuidePublishedAt: '2026-01-09',
    rateSetVersion: AWARD_RATE_SET_VERSION,
    sourceUrl: 'https://calculate.fairwork.gov.au/Download/AwardSummary?awardCode=ma000119&fileType=pdf',
    sourceLabel: 'Fair Work Ombudsman Pay Guide - Restaurant Industry Award [MA000119], published 9 January 2026',
    classifications: restaurantRates.map(classification)
  },
  {
    awardCode: 'MA000009',
    awardName: 'Hospitality Industry (General) Award',
    rateEffectiveFrom: AWARD_RATE_EFFECTIVE_FROM,
    payGuidePublishedAt: '2026-01-15',
    rateSetVersion: AWARD_RATE_SET_VERSION,
    sourceUrl: 'https://calculate.fairwork.gov.au/Download/AwardSummary?awardCode=ma000009&fileType=pdf',
    sourceLabel: 'Fair Work Ombudsman Pay Guide - Hospitality Industry (General) Award [MA000009], published 15 January 2026',
    classifications: hospitalityRates.map(classification)
  }
];

export const DEFAULT_STAFF_AWARD_CODE: AustralianAwardCode = 'MA000119';
export const DEFAULT_STAFF_AWARD_CLASSIFICATION = 'introductory';

// Fallback for a casual with no rate configured: Restaurant Industry Award
// (MA000119) Level 2 — food & beverage attendant grade 2 — casual (loaded).
export const DEFAULT_CASUAL_AWARD_CODE: AustralianAwardCode = 'MA000119';
export const DEFAULT_CASUAL_AWARD_CLASSIFICATION = 'level-2-food-beverage-attendant-grade-2';

export function getAwardRateSet(awardCode: string) {
  return AWARD_RATE_SETS.find((award) => award.awardCode === awardCode) ?? null;
}

export function getAwardClassification(awardCode: string, classificationId: string) {
  return getAwardRateSet(awardCode)?.classifications.find((item) => item.id === classificationId) ?? null;
}

// Casual loaded hourly rate (cents) for the default casual classification. Sourced
// from the award table so it tracks the annual award increase automatically.
export function defaultCasualRateCents(): number {
  return (
    getAwardClassification(DEFAULT_CASUAL_AWARD_CODE, DEFAULT_CASUAL_AWARD_CLASSIFICATION)
      ?.casualLoadedHourlyRateCents ?? 3231
  );
}
