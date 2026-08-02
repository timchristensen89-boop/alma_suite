/**
 * Hand-drawn emblems for the themed cards — a heart for Love, a whistle for
 * Coach, a mortarboard for the grad.
 *
 * All one stroke weight and one viewBox scale so a theme is a single prop
 * change, exactly as the design intends.
 */

export const GIFT_CARD_EMBLEMS = [
  'none', 'heart', 'rose', 'bow', 'whistle', 'grad', 'rings', 'key', 'glass', 'house', 'sprig'
] as const;

export type GiftCardEmblem = (typeof GIFT_CARD_EMBLEMS)[number];

export function isGiftCardEmblem(value: unknown): value is GiftCardEmblem {
  return typeof value === 'string' && (GIFT_CARD_EMBLEMS as readonly string[]).includes(value);
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const;

export function Emblem({ name, size = 42 }: { name: GiftCardEmblem; size?: number }) {
  const h = size;
  switch (name) {
    case 'heart':
      return (
        <svg width={h} height={h} viewBox="0 0 48 48" {...S} aria-hidden>
          <path d="M24 40C10 30 6 22 6 16.5 6 11 10 8 14 8c3 0 6 2 10 6 4-4 7-6 10-6 4 0 8 3 8 8.5C42 22 38 30 24 40Z" />
        </svg>
      );
    case 'rose':
      return (
        <svg width={h} height={h} viewBox="0 0 48 48" {...S} aria-hidden>
          <path d="M24 6c-5 0-9 4-9 9 0 3 1.5 5.5 4 7-3 1-6 4-6 8 0 5 4 8 11 8s11-3 11-8c0-4-3-7-6-8 2.5-1.5 4-4 4-7 0-5-4-9-9-9Z" />
          <path d="M24 15v13M18 22h12" strokeWidth={1.1} />
        </svg>
      );
    case 'bow':
      return (
        <svg width={(h * 56) / 48} height={h} viewBox="0 0 56 48" {...S} aria-hidden>
          <path d="M28 24 10 15v18l18-9Zm0 0 18-9v18l-18-9Z" />
          <circle cx="28" cy="24" r="3.5" />
        </svg>
      );
    case 'whistle':
      return (
        <svg width={(h * 52) / 48} height={h} viewBox="0 0 52 48" {...S} aria-hidden>
          <path d="M8 20h26l10-4v16a10 10 0 0 1-20 0v-2H8a4 4 0 0 1 0-8Z" />
          <circle cx="24" cy="30" r="4" />
          <path d="M12 16V9" strokeWidth={1.2} />
        </svg>
      );
    case 'grad':
      return (
        <svg width={(h * 56) / 48} height={h} viewBox="0 0 56 48" {...S} aria-hidden>
          <path d="M28 12 6 20l22 8 22-8-22-8Z" />
          <path d="M16 24v9c0 3 5.4 5 12 5s12-2 12-5v-9M50 20v11" strokeWidth={1.2} />
        </svg>
      );
    case 'rings':
      return (
        <svg width={(h * 60) / 48} height={h} viewBox="0 0 60 48" {...S} aria-hidden>
          <circle cx="23" cy="27" r="12" />
          <circle cx="37" cy="27" r="12" />
          <path d="M30 12l-3 5h6l-3-5Z" strokeWidth={1.2} />
        </svg>
      );
    case 'key':
      return (
        <svg width={h} height={h} viewBox="0 0 48 48" {...S} aria-hidden>
          <circle cx="17" cy="17" r="9" />
          <path d="M23.5 23.5 40 40M34 34l5-5M30 30l4-4" strokeWidth={1.3} />
        </svg>
      );
    case 'glass':
      return (
        <svg width={(h * 52) / 48} height={h} viewBox="0 0 52 48" {...S} aria-hidden>
          <path
            d="M16 8 12 26a7 7 0 0 0 14 0L22 8M36 8l-4 18a7 7 0 0 0 14 0L42 8M9 8h20M32 8h15M19 33v7M39 33v7M14 42h11M34 42h11"
            strokeWidth={1.2}
          />
        </svg>
      );
    case 'house':
      return (
        <svg width={(h * 52) / 48} height={h} viewBox="0 0 52 48" {...S} aria-hidden>
          <path d="M8 24 26 8l18 16M12 22v18h28V22M22 40V28h8v12" />
        </svg>
      );
    case 'sprig':
      return (
        <svg width={h} height={h} viewBox="0 0 48 48" {...S} aria-hidden>
          <path d="M24 42V12M24 20c-6 0-10-4-10-9 5 0 10 3 10 9Zm0 0c6 0 10-4 10-9-5 0-10 3-10 9Zm0 10c-5 0-8-3-8-7 4 0 8 2 8 7Zm0 0c5 0 8-3 8-7-4 0-8 2-8 7Z" />
        </svg>
      );
    default:
      return null;
  }
}

/** The themes the design ships, each a greeting, a line and an emblem. */
export const GIFT_CARD_THEMES: Array<{
  id: string;
  greeting: string;
  eyebrow: string;
  emblem: GiftCardEmblem;
}> = [
  { id: 'thanks', greeting: 'Thank You', eyebrow: 'with our thanks', emblem: 'none' },
  { id: 'birthday', greeting: 'Happy Birthday', eyebrow: 'many happy returns', emblem: 'none' },
  { id: 'congrats', greeting: 'Congratulations', eyebrow: 'with warm wishes', emblem: 'none' },
  { id: 'love', greeting: 'With Love', eyebrow: 'for someone special', emblem: 'heart' },
  { id: 'mum', greeting: 'For Mum', eyebrow: 'with love & thanks', emblem: 'rose' },
  { id: 'dad', greeting: 'For Dad', eyebrow: 'with love & thanks', emblem: 'bow' },
  { id: 'coach', greeting: 'Thank You, Coach', eyebrow: 'with gratitude', emblem: 'whistle' },
  { id: 'teacher', greeting: 'Thank You, Teacher', eyebrow: 'with appreciation', emblem: 'grad' },
  { id: 'anniversary', greeting: 'Happy Anniversary', eyebrow: "here's to you both", emblem: 'rings' },
  { id: 'welcome', greeting: 'Welcome', eyebrow: "so glad you're here", emblem: 'key' },
  { id: 'cheers', greeting: 'Cheers', eyebrow: 'just because', emblem: 'glass' },
  { id: 'graduation', greeting: 'Congrats, Grad', eyebrow: 'the world is yours', emblem: 'grad' },
  { id: 'newhome', greeting: 'New Home', eyebrow: 'warm wishes within', emblem: 'house' },
  { id: 'getwell', greeting: 'Get Well Soon', eyebrow: 'thinking of you', emblem: 'sprig' }
];
