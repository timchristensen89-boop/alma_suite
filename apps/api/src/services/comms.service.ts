import type { CommsThreadCategory } from '@prisma/client';
import type { AuthUser } from '@alma/shared';
import {
  acknowledgeThread,
  addMessage,
  canManageMessaging,
  createMessageSchema,
  createMessageThreadSchema,
  createThread,
  evaluateCommsAlertsDryRun,
  getThreadForUser,
  listInboxForUser,
  listRecipientOptions,
  markThreadRead
} from './messaging.service.js';

export const createCommsThreadSchema = createMessageThreadSchema;
export const createCommsMessageSchema = createMessageSchema;
export const canManageComms = canManageMessaging;
export const listCommsRecipientOptions = listRecipientOptions;
export { evaluateCommsAlertsDryRun };

export function listCommsInbox(actor: AuthUser, category?: CommsThreadCategory) {
  return listInboxForUser(actor, category);
}

export function getCommsThread(threadId: string, actor: AuthUser) {
  return getThreadForUser(threadId, actor);
}

export function createCommsThread(input: unknown, actor: AuthUser) {
  return createThread(actor, input);
}

export function addCommsMessage(threadId: string, input: unknown, actor: AuthUser) {
  return addMessage(actor, threadId, input);
}

export function markCommsThreadRead(threadId: string, actor: AuthUser) {
  return markThreadRead(actor, threadId);
}

export function acknowledgeCommsThread(threadId: string, actor: AuthUser) {
  return acknowledgeThread(actor, threadId);
}
