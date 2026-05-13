import type { ChangeEvent, SelectHTMLAttributes } from 'react';

type Option = { label: string; value: string };

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  options: Option[];
};

export function Select({ label, hint, options, className = '', id, onChange, ...props }: Props) {
  const inputId = id ?? (label ? `select-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!onChange) return;
    const currentTarget = event.currentTarget;
    const stableEvent = Object.create(event) as ChangeEvent<HTMLSelectElement>;
    Object.defineProperty(stableEvent, 'currentTarget', { value: currentTarget, enumerable: true });
    Object.defineProperty(stableEvent, 'target', { value: currentTarget, enumerable: true });
    onChange(stableEvent);
  }

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <div className="field-select-wrapper">
        <select id={inputId} {...props} onChange={handleChange} className="field-control field-select">
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="field-select-caret"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
        >
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
