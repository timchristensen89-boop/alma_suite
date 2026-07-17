// Starter automation library — the SevenRooms-style visit-lifecycle set, seeded
// per venue by marketingService.installAutomationLibrary(). Each item becomes a
// MarketingEmailTemplate + a MarketingAutomation (active:false so a manager
// reviews and turns it on). The runner (runDueAutomations) fires the active ones.
//
// Trigger params live in segmentDefinition (the same filters the audience builder
// uses); the runner adds consent + dedup. Event-based triggers (cancellation,
// no-show) read recent reservations instead of a segment.
//
// Copy uses the merge tokens the renderer understands: {{firstName}},
// {{venueName}}, {{bookingLink}}, {{unsubscribeLink}}.

import type { MarketingAutomationTriggerType } from '@alma/shared';

export type AutomationLibraryItem = {
  key: string;
  name: string;
  triggerType: MarketingAutomationTriggerType;
  // Audience filter for guest-attribute triggers. Empty for event-based triggers.
  segmentDefinition: Record<string, unknown>;
  delayHours: number;
  subject: string;
  previewText: string;
  htmlBody: string;
  textBody: string;
};

function html(paragraphs: string[]): string {
  return paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#2a2a2a;">${p}</p>`)
    .join('\n');
}

function button(label: string): string {
  return `<p style="margin:24px 0;"><a href="{{bookingLink}}" style="background:#1f1b16;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;display:inline-block;">${label}</a></p>`;
}

export const AUTOMATION_LIBRARY: AutomationLibraryItem[] = [
  {
    key: 'first-visit-thank-you',
    name: 'Visit - First Visit - Thank You',
    triggerType: 'FIRST_VISIT_COMPLETED',
    segmentDefinition: { minVisits: 1, maxVisits: 1, lastVisitWithinDays: 3, marketingOptInOnly: true, emailOnly: true },
    delayHours: 4,
    subject: 'Thank you for joining us at {{venueName}}',
    previewText: 'It was lovely having you — we hope to see you again soon.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'Thank you for joining us at {{venueName}} — it was a pleasure to have you with us.',
        'We hope you had a wonderful time, and we would love to welcome you back whenever you feel like it.'
      ]) + button('Book again'),
    textBody:
      'Hi {{firstName}},\n\nThank you for joining us at {{venueName}} — it was a pleasure to have you. We hope to welcome you back soon. Book again: {{bookingLink}}'
  },
  {
    key: 'fourth-visit-thank-you',
    name: 'Visit - Fourth Visit - Thank You',
    triggerType: 'REPEAT_VISIT',
    segmentDefinition: { minVisits: 4, maxVisits: 4, lastVisitWithinDays: 3, marketingOptInOnly: true, emailOnly: true },
    delayHours: 4,
    subject: 'Our sincerest thanks, {{firstName}}',
    previewText: 'You keep coming back — and that means the world to us.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'You have become one of our favourite regulars at {{venueName}}, and we wanted to say a heartfelt thank you.',
        'It is guests like you who make what we do worthwhile. We look forward to seeing you again very soon.'
      ]) + button('Reserve a table'),
    textBody:
      'Hi {{firstName}},\n\nYou have become one of our favourite regulars at {{venueName}} — thank you. We look forward to seeing you again. Reserve: {{bookingLink}}'
  },
  {
    key: 'cancellation',
    name: 'Visit - Cancellation',
    triggerType: 'RESERVATION_CANCELLED',
    segmentDefinition: {},
    delayHours: 1,
    subject: 'Thanks for letting us know, {{firstName}}',
    previewText: 'No problem at all — we hope to see you another time.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'Thank you for letting us know you can no longer make your reservation at {{venueName}} — no problem at all.',
        'Whenever the time is right, we would be delighted to welcome you. Your table will be waiting.'
      ]) + button('Rebook when ready'),
    textBody:
      'Hi {{firstName}},\n\nThanks for letting us know you can no longer make it to {{venueName}} — no problem at all. Rebook whenever you like: {{bookingLink}}'
  },
  {
    key: 'no-show',
    name: 'Visit - No Show',
    triggerType: 'NO_SHOW',
    segmentDefinition: {},
    delayHours: 18,
    subject: 'We missed you',
    previewText: 'We had your table ready — we hope everything is okay.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'We had your table ready at {{venueName}} and were sorry to miss you. We hope everything is well.',
        'If you would like to come in another time, we would love to have you — just let us know.'
      ]) + button('Book another time'),
    textBody:
      'Hi {{firstName}},\n\nWe had your table ready at {{venueName}} and were sorry to miss you. We would love to have you another time: {{bookingLink}}'
  },
  {
    key: 're-engagement-30',
    name: 'Visit - Re-Engagement - 30 Days No Visit',
    triggerType: 'LAPSED_GUEST',
    segmentDefinition: { lastVisitOlderThanDays: 30, lastVisitWithinDays: 44, marketingOptInOnly: true, emailOnly: true },
    delayHours: 0,
    subject: 'Come back whenever you feel like it',
    previewText: 'It has been a little while — your table is always here.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'It has been a little while since we last saw you at {{venueName}}, and we have been thinking of you.',
        'Whenever you feel like it, your table is here and a warm welcome awaits.'
      ]) + button('Reserve a table'),
    textBody:
      'Hi {{firstName}},\n\nIt has been a little while since we saw you at {{venueName}}. Whenever you feel like it, your table is here: {{bookingLink}}'
  },
  {
    key: 're-engagement-120',
    name: 'Visit - Re-Engagement - 120 Days No Visit',
    triggerType: 'LAPSED_GUEST',
    segmentDefinition: { lastVisitOlderThanDays: 120, lastVisitWithinDays: 148, marketingOptInOnly: true, emailOnly: true },
    delayHours: 0,
    subject: 'A warm welcome awaits, {{firstName}}',
    previewText: 'It has been too long — we would love to see you again.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'It has been quite a while since your last visit to {{venueName}}, and we would genuinely love to see you again.',
        'A warm welcome — and your favourite table — awaits whenever you are ready.'
      ]) + button('Come back in'),
    textBody:
      'Hi {{firstName}},\n\nIt has been a while since your last visit to {{venueName}} — we would love to see you again. {{bookingLink}}'
  },
  {
    key: 'birthday',
    name: 'Happy Birthday',
    triggerType: 'BIRTHDAY_UPCOMING',
    segmentDefinition: { birthdaysWithinDays: 7, marketingOptInOnly: true, emailOnly: true },
    delayHours: 0,
    subject: 'Happy Birthday from {{venueName}}',
    previewText: 'Wishing you a wonderful day — celebrate with us?',
    htmlBody:
      html([
        'Happy birthday, {{firstName}}!',
        'Everyone at {{venueName}} wishes you a wonderful day and a brilliant year ahead.',
        'If you are looking for somewhere to celebrate, we would love to be part of it.'
      ]) + button('Book your celebration'),
    textBody:
      'Happy birthday, {{firstName}}! Everyone at {{venueName}} wishes you a wonderful day. Celebrate with us: {{bookingLink}}'
  },
  {
    key: 'vip-winback-120',
    name: 'VIP winback 120 days',
    triggerType: 'BIG_SPENDER',
    segmentDefinition: { minSpendCents: 50000, lastVisitOlderThanDays: 120, lastVisitWithinDays: 240, marketingOptInOnly: true, emailOnly: true },
    delayHours: 0,
    subject: "We'd love to see you again, {{firstName}}",
    previewText: 'You are one of our most valued guests — come back in.',
    htmlBody:
      html([
        'Hi {{firstName}},',
        'You are one of our most valued guests at {{venueName}}, and it has been too long since your last visit.',
        'We would be delighted to welcome you back — come in whenever you feel like it.'
      ]) + button('Reserve your table'),
    textBody:
      'Hi {{firstName}},\n\nYou are one of our most valued guests at {{venueName}} and we would love to welcome you back. Reserve: {{bookingLink}}'
  }
];
