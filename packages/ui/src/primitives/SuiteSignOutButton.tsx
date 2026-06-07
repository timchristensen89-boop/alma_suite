import type { ButtonHTMLAttributes } from 'react';

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

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Accessible label + tooltip. Defaults to "Sign out". */
  label?: string;
};

/**
 * The one true sign-out control for the suite topbar. Icon-only so it stays
 * compact on mobile and looks identical in every app — never let an app
 * hand-roll its own sign-out button again; import this instead.
 */
export function SuiteSignOutButton({ label = 'Sign out', className = '', ...props }: Props) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={`icon-btn suite-signout ${className}`.trim()}
    >
      <LogoutGlyph />
    </button>
  );
}
