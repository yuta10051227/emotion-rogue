// =====================================================================
//  TitleScene.js  ── タイトル画面（作品の"顔"）
//  静かな夜のとばり＋漂う感情の残り火。明朝体ロゴ・文学的な惹句・タップで開始。
//  対象：高校生。「捨てられた感情を拾う旅」の空気を最初の1画面で伝える。
// =====================================================================

import Phaser from "phaser";
import * as C from "../data/config.js";
import { onFirstGesture, setMuted, sfx, setMusicMood } from "../logic/audio.js";
import { getSave, getPref } from "../data/save.js";
import { ornateFrame } from "../ui/ornate.js";

const UI_FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';
const DISPLAY_FONT = '"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho",serif';

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super("TitleScene");
  }

  create() {
    this.W = C.GAME_WIDTH;
    this.H = C.GAME_HEIGHT;

    // 明るい朝の空グラデ（澄んだ青空→淡い水色）。旧: 深い夜。
    const bgG = this.add.graphics();
    bgG.fillGradientStyle(0x74b8ee, 0x74b8ee, 0xbfe4f5, 0xe8f6ff, 1, 1, 1, 1);
    bgG.fillRect(0, 0, this.W, this.H);

    // 地平線のあたたかな陽ざし
    const glow = this.add.graphics();
    glow.fillGradientStyle(0xfff2d0, 0xfff2d0, 0xe8f6ff, 0xe8f6ff, 0.0, 0.0, 0.6, 0.6);
    glow.fillRect(0, this.H * 0.6, this.W, this.H * 0.22);

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
      .text(this.W / 2, logoY, "ラクリマ", { fontFamily: DISPLAY_FONT, fontSize: "54px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5)
      .setAlpha(0.7)
      .setScale(1.08);
    const logo = this.add
      .text(this.W / 2, logoY, "ラクリマ", { fontFamily: DISPLAY_FONT, fontSize: "54px", color: "#133a66", fontStyle: "bold" })
      .setOrigin(0.5);
    const sub = this.add
      .text(this.W / 2, logoY + 46, "─  L A C R Y M A  ─", { fontFamily: UI_FONT, fontSize: "13px", color: "#3a5c82" })
      .setOrigin(0.5);

    // ロゴの登場：ふわっと弾んで現れる＋光のスイープ（"始まる"高揚）
    [logo, logoGlow, sub].forEach((t) => t.setAlpha(0));
    this.tweens.add({ targets: logo, scale: { from: 0.72, to: 1 }, alpha: { from: 0, to: 1 }, duration: 640, ease: "Back.easeOut" });
    this.tweens.add({ targets: logoGlow, scale: { from: 0.78, to: 1.08 }, alpha: { from: 0, to: 0.7 }, duration: 640, ease: "Back.easeOut" });
    this.tweens.add({ targets: sub, alpha: { from: 0, to: 1 }, duration: 500, delay: 460 });
    const shine = this.add.rectangle(this.W / 2 - 150, logoY, 34, 92, 0xffffff, 0.6).setAngle(16).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(3);
    this.time.delayedCall(640, () => this.tweens.add({ targets: shine, x: this.W / 2 + 150, alpha: { from: 0.6, to: 0 }, duration: 620, ease: "Sine.easeOut", onComplete: () => shine.destroy() }));

    // 惹句（テーマの入口だけ見せる。核心「感情は弱さではない」はエンディングで回収）
    const t1 = this.add
      .text(this.W / 2, this.H * 0.50, "捨てられた感情を、拾いにいく。", { fontFamily: DISPLAY_FONT, fontSize: "17px", color: "#22496e" })
      .setOrigin(0.5);
    const t2 = this.add
      .text(this.W / 2, this.H * 0.50 + 30, "涙は、やがて光になる。", { fontFamily: DISPLAY_FONT, fontSize: "13px", color: "#456486" })
      .setOrigin(0.5);
    // 遊びの約束（＝ワクワクの核。集める・育てる・進化のフック）
    const hook = this.add
      .text(this.W / 2, this.H * 0.50 + 62, "気持ちの魔物を 集めて、育てて、進化させよう。", { fontFamily: UI_FONT, fontSize: "13px", color: "#1c5a8a", fontStyle: "bold" })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: hook, alpha: 1, y: this.H * 0.50 + 58, duration: 600, delay: 780, ease: "Sine.easeOut" });

    const s = getSave();
    if (s.spiritName) {
      this.add.text(this.W / 2, this.H * 0.585, `〈精霊〉 ${s.spiritName}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#c9a86a" }).setOrigin(0.5);
    }

    // 開始：押したくなる 金枠のCTAボタン（緑=GO）。鼓動でふくらむ＝「さあ、行こう」。
    const has = s.soul.rebirths > 0 || s.soul.level > 1 || (s.bonds && s.bonds.met > 0) || s.endingSeen;
    const btnY = this.H * 0.72;
    const bw = 230, bh = 62;
    const btn = this.add.container(this.W / 2, btnY).setDepth(4);
    const bgfx = this.add.graphics();
    bgfx.fillStyle(0x1e7a40, 0.97); // 明るい緑=はじめる
    bgfx.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    ornateFrame(bgfx, 0, 0, bw, bh, 12, { thick: 3, corners: true, cornerArm: 15 });
    const startT = this.add.text(0, 0, has ? "▶ つづきから" : "▶ 旅をはじめる", { fontFamily: DISPLAY_FONT, fontSize: "23px", color: "#fff8e0", fontStyle: "bold" }).setOrigin(0.5);
    btn.add([bgfx, startT]);
    btn.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: btn, scale: 1, alpha: 1, duration: 520, delay: 900, ease: "Back.easeOut", onComplete: () => {
      this.tweens.add({ targets: btn, scaleX: 1.045, scaleY: 1.045, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); // 鼓動
    } });
    // 好奇心フック：初見は「何があるんだろう」、続きは自分の記録で"更新したい"を煽る
    let teaser = "どこまで行ける？ どんな姿に進化する？";
    if (has) {
      const best = Math.floor(s.soul.bestDistance || 0);
      const met = (s.bonds && s.bonds.met) || 0;
      teaser = `最高 ${best}m ・ 出会った気持ち ${met}体 ・ 魂Lv.${s.soul.level}`;
    }
    this.add.text(this.W / 2, btnY + 52, teaser, { fontFamily: UI_FONT, fontSize: "12px", color: "#3f6488" }).setOrigin(0.5).setDepth(4);

    // 四隅にほんのり陽の陰り（明るい空を保つため、ごく淡く上下だけ）
    const vig = this.add.graphics().setDepth(5);
    vig.fillGradientStyle(0x9fd0f0, 0x9fd0f0, 0x9fd0f0, 0x9fd0f0, 0.35, 0.35, 0, 0);
    vig.fillRect(0, 0, this.W, 90);
    vig.fillGradientStyle(0xbfe0c0, 0xbfe0c0, 0xbfe0c0, 0xbfe0c0, 0, 0, 0.3, 0.3);
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
