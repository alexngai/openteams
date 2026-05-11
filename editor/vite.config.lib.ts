/**
 * Library build for `openteams-editor`.
 *
 * Produces a single ESM bundle at `dist/lib/index.js` with externalized
 * peer dependencies (react, react-dom, @xyflow/react, zustand) so embedded
 * consumers reuse the host's React tree.
 *
 * The standalone SPA still uses the default `vite.config.ts` build for
 * the static-bundle preview server.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@openteams': path.resolve(__dirname, '../src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist/lib',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'openteams-editor',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@xyflow/react',
        'zustand',
        'zustand/middleware',
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          '@xyflow/react': 'XYFlow',
          zustand: 'zustand',
        },
      },
    },
    sourcemap: true,
    cssCodeSplit: false,
  },
});
