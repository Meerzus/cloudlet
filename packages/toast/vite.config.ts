import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootEntry = fileURLToPath(new URL('./src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'cloudlet-client-boundary',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      // Keep the root's client facade reference literal. Even preserveModules
      // otherwise redirects these exports to their hook implementation module.
      if (importer === rootEntry && source === './react.js') return { id: source, external: true };
    },
  }],
  build: {
    target: ['chrome111', 'edge111', 'firefox114', 'safari16.4'],
    sourcemap: true,
    cssCodeSplit: true,
    minify: true,
    lib: {
      entry: {
        index: rootEntry,
        react: fileURLToPath(new URL('./src/react.ts', import.meta.url)),
        styles: fileURLToPath(new URL('./src/styles.css', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'styles',
    },
    rolldownOptions: {
      // Only the peers stay external: an accidental runtime dependency would be bundled and
      // caught by check-package (source maps may point at packed Cloudlet sources only).
      external: /^(react|react-dom)(\/.*)?$/,
      output: {
        preserveModules: true,
        preserveModulesRoot: fileURLToPath(new URL('./src', import.meta.url)),
      },
      onwarn(warning, defaultHandler) {
        // This exact entry's directive survives in preserveModules output.
        // check-package verifies both its directive and the root import path.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client') && warning.id?.endsWith('/src/react.ts')) return;
        defaultHandler(warning);
      },
      // Preserve the actual import graph as well as the client directive:
      // the public root must reach React values through react.js.
    },
  },
});
