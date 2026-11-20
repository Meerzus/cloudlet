import type { ComponentType } from 'react';
import { SavedFormat } from './color-picker/format';
import { GermanPicker } from './color-picker/labels';
import { HexOnly } from './color-picker/one-format';
import { WithOpacity } from './color-picker/opacity';
import { InlinePanel } from './color-picker/panel';
import { AccentVariable } from './color-picker/swatch';

/**
 * The live examples of the docs by name: `<component>/<file>` is the file next to this one that
 * `<Example name="…" />` renders and shows as code. A file without an entry here, or an entry
 * without a file, fails the build and tests/unit/site-docs-examples.test.ts.
 */
export const EXAMPLES: Readonly<Record<string, ComponentType>> = {
  'color-picker/format': SavedFormat,
  'color-picker/labels': GermanPicker,
  'color-picker/one-format': HexOnly,
  'color-picker/opacity': WithOpacity,
  'color-picker/panel': InlinePanel,
  'color-picker/swatch': AccentVariable,
};
