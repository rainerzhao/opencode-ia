'use strict';
const path = require('node:path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react').default;

module.exports = defineConfig({
  root: path.resolve(__dirname, 'apps/web'),
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, 'dist/web'), emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/socket': { target: 'ws://127.0.0.1:3000', ws: true } } }
});
