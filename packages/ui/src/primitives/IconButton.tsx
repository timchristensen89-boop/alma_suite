import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
};

export function IconButton({ label, icon, className = '', ...props }: Props) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`icon-btn ${className}`.trim()}
    >
      {icon}
    </button>
  );
}
