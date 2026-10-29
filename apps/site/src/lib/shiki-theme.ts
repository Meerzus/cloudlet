import { createCssVariablesTheme } from 'shiki/core';

/**
 * The documentation's Shiki theme (DOCS.md §1): every token colour is `var(--shiki-token-*)`,
 * defined for day and night in `components/docs/docs.css` from the Get started palette.
 * Build-time only (source.config.ts); nothing from Shiki ships to the browser.
 */
export const SHIKI_THEME = createCssVariablesTheme({ name: 'cloudlet', variablePrefix: '--shiki-', fontStyle: true });
