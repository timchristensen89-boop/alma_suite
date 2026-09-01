import type { ChangeEvent, InputHTMLAttributes, WheelEvent } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
};

export function Input({ label, hint, className = '', id, onChange, onWheel, ...props }: Props) {
  const inputId = id ?? (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!onChange) return;
    const currentTarget = event.currentTarget;
    const stableEvent = Object.create(event) as ChangeEvent<HTMLInputElement>;
    Object.defineProperty(stableEvent, 'currentTarget', { value: currentTarget, enumerable: true });
    Object.defineProperty(stableEvent, 'target', { value: currentTarget, enumerable: true });
    onChange(stableEvent);
  }

  /**
   * A focused <input type="number"> treats the scroll wheel as up/down. So
   * counting a shelf, typing a number, then scrolling to the next line —
   * mouse still over the field you just left — silently rewrites the number
   * you just wrote. Nothing tells you: the count is saved, submitted and
   * approved with a quantity nobody chose, and applying a stocktake SETS
   * on-hand to it.
   *
   * Blurring on wheel is the fix rather than preventDefault: the value is
   * already in state from onChange, so losing focus costs nothing, and the
   * page still scrolls. Cancelling the event instead would leave the field
   * focused and the page frozen under the cursor, which reads as the app
   * having hung.
   *
   * Not conditional on the element being focused — a browser that steps the
   * value on hover alone is covered too, and blur() on an unfocused input is
   * a no-op.
   */
  function handleWheel(event: WheelEvent<HTMLInputElement>) {
    if (event.currentTarget.type === 'number') event.currentTarget.blur();
    onWheel?.(event);
  }

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <input
        id={inputId}
        {...props}
        onChange={handleChange}
        onWheel={handleWheel}
        className="field-control"
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
