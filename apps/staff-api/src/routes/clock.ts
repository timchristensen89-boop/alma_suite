import { makeStubRouter } from '../lib/stub.js';

// Workforce: clock in/out, breaks, manager clock review.
// Current home: apps/api/src/services/staff.service.ts (clockIn/clockOut/startBreak/endBreak).
export const clockRouter = makeStubRouter('clock', 'apps/api → staff.service.ts');
