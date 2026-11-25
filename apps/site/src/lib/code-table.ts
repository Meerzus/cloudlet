import type { CodeToken } from './toaster-settings';

/** Several codes that share most of their lines: each line once, and every code as the places of its lines. */
export interface CodeTable {
  readonly lines: readonly (readonly CodeToken[])[];
  readonly codes: Readonly<Record<string, readonly number[]>>;
}

/** The lines of one code of a table. */
export function tableCode(table: CodeTable, key: string): readonly (readonly CodeToken[])[] {
  const code = table.codes[key];
  if (!code) throw new Error(`No code "${key}" in the table`);
  return code.map((place) => table.lines[place] ?? []);
}
