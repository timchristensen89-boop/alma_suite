import { makeStubRouter } from '../lib/stub.js';

// Workforce: leave requests, approvals, balances.
// Current home: apps/api/src/services/staff.service.ts (listLeaveRequests/updateLeaveRequest).
export const leaveRouter = makeStubRouter('leave', 'apps/api → staff.service.ts');
