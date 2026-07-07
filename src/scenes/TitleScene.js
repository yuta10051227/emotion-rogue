// =====================================================================
//  TitleScene.js  ── タイトル画面（作品の"顔"）
//  静かな夜のとばり＋漂う感情の残り火。明朝体ロゴ・文学的な惹句・タップで開始。
//  対象：高校生。「捨てられた感情を拾う旅」の空気を最初の1画面で伝える。
// =====================================================================

import Phaser from "phaser";
import * as C from "../data/config.js";
import { onFirstGesture, setMuted, sfx, setMusicMood } from "../logic/audio.js";
import { getSave, getPref } from "../data/save.js";

const UI_FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';
const DISPLAY_FONT = '"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho",serif';

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super("TitleScene");
  }

  create() {
    this.W = C.GAME_WIDTH;
    this.H = C.GAME_HEIGHT;

    // 深い夜のグラデ（黒藍→群青）。感情の色は「差し色」としてだけ灯す
    const bgG = this.add.graphics();
    bgG.fillGradientStyle(0x05050c, 0x05050c, 0x0d1226, 0x101a33, 1, 1, 1, 1);
    bgG.fillRect(0, 0, this.W, this.H);

    // 地平線にわずかな残光（夜明け前の気配）
    const glow = this.add.graphics();
    glow.fillGradientStyle(0x1a2a4a, 0x1a2a4a, 0x05050c, 0x05050c, 0.0, 0.0, 0.55, 0.55);
    glow.fillRect(0, this.H * 0.62, this.W, this.H * 0.2);

    // 漂う感情の残り火（怒/悲/勇/希の色が静かに昇る）
    for (let i = 0; i < 26; i++) this.makeMote(true);

    // 涙のしずく（Graphicsで描く淡い光滴。絵文字は使わない）
    const drop = this.add.container(this.W / 2, this.H * 0.235);
    const halo = this.add.circle(0, 0, 34, 0x4d9fff, 0.10);
    const halo2 = this.add.circle(0, 0, 18, 0x9fcfff, 0.14);
    const tear = this.add.graphics();
    tear.fillStyle(0xbfe0ff, 0.9);
    tear.fillCircle(0, 6, 9);
    tear.fillTriangle(-8, 4, 8, 4, 0, -16);
    tear.fillStyle(0xffffff, 0.85);
    tear.fillCircle(-3, 3, 2.4); // ハイライト
    drop.add([halo, halo2, tear]);
    this.tweens.add({ targets: drop, y: this.H * 0.235 - 10, duration: 3200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: [halo, halo2], alpha: 0.5, duration: 2400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    // ロゴ（明朝体。背後に淡い発光の重ね文字）
    const logoY = this.H * 0.36;
    const logoGlow = this.add
      .text(this.W / 2, logoY, "ラクリマ", { fontFamily: DISPLAY_FONT, fontSize: "54px", color: "#7aa8ff", fontStyle: "bold" })
      .setOrigin(0.5)
      .setAlpha(0.22)
      .setScale(1.04);
    const logo = this.add
      .text(this.W / 2, logoY, "ラクリマ", { fontFamily: DISPLAY_FONT, fontSize: "54px", color: "#e8ecf8", fontStyle: "bold" })
      .setOrigin(0.5);
    const sub = this.add
      .text(this.W / 2, logoY + 46, "─  L A C R Y M A  ─", { fontFamily: UI_FONT, fontSize: "13px", color: "#6a7a9a" })
      .setOrigin(0.5);

    // 惹句（テーマの入口だけ見せる。核心「感情は弱さではない」はエンディングで回収）
    const t1 = this.add
      .text(this.W / 2, this.H * 0.50, "捨てられた感情を、拾いにいく。", { fontFamily: DISPLAY_FONT, fontSize: "17px", color: "#b8c4dc" })
      .setOrigin(0.5);
    const t2 = this.add
      .text(this.W / 2, this.H * 0.50 + 30, "涙は、やがて光になる。", { fontFamily: DISPLAY_FONT, fontSize: "13px", color: "#66748e" })
      .setOrigin(0.5);

    const s = getSave();
    if (s.spiritName) {
      this.add.text(this.W / 2, this.H * 0.585, `〈精霊〉 ${s.spiritName}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#c9a86a" }).setOrigin(0.5);
    }

    // 開始（静かな明滅。騒がしくしない）
    const has = s.soul.rebirths > 0 || s.soul.level > 1 || (s.bonds && s.bonds.met > 0) || s.endingSeen;
    const startT = this.add
      .text(this.W / 2, this.H * 0.72, has ? "つづきから" : "旅をはじめる", { fontFamily: DISPLAY_FONT, fontSize: "22px", color: "#dfe6f4" })
      .setOrigin(0.5);
    const startRule = this.add.rectangle(this.W / 2, this.H * 0.72 + 22, 150, 1, 0x4a5878, 0.8);
    this.tweens.add({ targets: [startT, startRule], alpha: 0.45, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.add.text(this.W / 2, this.H * 0.72 + 40, "画面にふれてください", { fontFamily: UI_FONT, fontSize: "11px", color: "#5a6478" }).setOrigin(0.5);

    // 四隅を落とすビネット（安価な矩形グラデで空気を締める）
    const vig = this.add.graphics().setDepth(5);
    vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.55, 0.55, 0, 0);
    vig.fillRect(0, 0, this.W, 90);
    vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.6, 0.6);
    vig.fillRect(0, this.H - 110, this.W, 110);

    // Webフォント読込後に明朝体テキストを再描画（読込前はローカル明朝でフォールバック）
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!this.scene || !this.scene.isActive("TitleScene")) return;
        [logoGlow, logo, sub, t1, t2, startT].forEach((t) => t && t.active && t.updateText());
      });
    }

    // 音：設定反映。タップで解錠＆ホームへ。
    setMuted(getPref("muted"));
    setMusicMood("title");
    this.input.once("pointerdown", () => {
      onFirstGesture();
      sfx.tap();
      this.cameras.main.fadeOut(420, 0, 0, 0);
      this.time.delayedCall(420, () => this.scene.start("HomeScene"));
    });
  }

  makeMote(initial) {
    const key = C.EMOTION_ORDER[Math.floor(Math.random() * C.EMOTION_ORDER.length)];
    const color = C.EMOTIONS[key].color;
    const x = Math.random() * this.W;
    const startY = initial ? Math.random() * this.H : this.H + 20;
    const r = 1.2 + Math.random() * 3.2;
    const m = this.add.circle(x, startY, r, color, 0.5).setDepth(1);
    const base = 11000 + Math.random() * 6000; // 画面全体を昇る時間（夜は ゆっくり流れる）
    const dur = (base * (startY + 20)) / (this.H + 20);
    this.tweens.add({
      targets: m,
      y: -20,
      x: x + (Math.random() - 0.5) * 60,
      alpha: 0,
      duration: dur,
      ease: "Sine.easeIn",
      onComplete: () => {
        m.destroy();
        this.makeMote(false);
      },
    });
  }
}
