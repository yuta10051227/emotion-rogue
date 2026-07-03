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
    this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x06060d);
    // ほのかな中央のにじみ
    this.add.circle(this.W / 2, this.H * 0.36, 220, 0x141426, 0.5);

    // 漂う感情の光（怒/悲/勇/希の色の粒がゆっくり昇る）
    for (let i = 0; i < 22; i++) this.makeMote(true);

    // 涙のしずく
    const drop = this.add.text(this.W / 2, this.H * 0.29, "💧", { fontFamily: EMOJI_FONT, fontSize: "58px" }).setOrigin(0.5);
    this.tweens.add({ targets: drop, y: this.H * 0.29 - 8, duration: 2600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    // ロゴ
    this.add.text(this.W / 2, this.H * 0.44, "ラクリマ", { fontFamily: UI_FONT, fontSize: "46px", color: "#eef0f6" }).setOrigin(0.5);
    this.add.text(this.W / 2, this.H * 0.44 + 40, "─ LACRYMA ─", { fontFamily: UI_FONT, fontSize: "15px", color: "#8a8aa6" }).setOrigin(0.5);

    // テーマ一文（通奏低音）
    this.add.text(this.W / 2, this.H * 0.55, "感情は、弱さではない。", { fontFamily: UI_FONT, fontSize: "15px", color: "#9a9ab0" }).setOrigin(0.5);

    const s = getSave();
    if (s.spiritName) {
      this.add.text(this.W / 2, this.H * 0.61, `〈感情の精霊〉 ${s.spiritName}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#ffd9a0" }).setOrigin(0.5);
    }

    // 開始
    const has = s.soul.rebirths > 0 || s.soul.level > 1 || (s.bonds && s.bonds.met > 0) || s.endingSeen;
    const startT = this.add.text(this.W / 2, this.H * 0.73, has ? "▶ つづける" : "▶ はじめる", { fontFamily: UI_FONT, fontSize: "22px", color: "#bfe0ff" }).setOrigin(0.5);
    this.tweens.add({ targets: startT, alpha: 0.35, duration: 950, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.add.text(this.W / 2, this.H * 0.73 + 34, "タップして", { fontFamily: UI_FONT, fontSize: "12px", color: "#55556e" }).setOrigin(0.5);

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
    const m = this.add.circle(x, startY, r, color, 0.45).setDepth(1);
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
