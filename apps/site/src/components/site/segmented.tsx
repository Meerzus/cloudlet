'use client';

import { useId } from 'react';
import { SEGMENT_STYLE, useSegmentIndicator } from './use-segment-indicator';

/**
 * A native radio group drawn as a segmented control: arrows move inside it, Tab moves on. One solid
 * highlight slides under the chosen option on a spring and the label on it inverts; until the
 * highlight is placed (server render, before hydration) the chosen option paints its own
 * background, so the choice is visible either way; under forced colours both are the system's
 * highlight with its text colour, hovered or not. An option with `disabled` stays in place but
 * faded: a disabled radio is skipped by the arrows and the mouse.
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
  const { group, indicator } = useSegmentIndicator(options.findIndex((option) => option.value === value));
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="float-left text-sm text-muted-foreground">{legend}</legend>
      <div ref={group} style={SEGMENT_STYLE} className="relative flex gap-0.5 rounded-[0.875rem] border border-border p-1">
        {/* Forced colours replace ordinary backgrounds: the highlight keeps the system's own. */}
        <span
          ref={indicator}
          aria-hidden="true"
          style={{ borderRadius: '0.625rem' }}
          className="segment-indicator inset-y-1 bg-foreground forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none"
        />
        {options.map((option) => (
          <label
            key={option.value}
            data-segment=""
            className={`relative inline-flex h-8 items-center rounded-[0.625rem] px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 has-[:checked]:bg-foreground has-[:checked]:text-background in-data-segment-ready:has-[:checked]:bg-transparent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60 forced-colors:has-[:checked]:bg-[Highlight] forced-colors:has-[:checked]:text-[HighlightText] forced-colors:has-[:checked]:forced-color-adjust-none forced-colors:in-data-segment-ready:has-[:checked]:bg-transparent ${
              option.disabled ? 'cursor-default text-muted-foreground/45' : 'cursor-pointer text-muted-foreground hover:text-foreground has-[:checked]:hover:text-background forced-colors:has-[:checked]:hover:text-[HighlightText]'
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
