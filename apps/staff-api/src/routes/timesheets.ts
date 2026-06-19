import { makeStubRouter } from '../lib/stub.js';

// Workforce: timesheets, approval, Xero export.
// Current home: apps/api/src/services/staff.service.ts (listTimesheets/approveTimesheet/exportXero).
export const timesheetsRouter = makeStubRouter('timesheets', 'apps/api → staff.service.ts');
