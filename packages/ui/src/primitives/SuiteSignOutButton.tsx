import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { ALMA_HOME_URL } from '../brand/almaHome';

function LogoutGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> & {
  /** Accessible label + tooltip. Defaults to "Sign out". */
  label?: string;
  /**
   * Clear the session. May be async — the redirect waits for it, so the
   * cookie is gone before Home loads and asks who you are.
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  /**
   * Where to land afterwards. Defaults to Alma Home. Pass `null` to stay put
   * and handle it yourself (a kiosk that must return to its own PIN screen,
   * say).
   */
  redirectTo?: string | null;
};

/**
 * The one true sign-out control for the suite topbar. Icon-only so it stays
 * compact on mobile and looks identical in every app — never let an app
 * hand-roll its own sign-out button again; import this instead.
 *
 * Signing out returns to Alma Home, not to the app's own login screen. Nine
 * apps each bouncing you to their own sign-in page made leaving one of them
 * feel like being locked out of the suite, and the screen you landed on was
 * the one screen that could not help you get anywhere else. Home is the
 * launcher: it is where somebody who has just finished with Staff actually
 * wants to be.
 */
export function SuiteSignOutButton({
  label = 'Sign out',
  className = '',
  onClick,
  redirectTo = ALMA_HOME_URL,
  ...props
}: Props) {
  return (
    <button
      type="button"
      {...props}
      onClick={async (event) => {
        try {
          await onClick?.(event);
        } finally {
          // Even if clearing the session threw, leave: staying on a screen
          // whose auth state is now unknown is the worse failure.
          if (redirectTo) window.location.assign(redirectTo);
        }
      }}
      aria-label={label}
      title={label}
      className={`icon-btn suite-signout ${className}`.trim()}
    >
      <LogoutGlyph />
    </button>
  );
}
