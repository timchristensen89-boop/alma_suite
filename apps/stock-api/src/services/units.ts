// Unit conversion for recipe costing and stocktake valuation.
//
// The implementation lives in @alma/shared (stock-units.ts) so the web app's
// live estimates and the API's authoritative valuation agree token for token.
// The alias table it consults is editable in Stock → Setup → Units and is
// loaded into the shared module by unit-aliases.service.ts at boot and after
// every edit.
export {
  convertQuantityToCostUnit,
  convertBetweenUnits,
  normaliseUnitLabel,
  parsePackLabel,
  type CostUnitItem,
  type QuantityConversion
} from '@alma/shared';
