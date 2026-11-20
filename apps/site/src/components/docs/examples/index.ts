import type { ComponentType } from 'react';
import { InlinePanel } from './color-picker/panel';

/**
 * The live examples of the docs by name: `<component>/<file>` is the file next to this one that
 * `<Example name="…" />` renders and shows as code. A file without an entry here, or an entry
 * without a file, fails the build and tests/unit/site-docs-examples.test.ts.
 */
export const EXAMPLES: Readonly<Record<string, ComponentType>> = {
  'color-picker/panel': InlinePanel,
};
