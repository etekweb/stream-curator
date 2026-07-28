import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'node:path';

const port = Number(process.env.VITE_DEV_PORT || 5175);

export default defineConfig({
  plugins: [
    vue(),
    // Self-signed cert (HTTPS). Note: Twitch embeds on non-localhost hosts still prefer port 443.
    basicSsl(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port,
    strictPort: true,
    https: true,
    // Allow LAN access via nip.io / sslip.io (needed for Twitch embed parent domains)
    allowedHosts: ['.nip.io', '.sslip.io', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
