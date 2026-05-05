import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
};

export function Input({ label, hint, className = '', id, ...props }: Props) {
  const inputId = id ?? (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <input id={inputId} {...props} className="field-control" />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
