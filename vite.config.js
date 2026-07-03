import { defineConfig } from 'vite';

// Phase 0 試作用の最小設定
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    open: false,
    // 公開トンネル(cloudflared 等)経由のアクセスを許可
    allowedHosts: true,
  },
});
