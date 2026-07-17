import { makeStubRouter } from '../lib/stub.js';

// Workforce: rostering / scheduling / forecast snapshots.
// Current home: apps/api/src/services/staff.service.ts (listRoster/createRoster/publishRoster).
export const rosterRouter = makeStubRouter('roster', 'apps/api → staff.service.ts');
