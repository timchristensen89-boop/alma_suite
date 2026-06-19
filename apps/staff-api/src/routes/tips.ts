import { makeStubRouter } from '../lib/stub.js';

// Workforce: tips (cash/card/Square import), payout runs, ABA/CSV export.
// Current home: apps/api/src/services/staff.service.ts (listTips/markTipsPaid/generatePayout).
export const tipsRouter = makeStubRouter('tips', 'apps/api → staff.service.ts');
