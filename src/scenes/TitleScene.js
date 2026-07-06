// =====================================================================
//  TitleScene.js  ── タイトル画面（作品の"顔"）
//  暗い空気感＋漂う感情の光。ロゴ・涙モチーフ・テーマ一文・タップで開始。
// =====================================================================

import Phaser from "phaser";
import * as C from "../data/config.js";
import { onFirstGesture, setMuted, sfx } from "../logic/audio.js";
import { getSave, getPref } from "../data/save.js";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super("TitleScene");
  }

  create() {
    this.W = C.GAME_WIDTH;
    this.H = C.GAME_HEIGHT;
    // 明るい朝空グラデ＋陽だまり（子供向けに あかるく）
    const bgG = this.add.graphics();
    bgG.fillGradientStyle(0x7cc6ff, 0x8fd0ff, 0xffe9b8, 0xfff2cf, 1, 1, 1, 1);
    bgG.fillRect(0, 0, this.W, this.H);
    this.add.circle(this.W / 2, this.H * 0.34, 200, 0xffffff, 0.35); // 陽だまり

    // 漂う感情の光（怒/悲/勇/希の色の粒がゆっくり昇る）
    for (let i = 0; i < 22; i++) this.makeMote(true);

    // 涙のしずく
    const drop = this.add.text(this.W / 2, this.H * 0.29, "💧", { fontFamily: EMOJI_FONT, fontSize: "58px" }).setOrigin(0.5);
    this.tweens.add({ targets: drop, y: this.H * 0.29 - 8, duration: 2600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    // ロゴ
    this.add.text(this.W / 2, this.H * 0.44, "ラクリマ", { fontFamily: UI_FONT, fontSize: "46px", color: "#2e4468", fontStyle: "bold" }).setOrigin(0.5);
    this.add.text(this.W / 2, this.H * 0.44 + 40, "─ LACRYMA ─", { fontFamily: UI_FONT, fontSize: "15px", color: "#6a7a9a" }).setOrigin(0.5);

    // 明るい惹句（テーマ「感情は弱さではない」は前面に出さず、エンディングで回収する）
    this.add.text(this.W / 2, this.H * 0.55, "なこう。おころう。わくわくしよう。", { fontFamily: UI_FONT, fontSize: "16px", color: "#4a5a78" }).setOrigin(0.5);
    this.add.text(this.W / 2, this.H * 0.55 + 26, "キモチで そだつ、あいぼうモンスター。", { fontFamily: UI_FONT, fontSize: "13px", color: "#6a7a92" }).setOrigin(0.5);

    const s = getSave();
    if (s.spiritName) {
      this.add.text(this.W / 2, this.H * 0.61, `〈精霊〉 ${s.spiritName}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#b07a2a" }).setOrigin(0.5);
    }

    // 開始
    const has = s.soul.rebirths > 0 || s.soul.level > 1 || (s.bonds && s.bonds.met > 0) || s.endingSeen;
    const startT = this.add.text(this.W / 2, this.H * 0.73, has ? "▶ つづける" : "▶ はじめる", { fontFamily: UI_FONT, fontSize: "24px", color: "#1f5fa8", fontStyle: "bold" }).setOrigin(0.5);
    this.tweens.add({ targets: startT, scale: 1.08, duration: 950, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.add.text(this.W / 2, this.H * 0.73 + 34, "タップして あそぶ", { fontFamily: UI_FONT, fontSize: "12px", color: "#6a7a92" }).setOrigin(0.5);

    // 音：設定反映。タップで解錠＆ホームへ。
    setMuted(getPref("muted"));
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
    const r = 1.5 + Math.random() * 3.5;
    const m = this.add.circle(x, startY, r, color, 0.7).setDepth(1);
    const base = 9000 + Math.random() * 5000; // 画面全体を昇る時間
    const dur = (base * (startY + 20)) / (this.H + 20);
    this.tweens.add({
      targets: m,
      y: -20,
      x: x + (Math.random() - 0.5) * 70,
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
