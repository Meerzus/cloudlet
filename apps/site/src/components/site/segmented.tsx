'use client';

import { useId } from 'react';

/**
 * A native radio group drawn as a segmented control: arrows move inside it, Tab moves on. An option
 * with `disabled` stays in place but faded: a disabled radio is skipped by the arrows and the mouse.
 */
export function Segmented<Value extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { value: Value; label: string; disabled?: boolean }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="float-left text-sm text-muted-foreground">{legend}</legend>
      <div className="flex rounded-full border border-glass-border bg-background/40 p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={`relative rounded-full px-3 py-1.5 text-sm transition-colors has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60 ${
              option.disabled ? 'cursor-default text-muted-foreground/45' : 'cursor-pointer text-muted-foreground hover:text-foreground'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
