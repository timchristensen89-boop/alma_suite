import type { ChangeEvent, InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
};

export function Input({ label, hint, className = '', id, onChange, ...props }: Props) {
  const inputId = id ?? (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!onChange) return;
    const currentTarget = event.currentTarget;
    const stableEvent = Object.create(event) as ChangeEvent<HTMLInputElement>;
    Object.defineProperty(stableEvent, 'currentTarget', { value: currentTarget, enumerable: true });
    Object.defineProperty(stableEvent, 'target', { value: currentTarget, enumerable: true });
    onChange(stableEvent);
  }

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <input id={inputId} {...props} onChange={handleChange} className="field-control" />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
