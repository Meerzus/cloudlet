import { useId } from 'react';

/** Native radio navigation: Tab enters the group; arrows select; Space checks. */
export function Choice<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (value: T) => void; options: readonly (readonly [T, string])[];
}) {
  const name = useId();
  return <fieldset className="lab-choice"><legend>{label}</legend><div>{options.map(([option, text]) =>
    <label key={option}><input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />{text}</label>,
  )}</div></fieldset>;
}
