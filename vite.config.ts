import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { env } from 'process';

const nodeEnv = env.NODE_ENV ?? 'production';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  build: {
    lib: {
      entry: 'src/api/voice-sdk.ts',
      name: 'VoiceSDK',
      fileName: 'js/voice-sdk',
      cssFileName: 'css/voice-sdk',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
    cssMinify: true,
    cssCodeSplit: false,
    minify: nodeEnv === 'production',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
  },
});
