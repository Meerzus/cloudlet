import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        // The harness is a browser-only app. The package build and guards
        // preserve and verify the real client boundary before consumption.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')
          && (warning.id?.endsWith('/cloudlet/dist/react.js') || warning.id?.includes('/node_modules/framer-motion/'))) return;
        defaultHandler(warning);
      },
    },
  },
});
