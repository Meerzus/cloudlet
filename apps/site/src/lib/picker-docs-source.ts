import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { COLOR_PICKER_DOCS_PATH } from './site';

/**
 * The color picker's documentation (COLOR_PICKER §9): its own collection under
 * `content/color-picker` (`content/docs/<locale>` is the Toaster's, by language), served at `/color-picker/docs` in the same docs shell as the
 * Toaster's. Same Markdown processing as `docs-source.ts`, so `/llms.txt`, the `.md` pages and
 * search read it the same way.
 */
const docs = defineDocs({
  dir: 'content/color-picker',
  docs: {
    postprocess: {
      includeProcessedMarkdown: { headingIds: false, mdxAsPlaceholder: ['Callout', 'InstallCommand', 'PickerDemo'] },
    },
  },
});

export const pickerSource = loader({ baseUrl: COLOR_PICKER_DOCS_PATH, source: docs.toFumadocsSource() });
