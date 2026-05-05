import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

type Props = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
  }
>;

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  className = '',
  ...props
}: Props) {
  const classes = `btn btn-${variant} btn-${size} ${className}`.trim();

  return (
    <button {...props} className={classes}>
      {leftIcon ? <span className="btn-icon">{leftIcon}</span> : null}
      <span>{children}</span>
      {rightIcon ? <span className="btn-icon">{rightIcon}</span> : null}
    </button>
  );
}
