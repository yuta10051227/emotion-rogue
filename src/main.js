import Phaser from "phaser";
import { GAME_WIDTH, GAME_HEIGHT } from "./data/config.js";
import { persist } from "./data/save.js";
import { cloudConfigured, getUser, startCloudAutosync, syncOnLogin } from "./data/cloud.js";
import TitleScene from "./scenes/TitleScene.js";
import HomeScene from "./scenes/HomeScene.js";
import GameScene from "./scenes/GameScene.js";

// 起動時：ログイン済みなら、クラウドの進行を取り込む（別端末で続きから）。
async function bootstrapCloud() {
  if (!cloudConfigured()) return;
  const user = await getUser();
  if (!user) return;
  const r = await syncOnLogin();
  startCloudAutosync(); // 和解が終わってから autosync を張る（未和解の空端末がクラウドを上書きしない）
  // クラウドの方が新しければ、取り込んだセーブで全画面を作り直す
  if (r.action === "downloaded") window.location.reload();
}
bootstrapCloud();

// タブを閉じる/バックグラウンドに回る直前に確実に保存（取りこぼし防止）
window.addEventListener("pagehide", () => persist());
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});

const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#dff1ff", // 明るい空色（旧: 真っ黒 #0a0a0f）
  // 素材は「塗り絵調（アンチエイリアス前提）」で pixelArt ではない。
  // pixelArt:true（最近傍・AA無効）だと縮小表示で輪郭がギザつき画質が落ちていた。
  // → AAを有効化し、ミップマップで縮小をなめらかに。高DPI端末では実解像度でレンダ。
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: false,
    pixelArt: false,
    mipmapFilter: "LINEAR_MIPMAP_LINEAR",
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    zoom: Math.min(2, Math.max(1, Math.floor(window.devicePixelRatio || 1))), // Retina等で内部解像度を上げてくっきり
  },
  // 起動は TitleScene → HomeScene（拠点）→ GameScene（進軍）。
  scene: [TitleScene, HomeScene, GameScene],
};

window.game = new Phaser.Game(config); // デバッグ用にグローバル参照を残す
