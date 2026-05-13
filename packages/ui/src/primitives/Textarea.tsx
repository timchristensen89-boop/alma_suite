import type { ChangeEvent, TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
};

export function Textarea({ label, hint, className = '', id, rows = 4, onChange, ...props }: Props) {
  const inputId = id ?? (label ? `textarea-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (!onChange) return;
    const currentTarget = event.currentTarget;
    const stableEvent = Object.create(event) as ChangeEvent<HTMLTextAreaElement>;
    Object.defineProperty(stableEvent, 'currentTarget', { value: currentTarget, enumerable: true });
    Object.defineProperty(stableEvent, 'target', { value: currentTarget, enumerable: true });
    onChange(stableEvent);
  }

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <textarea id={inputId} rows={rows} {...props} onChange={handleChange} className="field-control field-textarea" />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
