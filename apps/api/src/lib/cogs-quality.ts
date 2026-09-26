// The COGS data-quality guards moved to @alma/shared so the Stock API's
// cost-of-goods summary applies the SAME suspect-row rule as the Reports menu
// profitability and the forecast engine. Re-exported here so existing imports
// keep working.
export { isSuspectRecipeCost, blendedTheoreticalCogsPct, UNMAPPED_TAKINGS_COGS_PCT } from '@alma/shared';
