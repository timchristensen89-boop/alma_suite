/**
 * Who is on a training till, and what a training till is allowed to do.
 *
 * Pure, and in lib/ rather than inline in the services, because both decisions
 * here are safety decisions that read like one-liners and are wrong in exactly
 * one direction each. A test is cheaper than finding out on a Friday.
 *
 * Background: training already existed and already worked — PosOrder.training
 * is excluded from takings, the drawer, staff sales, guest spend, the reports
 * post and the kitchen dockets. What did NOT work was where the flag came
 * from: `alma.pos.training` in the browser's localStorage, per device,
 * defaulting to off, asserted by the same client you are trying to restrict.
 * Hand somebody a login and they got a live till on their own phone whatever
 * you intended. These two functions move that decision to the server.
 */

/**
 * Is this session a training till?
 *
 * OR, not AND, and that is the whole function. Every other thing a shared
 * device session does to a person NARROWS them — admin is dropped, the role
 * falls to STAFF, app access is intersected with the device's. This one has to
 * widen, because both mixtures are dangerous in the same direction:
 *
 *   training PIN on a live till   -> the new starter's practice becomes takings
 *   live PIN on a training till   -> the training iPad becomes a real register
 *
 * Intersecting would let either of those through. Widening cannot be wrong: at
 * worst a real sale gets rung on a practice account, which is visible, fixable
 * and costs nobody any money.
 */
export function sessionTrainingOnly(
  deviceTrainingOnly: boolean | undefined,
  staffTrainingOnly: boolean | undefined
): boolean {
  return deviceTrainingOnly === true || staffTrainingOnly === true;
}

/**
 * Should this bill be a training bill?
 *
 * Also OR: a manager on a live account may still ask for a practice bill (the
 * per-device switch is useful and stays), but a training account never gets a
 * live one no matter what the client sends.
 */
export function orderIsTraining(requestedByClient: unknown, callerTrainingOnly: boolean | undefined): boolean {
  return requestedByClient === true || callerTrainingOnly === true;
}

/**
 * The tenders a TRAINING bill may use.
 *
 * Both of these are things we merely RECORD. The money moved, or didn't,
 * somewhere we do not control, and the training row is excluded from takings,
 * the drawer and the reports post anyway — so a practice charge screen is
 * genuinely harmless, which matters, because practising the charge screen is
 * most of why training mode exists.
 *
 * The ones deliberately missing all reach out and move real money: a gift card
 * is really debited, a terminal really charges somebody's card, an online
 * payment is really taken. Flagging the row afterwards undoes none of that, so
 * they are refused rather than filtered.
 */
export const TRAINING_SAFE_TENDERS = new Set(['CASH', 'CARD_EXTERNAL']);

export function isTrainingSafeTender(method: string): boolean {
  return TRAINING_SAFE_TENDERS.has(method);
}
