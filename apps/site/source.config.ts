import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { defineConfig } from 'fumadocs-mdx/config';
import { DEMO_META, DEMO_NOTE, remarkDemoNote } from './src/lib/remark-demo-note';
import { remarkReferenceTables } from './src/lib/remark-reference-tables';
import { SHIKI_THEME } from './src/lib/shiki-theme';

/**
 * Global MDX options of the documentation. Collections are declared with the
 * macro API in `src/lib/docs-source.ts`; this file only tunes the built-in plugins.
 *
 * Code is highlighted at build time by Shiki with one theme on CSS variables: the palette
 * lives in `src/components/docs/docs.css` per `:root` / `.dark`, so a theme switch changes
 * colours without a second inlined palette and without a flash on load. rehype-code merges
 * these options over its defaults (github light/dark under `themes`), so the single theme is
 * given under `themes` too, as the default colour, which inlines it once per token.
 *
 * Fence meta: rehype-code keeps `title` (and a few more) as `<pre>` props and Shiki drops the
 * rest, so `demo="<id>"` is parsed here into `data-demo` for the code block, and
 * the first runnable fence of a page (marked by remarkDemoNote) gets `data-demo-note`.
 * Tables of the Reference pages are marked by remarkReferenceTables for their phone layout.
 */
const parseMeta = rehypeCodeDefaultOptions.parseMetaString;
export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [...plugins, remarkDemoNote, remarkReferenceTables],
    rehypeCodeOptions: {
      themes: { light: SHIKI_THEME },
      defaultColor: 'light',
      parseMetaString: (meta, node, tree) => {
        const data = parseMeta?.(meta, node, tree) ?? {};
        const demo = DEMO_META.exec(meta)?.[1];
        if (!demo) return data;
        const note = meta.split(/\s+/u).includes(DEMO_NOTE);
        return { ...data, 'data-demo': demo, ...(note ? { 'data-demo-note': '' } : {}) };
      },
      // No language icons and no `tab` wrapper: the code block is the site's own component.
      icon: false,
      tab: false,
    },
  },
});
