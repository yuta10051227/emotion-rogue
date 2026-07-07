import { defineConfig } from 'vite';

// Phase 0 試作用の最小設定
export default defineConfig({
  base: "./", // 相対パス＝GitHub Pages(サブパス /emotion-rogue/)でもNetlify(ルート)でも動く
  build: {
    rollupOptions: {
      output: {
        // Phaser本体(≈1.4MB)を分離＝ゲームコード更新時もエンジンはキャッシュが効く
        manualChunks: { phaser: ["phaser"], supabase: ["@supabase/supabase-js"] },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    open: false,
    // 公開トンネル(cloudflared 等)経由のアクセスを許可
    allowedHosts: true,
  },
});
