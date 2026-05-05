import type { TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
};

export function Textarea({ label, hint, className = '', id, rows = 4, ...props }: Props) {
  const inputId = id ?? (label ? `textarea-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <textarea id={inputId} rows={rows} {...props} className="field-control field-textarea" />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
