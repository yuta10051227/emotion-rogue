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
  startCloudAutosync();
  const r = await syncOnLogin();
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
  backgroundColor: "#0a0a0f",
  pixelArt: true, // ドット絵をくっきり表示（アンチエイリアス無効・整数丸め）
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // 起動は TitleScene → HomeScene（拠点）→ GameScene（進軍）。
  scene: [TitleScene, HomeScene, GameScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
