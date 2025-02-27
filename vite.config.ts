import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { env } from 'process';
import path from 'path';

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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@api': path.resolve(__dirname, 'src', 'api'),
      '@renderer': path.resolve(__dirname, 'src', 'renderer'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
  },
});
