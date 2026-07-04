// =====================================================================
//  GameScene.js  ── 進軍シーン（自動戦闘）
//  ホームから[出発]で開始。倒れる/撤退すると転生してホームへ戻る。
//  魂レベル・装備・記憶の共鳴を反映して旅立つ（設計書§6/§9）。
// =====================================================================

import Phaser from "phaser";
import * as C from "../data/config.js";
import { createBattle, stepBattle, forceFinish } from "../logic/combat.js";
import { createEmotionState, gainEmotions, checkEvolution, leadingEmotion, secondEmotion } from "../logic/evolution.js";
import { makeCompanion, voiceStage, pickVoiceLine } from "../logic/companion.js";
import { sfx, onFirstGesture, setMuted } from "../logic/audio.js";
import { getSave, computeHeroStats, transmigrate, rollEquipmentDrop, addMaterials, fragMultipliers, effectiveEvoThreshold, recordBond, getActiveCompanions, commitRunCompanions, getPref, setPref, getArtifactBonuses, useItem, itemCount, empathyUnlocked, markEndingSeen, skillParams, bossReward, setSpiritName, recordForm } from "../data/save.js";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';

function colorToCss(n) {
  return "#" + n.toString(16).padStart(6, "0");
}

export default class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  create() {
    this.W = C.GAME_WIDTH;
    this.H = C.GAME_HEIGHT;

    // --- 今回の旅の状態 ---
    this.distance = 0;
    this.coins = 0;
    this.kills = 0;
    this.despair = 0; // 旅で瀕死を耐えた回数（闇堕ち判定）
    this.heroSkillCharge = 0; // 技ゲージ
    this.nextEncounter = this.encounterGap();
    // 固定距離ボス（DR④）
    this.bossCount = 0;
    this.nextBoss = C.BOSS.everyMeters;
    this.bossWarned = false;
    // 群れ（複数の敵）
    this.enemyQueue = [];
    this.queueSprites = [];
    this.emotions = createEmotionState();
    this.evolved = false;
    this.evolvedKey = null;
    this.evoStage = 0; // 0スライム→1獣→2戦士→3化身（多段進化）
    this.evoSpecial = false; // 混合/三重/闇堕ちに進んだら以降は段階進化しない（特別形態は終点）
    this.mode = "walk";
    this.battle = null;
    this.currentEnemy = null;
    this._leaving = false;
    this.logLines = [];

    // 仲間（救った感情）。同行＝魂の絆で持ち越した子＋旅で新たに出会う子。
    this.companionSprites = {};
    this.nextCompanionId = 1;
    this.partyY = 556;
    this.careBtn = null; // 感情ケアの一時ボタン
    // 出撃に同行する仲間をロード（ランタイムIDを採番。bondedId で永続記録と紐づく）
    this.companions = getActiveCompanions().map((b) => ({
      ...b,
      bondedId: b.id,
      id: this.nextCompanionId++,
      gauge: 0,
      joinedAt: 0,
    }));

    // 魂レベル＋装備＋導く心ツリーを反映した「今回の旅の素体」
    const stats = computeHeroStats();
    this.heroBase = { maxHp: stats.maxHp, atk: stats.atk, spd: stats.spd };
    this.resonanceKey = stats.resonanceKey; // 記憶の共鳴（多く抱いた感情）
    this.baseFragMult = fragMultipliers(); // ツリーの欠片獲得ボーナス
    this.evoThreshold = effectiveEvoThreshold(); // ツリーで下がりうる進化閾値（1段目）
    this.evoThresholds = [this.evoThreshold, this.evoThreshold + 14, this.evoThreshold + 34]; // 獣/戦士/化身（進化を遅めに）
    this.skill = skillParams(); // 技：発動間隔・威力（ツリーで育つ）

    // 消耗アイテム：出撃で1本ずつ消費する旅バフ＋倒れた時の蘇生（不死鳥の羽）
    this.itemAtkPct = itemCount("power") > 0 ? 0.3 : 0;
    this.itemHpPct = itemCount("guard") > 0 ? 0.3 : 0;
    if (this.itemAtkPct) useItem("power", 1);
    if (this.itemHpPct) useItem("guard", 1);
    this.reviveItems = itemCount("phoenix"); // 倒れた時に1個ずつ砕ける

    // 使い切り層（倒れたら1から）：コイン強化レベル＋進化倍率。素体に重ねて確定。
    this.runUp = { atk: 0, hp: 0, spd: 0, frag: 0 };
    this.evoMult = 1;
    this.heroStats = null;
    this.applyRunUpgrades(); // → this.heroStats / this.fragMult を確定

    // 見守る速度・おまかせ強化（設定を引き継ぐ）／進行可視化・ポーズ状態
    this.speed = getPref("speed") || 1;
    this.autoInvest = !!getPref("autoInvest");
    this.savedBest = getSave().soul.bestDistance;
    this.coinBonus = getArtifactBonuses().coin; // 結晶のコイン%（DR④）
    this.lastMilestone = 0;
    this.bestMarked = false;
    this.paused = false;
    this.upPanel = null;

    this.buildBackground();
    this.buildParallax();
    this.buildHud();
    this.buildGauges();
    this.buildArena();
    this.buildLog();
    this.buildControls();
    this.buildParty();

    // 音：ミュート設定を反映し、初回操作で解錠
    setMuted(getPref("muted"));
    this.input.once("pointerdown", onFirstGesture);
    this.input.keyboard.once("keydown", onFirstGesture);

    const s = getSave();
    const reso = this.resonanceKey ? `／ ${C.EMOTIONS[this.resonanceKey].icon}の記憶が共鳴` : "";
    this.pushLog(`旅立った。（魂Lv.${s.soul.level} ${reso}）`);
  }

  encounterGap() {
    return C.COMBAT.distancePerEncounter + Phaser.Math.Between(-2, 6);
  }

  // ============================ 使い切りコイン強化（倒れたら1から）============================
  // 素体（heroBase）に「コイン強化レベル」と「進化倍率」を重ねて heroStats を確定する。
  applyRunUpgrades() {
    const U = {};
    for (const it of C.UPGRADES.items) U[it.key] = it;
    const maxHp = Math.round(this.heroBase.maxHp * (1 + U.hp.per * this.runUp.hp) * this.evoMult * (1 + (this.itemHpPct || 0)));
    const atk = Math.round(this.heroBase.atk * (1 + U.atk.per * this.runUp.atk) * this.evoMult * (1 + (this.itemAtkPct || 0)));
    const spd = this.heroBase.spd + U.spd.per * this.runUp.spd;
    if (!this.heroStats) {
      this.heroStats = { hp: maxHp, maxHp, atk, spd };
    } else {
      const grew = Math.max(0, maxHp - this.heroStats.maxHp);
      this.heroStats.maxHp = maxHp;
      this.heroStats.atk = atk;
      this.heroStats.spd = spd;
      this.heroStats.hp = Math.min(maxHp, this.heroStats.hp + grew); // 守り強化は今のHPも底上げ
    }
    // 欠片獲得倍率＝ツリー由来 ＋ コイン強化「欠片」
    const fragBonus = U.frag.per * this.runUp.frag;
    this.fragMult = {};
    for (const k of C.EMOTION_ORDER) this.fragMult[k] = this.baseFragMult[k] + fragBonus;
  }

  upgradeCost(key) {
    const it = C.UPGRADES.items.find((u) => u.key === key);
    return Math.round(it.baseCost * Math.pow(C.UPGRADES.costGrowth, this.runUp[key]));
  }

  buyUpgrade(key) {
    const cost = this.upgradeCost(key);
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.runUp[key] += 1;
    this.applyRunUpgrades();
    this.refreshCoinUi();
    return true;
  }

  // おまかせ：買える中で最も安い強化を、買えなくなるまで自動投資（見守るだけでも育つ）
  autoInvestSpend() {
    let bought = true;
    while (bought) {
      bought = false;
      let cheapest = null;
      let min = Infinity;
      for (const it of C.UPGRADES.items) {
        const c = this.upgradeCost(it.key);
        if (c <= this.coins && c < min) {
          min = c;
          cheapest = it.key;
        }
      }
      if (cheapest) bought = this.buyUpgrade(cheapest);
    }
  }

  refreshCoinUi() {
    if (this.coinText) this.coinText.setText("💰 " + this.coins);
    if (this.upgradeBtn) this.upgradeBtn.txt.setText(`⚙ 強化 💰${this.coins}`);
  }

  // ---- 強化パネル（戦闘画面内オーバーレイ。開いている間は世界をポーズ）----
  openUpgradePanel() {
    if (this.upPanel || this.mode === "dead" || this.mode === "evolve" || this.mode === "epilogue" || this._leaving) return;
    this.dismissCare();
    this.paused = true;
    if (this.battleTimer) this.battleTimer.paused = true;
    this.upPanel = this.add.container(0, 0).setDepth(210);
    this.buildUpgradePanel();
  }

  closeUpgradePanel() {
    if (!this.upPanel) return;
    this.upPanel.destroy(true);
    this.upPanel = null;
    this.paused = false;
    if (this.battleTimer && this.mode === "battle" && this.battle && !this.battle.finished) this.battleTimer.paused = false;
  }

  buildUpgradePanel() {
    const c = this.upPanel;
    c.removeAll(true);
    const cx = this.W / 2;
    const cy = this.H / 2;
    const bg = this.add.rectangle(cx, cy, this.W, this.H, 0x05050c, 0.92).setInteractive();
    const card = this.add.rectangle(cx, cy, this.W - 30, 430, 0x12121c).setStrokeStyle(1, 0x33334a);
    c.add([bg, card]);
    c.add(this.add.text(cx, cy - 192, "強化（この旅だけ・倒れたら1から）", { fontFamily: UI_FONT, fontSize: "18px", color: "#e8e8ef" }).setOrigin(0.5));
    c.add(this.add.text(cx, cy - 164, `💰 ${this.coins}`, { fontFamily: UI_FONT, fontSize: "20px", color: "#ffd24d" }).setOrigin(0.5));

    let y = cy - 120;
    for (const it of C.UPGRADES.items) {
      const lv = this.runUp[it.key];
      const cost = this.upgradeCost(it.key);
      const can = this.coins >= cost;
      const bonus = it.kind === "pct" ? `+${Math.round(it.per * lv * 100)}%` : `+${it.per * lv}`;
      const row = this.add.rectangle(cx, y, this.W - 60, 54, 0x191926).setStrokeStyle(1, 0x33334a);
      const icon = this.add.text(54, y, it.icon, { fontFamily: EMOJI_FONT, fontSize: "22px" }).setOrigin(0.5);
      const nm = this.add.text(80, y - 10, `${it.label}　Lv${lv}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#e8e8ef" }).setOrigin(0, 0.5);
      const ds = this.add.text(80, y + 11, `現在 ${bonus}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#9a9aac" }).setOrigin(0, 0.5);
      const btn = this.add.rectangle(this.W - 86, y, 96, 38, can ? 0x2a3a2a : 0x202028).setStrokeStyle(1, can ? 0x4caf50 : 0x33334a).setInteractive({ useHandCursor: can });
      const bt = this.add.text(this.W - 86, y, `💰${cost}`, { fontFamily: UI_FONT, fontSize: "14px", color: can ? "#bfffbf" : "#777" }).setOrigin(0.5);
      if (can) {
        btn.on("pointerdown", () => {
          if (this.buyUpgrade(it.key)) this.buildUpgradePanel();
        });
      }
      c.add([row, icon, nm, ds, btn, bt]);
      y += 62;
    }

    // おまかせ（自動投資）トグル
    const tg = this.add.rectangle(cx, cy + 142, this.W - 60, 38, this.autoInvest ? 0x1c2c1c : 0x191926).setStrokeStyle(1, this.autoInvest ? 0x4caf50 : 0x33334a).setInteractive({ useHandCursor: true });
    const tgt = this.add.text(cx, cy + 142, this.autoInvest ? "おまかせ強化：ON（自動で投資・見守るだけでOK）" : "おまかせ強化：OFF（自分で配分する）", { fontFamily: UI_FONT, fontSize: "13px", color: this.autoInvest ? "#bfffbf" : "#cfcfe0" }).setOrigin(0.5);
    tg.on("pointerdown", () => {
      this.autoInvest = !this.autoInvest;
      setPref("autoInvest", this.autoInvest);
      if (this.autoInvest) this.autoInvestSpend();
      this.buildUpgradePanel();
    });
    c.add([tg, tgt]);

    const close = this.add.rectangle(cx, cy + 188, 160, 40, 0x1c1c2a).setStrokeStyle(1, 0x4a4a66).setInteractive({ useHandCursor: true });
    const ct = this.add.text(cx, cy + 188, "閉じる", { fontFamily: UI_FONT, fontSize: "16px", color: "#e8e8ef" }).setOrigin(0.5);
    close.on("pointerdown", () => this.closeUpgradePanel());
    c.add([close, ct]);
  }

  // ============================ build ============================
  buildBackground() {
    this.bgRect = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x0a0a0f).setDepth(-12);
    this.edgeFlash = this.add
      .rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xffffff)
      .setDepth(50)
      .setFillStyle(0xffffff, 0);
  }

  // 手続き生成テクスチャ（アセット無しで"ローグウィズ的"な横スクロール進軍を作る）
  makeTex(key, w, h, draw) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ add: false });
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  buildParallax() {
    // 遠景：闇に沈む丘（周期100で seamless）
    this.makeTex("far_hills", 300, 130, (g) => {
      g.fillStyle(0x12182a, 1);
      [50, 150, 250].forEach((x) => g.fillCircle(x, 130, 72));
    });
    // 中景：木立／廃墟のシルエット（周期80）
    this.makeTex("mid_trees", 240, 150, (g) => {
      g.fillStyle(0x0b0f1a, 1);
      [40, 120, 200].forEach((x) => {
        g.fillTriangle(x - 24, 150, x + 24, 150, x, 64);
        g.fillRect(x - 4, 118, 8, 32);
      });
    });
    // 地面：道（横線＋周期16のダッシュで seamless）
    this.makeTex("ground_strip", 64, 120, (g) => {
      g.fillStyle(0x14141e, 1);
      g.fillRect(0, 0, 64, 120);
      g.fillStyle(0x1d1d2c, 1);
      g.fillRect(0, 0, 64, 5);
      g.fillStyle(0x0d0d15, 1);
      [8, 24, 40, 56].forEach((x) => g.fillRect(x, 34, 6, 3));
      [16, 48].forEach((x) => g.fillRect(x, 72, 4, 3));
    });

    const horizon = this.heroY - 16;
    this.farLayer = this.add.tileSprite(this.W / 2, horizon, this.W, 130, "far_hills").setOrigin(0.5, 1).setDepth(-9).setAlpha(0.85);
    this.midLayer = this.add.tileSprite(this.W / 2, this.heroY + 32, this.W, 150, "mid_trees").setOrigin(0.5, 1).setDepth(-7).setAlpha(0.92);
    this.groundLayer = this.add.tileSprite(this.W / 2, this.heroY + 62, this.W, 250, "ground_strip").setOrigin(0.5, 0).setDepth(-5);

    // ピクセル遠景があれば採用。空グラデを画面上部まで敷き、バイオームで切替。
    if (this.textures.exists("bg_far")) {
      this.skyG = this.add.graphics().setDepth(-11); // 空（上まで背景を反映）
      this.farLayer.setTexture("bg_far");
      this.farLayer.height = 144; // タイル高と一致＝縦リピートしない
      this.farLayer.y = horizon + 30;
      this.farLayer.setAlpha(1);
      this.midLayer.setVisible(false);
      // バイオーム（距離で移り変わる世界観）。遠景tex＋空の色。
      this.biomes = [
        { tex: "bg_far", top: 0x0a1024, bot: 0x14141f, name: "山鳴りの道" },
        { tex: "bg_far1", top: 0x0a1a12, bot: 0x0f1a16, name: "囁きの森" },
        { tex: "bg_far2", top: 0x241708, bot: 0x1a1410, name: "忘れられた廃墟" },
        { tex: "bg_far3", top: 0x1a1030, bot: 0x140f24, name: "幽玄の境" },
      ].filter((b) => this.textures.exists(b.tex));
      this.curBiome = -1;
      this.setBiome(0);
    }
  }

  // バイオーム切替：空グラデを塗り替え、遠景tex を差し替える
  setBiome(i) {
    if (!this.biomes || !this.biomes.length) return;
    const idx = i % this.biomes.length;
    if (idx === this.curBiome) return;
    this.curBiome = idx;
    const b = this.biomes[idx];
    if (this.skyG) {
      this.skyG.clear();
      this.skyG.fillGradientStyle(b.top, b.top, b.bot, b.bot, 1, 1, 1, 1);
      this.skyG.fillRect(0, 0, this.W, this.H);
    }
    if (this.farLayer && this.textures.exists(b.tex)) this.farLayer.setTexture(b.tex);
  }

  // 進軍に合わせて各層を流す（奥ほどゆっくり＝奥行き）
  scrollWorld(d) {
    if (this.farLayer) this.farLayer.tilePositionX += d * 0.15;
    if (this.midLayer) this.midLayer.tilePositionX += d * 0.4;
    if (this.groundLayer) this.groundLayer.tilePositionX += d * 1.0;
  }

  buildHud() {
    // 上部HUDフレーム（情報ゾーン：DRの2ゾーン指針）
    this.add.rectangle(this.W / 2, 54, this.W, 108, 0x080812, 0.5).setDepth(-1);
    this.add.rectangle(this.W / 2, 108, this.W, 1, 0x2a2a42).setDepth(-1);

    this.distanceText = this.add.text(18, 12, "距離 0m", { fontFamily: UI_FONT, fontSize: "20px", color: "#e8e8ef" });
    this.coinText = this.add.text(this.W - 18, 12, "💰 0", { fontFamily: UI_FONT, fontSize: "20px", color: "#ffd24d" }).setOrigin(1, 0);

    // 次の節目までの進捗バー（旗に向かって進軍する）
    const bw = this.W - 44;
    this._progW = bw;
    this._progX = this.W / 2 - bw / 2;
    this.add.rectangle(this.W / 2, 44, bw, 7, 0x1a1a28).setStrokeStyle(1, 0x2e2e46);
    this.progFill = this.add.rectangle(this._progX, 44, 2, 7, 0x6a8fd0).setOrigin(0, 0.5);
    this.progFlag = this.add.text(this._progX + bw + 2, 44, "🚩", { fontFamily: EMOJI_FONT, fontSize: "14px" }).setOrigin(0, 0.5);
    this.progLabel = this.add.text(this.W / 2, 44, "", { fontFamily: UI_FONT, fontSize: "10px", color: "#9aa0c0" }).setOrigin(0.5);
    // 目標バナー（今いる"道"の名＋次のボスまで＝没入・世界観）
    this.objectiveBanner = this.add.text(this.W / 2, 80, "", { fontFamily: UI_FONT, fontSize: "13px", color: "#d8cfc0" }).setOrigin(0.5);
  }

  updateProgressBar() {
    if (!this.progFill) return;
    const m = C.PROGRESS.milestoneEvery;
    const ratio = (this.distance % m) / m;
    this.progFill.width = Math.max(2, this._progW * ratio);
    this.progLabel.setText(`次 ${(Math.floor(this.distance / m) + 1) * m}m`);
  }

  buildGauges() {
    this.gauges = {};
    const keys = C.EMOTION_ORDER;
    const colW = this.W / keys.length;
    const y = 78;
    keys.forEach((key, i) => {
      const cx = colW * i + colW / 2;
      const info = C.EMOTIONS[key];
      const icon = this.add.text(cx - 10, y, info.icon, { fontFamily: EMOJI_FONT, fontSize: "26px" }).setOrigin(0.5);
      const count = this.add.text(cx + 18, y, "0", { fontFamily: UI_FONT, fontSize: "18px", color: "#cfcfe0" }).setOrigin(0, 0.5);
      this.add.rectangle(cx, y + 24, 56, 6, 0x2a2a3a).setOrigin(0.5);
      const bar = this.add.rectangle(cx - 28, y + 24, 1, 6, info.color).setOrigin(0, 0.5);
      this.gauges[key] = { icon, count, bar };
    });
  }

  preload() {
    // 仲間・ボス・主人公進化アート（Gemini生成）。無ければ絵文字にフォールバック。
    if (!this.textures.exists("bg_far")) this.load.image("bg_far", "chars/bg_far.png"); // ピクセル遠景
    for (let i = 1; i <= 3; i++) if (!this.textures.exists("bg_far" + i)) this.load.image("bg_far" + i, "chars/bg_far" + i + ".png"); // バイオーム
    if (!this.textures.exists("hero_slime")) this.load.image("hero_slime", "chars/hero_slime.png");
    if (!this.textures.exists("hero_slime_atk")) this.load.image("hero_slime_atk", "chars/hero_slime_atk.png");
    if (!this.textures.exists("hero_slime_walk")) this.load.image("hero_slime_walk", "chars/hero_slime_walk.png");
    for (const k of C.EMOTION_ORDER) {
      if (!this.textures.exists("char_" + k)) this.load.image("char_" + k, "chars/comp_" + k + ".png");
      if (!this.textures.exists("char_" + k + "_atk")) this.load.image("char_" + k + "_atk", "chars/comp_" + k + "_atk.png"); // 攻撃フレーム
      if (!this.textures.exists("enemy_" + k)) this.load.image("enemy_" + k, "chars/enemy_" + k + ".png"); // 雑魚敵
      if (!this.textures.exists("boss_" + k)) this.load.image("boss_" + k, "chars/boss_" + k + ".png");
      if (!this.textures.exists("boss_" + k + "_atk")) this.load.image("boss_" + k + "_atk", "chars/boss_" + k + "_atk.png");
      for (let s = 1; s <= 3; s++) {
        const key = "hero_" + k + "_" + s;
        if (!this.textures.exists(key)) this.load.image(key, "chars/" + key + ".png");
        if (!this.textures.exists(key + "_atk")) this.load.image(key + "_atk", "chars/" + key + "_atk.png");
        if (!this.textures.exists(key + "_walk")) this.load.image(key + "_walk", "chars/" + key + "_walk.png");
      }
    }
  }

  // 進化段階ごとの主人公表示サイズ（段が上がるほど大きく）
  heroFitFor(stage) {
    if (!this.heroIsImage) return 1;
    return (58 + (stage || 0) * 9) / (this.heroBaseW || 384);
  }

  buildArena() {
    this.heroX = 120;
    this.heroY = 430;
    this.enemyX = 330;
    this.enemyY = 430;

    this.add.rectangle(this.W / 2, this.heroY + 62, this.W, 2, 0x20202c);

    // 感情オーラ（①可視化：主人公が"今いちばん宿している感情の色"に染まる）
    this.heroAura = this.add.circle(this.heroX, this.heroY, 46, 0xffffff, 0).setDepth(1);

    // 接地シャドウ（浮遊感を解消）＋スピリットボディ（絵文字の背後の発光体＝存在感）
    this.heroShadow = this.add.ellipse(this.heroX, this.heroY + 44, 82, 20, 0x000000, 0.3).setDepth(0);
    this.heroBody = this.add.circle(this.heroX, this.heroY, 30, 0xffffff, 0.1).setDepth(1);
    this.enemyShadow = this.add.ellipse(this.enemyX, this.enemyY + 40, 70, 18, 0x000000, 0.28).setDepth(0).setVisible(false);
    this.enemyBody = this.add.circle(this.enemyX, this.enemyY, 26, 0xff4d4d, 0.1).setDepth(1).setVisible(false);
    // ボスのアート（大きく登場）。enemySprite の位置/フェードをミラーする。
    this.enemyImg = this.textures.exists("boss_anger") ? this.add.image(this.enemyX, this.enemyY, "boss_anger").setDepth(2).setVisible(false) : null;
    this.enemyImgActive = false;
    this.enemyImgFit = 0.3;

    // 主人公：進化アートがあれば画像（段で姿とサイズが変わる）、無ければ絵文字。
    if (this.textures.exists("hero_slime")) {
      this.heroSprite = this.add.image(this.heroX, this.heroY, "hero_slime").setDepth(2);
      this.heroIsImage = true;
      this.heroBaseW = this.heroSprite.width;
      this.heroFit = this.heroFitFor(0);
      this.heroSprite.setScale(this.heroFit);
      this.heroFormKey = "hero_slime";
    } else {
      this.heroSprite = this.add.text(this.heroX, this.heroY, "🟢", { fontFamily: EMOJI_FONT, fontSize: "64px" }).setOrigin(0.5).setDepth(2);
      this.heroIsImage = false;
      this.heroFit = 1;
      this.heroFormKey = null;
    }
    this.enemySprite = this.add.text(this.enemyX, this.enemyY, "", { fontFamily: EMOJI_FONT, fontSize: "56px" }).setOrigin(0.5).setDepth(2).setVisible(false);
    this.enemyLabel = this.add.text(this.enemyX, this.enemyY - 50, "", { fontFamily: UI_FONT, fontSize: "13px", color: "#9a9aac" }).setOrigin(0.5).setDepth(2).setVisible(false);

    this.addAtmosphere(); // 周縁ビネット
    this.time.addEvent({ delay: 130, loop: true, callback: () => this.emitEmotionParticle() }); // 感情の専用パーティクル

    this.heroHpG = this.add.graphics();
    this.enemyHpG = this.add.graphics();
    this.skillG = this.add.graphics(); // 技ゲージ
    // ボス用の大型HPバー（上部）
    this.bossHpG = this.add.graphics().setDepth(5);
    this.bossNameT = this.add.text(this.W / 2, 124, "", { fontFamily: UI_FONT, fontSize: "15px", color: "#ffd24d" }).setOrigin(0.5).setDepth(5).setVisible(false);
  }

  // 周縁を落とすビネット（背景の隅を暗くして"作品感"を出す。UI/キャラより奥＝可読性は保つ）
  addAtmosphere() {
    const c = 0x05050c;
    const g = this.add.graphics().setDepth(-1);
    const w = 96;
    const h = 96;
    g.fillGradientStyle(c, c, c, c, 0.55, 0.55, 0, 0);
    g.fillRect(0, 0, this.W, h); // 上
    g.fillGradientStyle(c, c, c, c, 0, 0, 0.65, 0.65);
    g.fillRect(0, this.H - h, this.W, h); // 下
    g.fillGradientStyle(c, c, c, c, 0.45, 0, 0.45, 0);
    g.fillRect(0, 0, w, this.H); // 左
    g.fillGradientStyle(c, c, c, c, 0, 0.45, 0, 0.45);
    g.fillRect(this.W - w, 0, w, this.H); // 右
  }

  // 毎フレーム、シャドウ／ボディを絵文字に追従させ、ゆっくり呼吸させる
  updatePresence(time) {
    const breath = 1 + Math.sin(time / 340) * 0.06;
    if (this.heroBody) {
      this.heroBody.setPosition(this.heroSprite.x, this.heroSprite.y).setScale(breath);
      this.heroShadow.setPosition(this.heroSprite.x, this.heroY + 44).setScale(1 / breath, 1);
    }
    if (this.enemyBody) {
      const v = this.enemySprite.visible;
      const bossA = this.enemyImgActive; // アート表示中か
      const aura = this.enemyImgAura || 1.5;
      const lift = this.enemyImgLift || 6;
      this.enemyBody.setVisible(v);
      this.enemyShadow.setVisible(v);
      if (v) {
        const col = (this.currentEnemy && C.EMOTIONS[this.currentEnemy.lean] && C.EMOTIONS[this.currentEnemy.lean].color) || 0xff4d4d;
        this.enemyBody.setPosition(this.enemySprite.x, this.enemySprite.y - (bossA ? lift * 0.8 : 0)).setFillStyle(col, (this.enemyImgBoss ? 0.26 : bossA ? 0.14 : 0.12) * this.enemySprite.alpha).setScale(breath * 0.98 * (bossA ? aura : 1));
        this.enemyShadow.setPosition(this.enemySprite.x, this.enemyY + 44).setAlpha(0.28 * this.enemySprite.alpha).setScale(bossA ? Math.max(1.15, aura * 0.5) : 1, 1);
      }
      if (this.enemyImg && bossA) {
        this.enemyImg.setVisible(v);
        if (v) {
          this.enemyImg
            .setPosition(this.enemySprite.x, this.enemySprite.y - lift + Math.sin(time / 520) * (this.enemyImgBoss ? 4 : 2))
            .setAlpha(this.enemySprite.alpha)
            .setScale(this.enemyImgFit * (1 + Math.sin(time / 520) * 0.03));
        }
      } else if (this.enemyImg) {
        this.enemyImg.setVisible(false);
      }
    }
    for (const comp of this.companions) {
      const o = this.companionSprites[comp.id];
      if (!o || !o.body) continue;
      o.body.setPosition(o.spr.x, o.spr.y).setScale(0.85 * breath);
      o.shadow.setPosition(o.spr.x, o.baseY != null ? o.baseY + 22 : o.spr.y + 22);
    }
  }

  // 主感情の"専用パーティクル"を主人公の周りに（怒＝火の粉/悲＝雫/勇＝風/希＝きらめき）
  emitEmotionParticle() {
    if (this.paused || this.speed >= 3 || (this.mode !== "walk" && this.mode !== "battle")) return; // 3倍速は粒を止めて軽く
    const lead = leadingEmotion(this.emotions);
    if (!lead.key || lead.value <= 0) return;
    const info = C.EMOTIONS[lead.key];
    const hx = this.heroSprite.x;
    const hy = this.heroSprite.y;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const p = this.add.circle(hx, hy, 2 + Math.random() * 2.4, info.color, 0.85).setDepth(3);
    if (lead.key === "anger") {
      p.setPosition(hx + rnd(-16, 16), hy + 18);
      this.tweens.add({ targets: p, y: hy - rnd(24, 46), x: p.x + rnd(-10, 10), alpha: 0, scale: 0.3, duration: rnd(650, 1000), ease: "Sine.easeOut", onComplete: () => p.destroy() });
    } else if (lead.key === "sadness") {
      p.setPosition(hx + rnd(-18, 18), hy - 22);
      this.tweens.add({ targets: p, y: hy + rnd(30, 40), alpha: 0, duration: rnd(1100, 1500), ease: "Sine.easeIn", onComplete: () => p.destroy() });
    } else if (lead.key === "courage") {
      p.setPosition(hx - 6, hy + rnd(-16, 10));
      this.tweens.add({ targets: p, x: hx + rnd(38, 60), alpha: 0, scaleX: 2.4, duration: rnd(360, 540), ease: "Quad.easeOut", onComplete: () => p.destroy() });
    } else {
      p.setPosition(hx + rnd(-20, 20), hy + rnd(-6, 16));
      this.tweens.add({ targets: p, y: p.y - rnd(22, 42), alpha: 0, scale: 1.7, duration: rnd(800, 1200), ease: "Sine.easeOut", onComplete: () => p.destroy() });
    }
  }

  buildLog() {
    this.add.text(this.W / 2, 606, "─ 旅のしるし ─", { fontFamily: UI_FONT, fontSize: "13px", color: "#55556a" }).setOrigin(0.5);
    this.logText = this.add
      .text(this.W / 2, 628, "", {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: "#b8b8c8",
        align: "center",
        lineSpacing: 7,
        wordWrap: { width: this.W - 40 },
      })
      .setOrigin(0.5, 0);
  }

  // ---- 下部操作バー（親指圏：倍速／強化／撤退。DRの2ゾーン指針）----
  buildControls() {
    this.input.keyboard.on("keydown-H", () => this.retreatToHome());

    const barY = 752;
    this.add.rectangle(this.W / 2, barY, this.W, 64, 0x101018).setStrokeStyle(1, 0x23233a);

    // 倍速セグメント（"見守る速度"の操作。命令ではない）
    this.add.text(14, barY - 22, "速さ", { fontFamily: UI_FONT, fontSize: "11px", color: "#6a6a80" }).setOrigin(0, 0.5);
    this.speedBtns = [];
    C.SPEED_STEPS.forEach((mult, i) => {
      const x = 30 + i * 36;
      const rect = this.add.rectangle(x, barY + 4, 32, 34, 0x1c1c2a).setStrokeStyle(1, 0x3a3a52).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, barY + 4, "×" + mult, { fontFamily: UI_FONT, fontSize: "14px", color: "#cfcfe0" }).setOrigin(0.5);
      rect.on("pointerdown", () => this.setSpeed(mult));
      this.speedBtns.push({ mult, rect, txt });
    });

    // 強化（コインで使い切り強化。おまかせもここ）
    this.upgradeBtn = this.makeBarButton(this.W / 2 + 18, barY, 150, 46, `⚙ 強化 💰${this.coins}`, () => this.openUpgradePanel(), {
      color: 0x2a2438,
      stroke: 0x7a5aa0,
      textColor: "#e6c2ff",
    });

    // 撤退（引き際の判断＝プレイヤーの裁量）
    this.makeBarButton(this.W - 56, barY, 92, 46, "↗ 撤退", () => this.retreatToHome(), {
      color: 0x2e2018,
      stroke: 0xa06a4a,
      textColor: "#ffcaa0",
    });

    this.refreshSpeedBtns();
  }

  makeBarButton(x, y, w, h, label, onClick, opts = {}) {
    const rect = this.add.rectangle(x, y, w, h, opts.color ?? 0x1c1c2a).setStrokeStyle(1, opts.stroke ?? 0x3a3a52).setInteractive({ useHandCursor: true });
    const txt = this.add.text(x, y, label, { fontFamily: UI_FONT, fontSize: opts.fontSize ?? "15px", color: opts.textColor ?? "#e8e8ef" }).setOrigin(0.5);
    rect.on("pointerdown", () => {
      this.tweens.add({ targets: [rect, txt], scale: 0.95, duration: 60, yoyo: true });
      onClick();
    });
    return { rect, txt };
  }

  setSpeed(mult) {
    this.speed = mult;
    setPref("speed", mult);
    this.refreshSpeedBtns();
    // 戦闘中なら、進行中のテンポに即反映（見せ場＝進化は別タイマーで速度非依存）
    if (this.mode === "battle" && this.battle && !this.battle.finished && !this.paused) this.startBattleTimer();
  }

  refreshSpeedBtns() {
    if (!this.speedBtns) return;
    for (const b of this.speedBtns) {
      const on = b.mult === this.speed;
      b.rect.setFillStyle(on ? 0x2a3a2a : 0x1c1c2a).setStrokeStyle(1, on ? 0x4caf50 : 0x3a3a52);
      b.txt.setColor(on ? "#bfffbf" : "#cfcfe0");
    }
  }

  startBattleTimer() {
    if (this.battleTimer) this.battleTimer.remove();
    const base = C.COMBAT.turnIntervalMs / this.speed;
    const delay = base * (0.8 + Math.random() * 0.4); // ±20%のゆらぎ＝メトロノーム感を崩す
    this.battleTimer = this.time.delayedCall(delay, () => {
      this.battleTick();
      if (this.mode === "battle" && this.battle && !this.battle.finished && !this.paused) this.startBattleTimer();
    });
  }

  // ============================ update loop ============================
  update(time, delta) {
    if (this.paused) return; // 強化パネル等を開いている間は世界を止める
    if (this.mode === "walk") {
      const dt = delta / 1000;
      const adv = C.COMBAT.walkSpeed * dt * this.speed; // 倍速は歩行にも効く
      this.distance += adv;
      this.scrollWorld(adv * 6); // 背景を流して"行軍してる感"を出す
      this.distanceText.setText("距離 " + Math.floor(this.distance) + "m");
      this.updateProgressBar();
      if (this.biomes && this.biomes.length) this.setBiome(Math.floor(this.distance / 260) % this.biomes.length); // 距離でバイオーム
      if (this.objectiveBanner) {
        const bn = this.biomes && this.biomes[this.curBiome] ? this.biomes[this.curBiome].name : "";
        this.objectiveBanner.setText(`― ${bn} ―　⚔ 次のボスまで ${Math.max(0, Math.ceil(this.nextBoss - this.distance))}m`);
      }

      this.heroSprite.y = this.heroY + (Math.floor(time / 260) % 2 === 0 ? 0 : -4); // 2コマの跳ね
      // 進軍中は歩行フレームと交互に（歩いてる感）
      if (this.heroIsImage && this.heroFormKey && this.textures.exists(this.heroFormKey + "_walk")) {
        const wkey = Math.floor(time / 220) % 2 === 0 ? this.heroFormKey : this.heroFormKey + "_walk";
        if (this.heroSprite.texture.key !== wkey) this.heroSprite.setTexture(wkey);
      }
      this.heroAura.y = this.heroSprite.y;
      this.bobCompanions(time);
      this.updatePresence(time);
      this.drawHpBars();
      this.checkProgress();
      // ボス接近の予兆
      if (!this.bossWarned && this.distance >= this.nextBoss - C.BOSS.warnDistance) {
        this.triggerBossWarning();
      }
      // ボスは通常エンカウントに優先
      if (this.distance >= this.nextBoss) this.startBattle({ boss: true });
      else if (this.distance >= this.nextEncounter) this.startBattle();
    } else if (this.mode === "battle") {
      // 交戦中も世界はゆっくり進む＝行軍してる感（距離は増やさない・見た目だけ）
      this.scrollWorld(C.COMBAT.walkSpeed * (delta / 1000) * 0.25 * this.speed);
      this.heroSprite.y = this.heroY + (Math.floor(time / 360) % 2 === 0 ? 0 : -3); // 戦闘中も2コマ待機
      this.bobCompanions(time);
      this.updatePresence(time);
    }
  }

  // ボス接近の警告（DR④：見えるドラマ）
  triggerBossWarning() {
    this.bossWarned = true;
    const emotion = C.EMOTION_ORDER[this.bossCount % C.EMOTION_ORDER.length];
    const t = C.BOSS.types[emotion];
    const info = C.EMOTIONS[emotion];
    sfx.bossWarn();
    this.cameras.main.shake(700, 0.008);

    // 画面が感情色に沈む（重い気配）
    const veil = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, info.color, 0).setDepth(58);
    this.tweens.add({ targets: veil, fillAlpha: 0.2, duration: 320, yoyo: true, hold: 260, ease: "Sine.easeInOut", onComplete: () => veil.destroy() });
    this.edgeFlash.setFillStyle(info.color, 0);
    this.tweens.add({ targets: this.edgeFlash, fillAlpha: 0.36, duration: 240, yoyo: true, repeat: 2 });

    // 中央に「気配 → 名の顕現」
    const cx = this.W / 2;
    const cy = this.H / 2 - 30;
    const omen = this.add.text(cx, cy, "── 強大な気配 ──", { fontFamily: UI_FONT, fontSize: "18px", color: colorToCss(info.color) }).setOrigin(0.5).setDepth(59).setAlpha(0);
    const nameT = this.add.text(cx, cy + 34, `${t.icon} ${t.name}`, { fontFamily: UI_FONT, fontSize: "28px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(59).setAlpha(0).setScale(1.35);
    this.tweens.add({ targets: [omen, nameT], alpha: 1, duration: 260 });
    this.tweens.add({ targets: nameT, scale: 1, duration: 460, ease: "Back.easeOut" });
    // 名の周りに感情色の粒が集う
    for (let i = 0; i < 14; i++) {
      const ang = (Math.PI * 2 * i) / 14;
      const p = this.add.circle(cx + Math.cos(ang) * 120, cy + 34 + Math.sin(ang) * 70, 3, info.color, 0.9).setDepth(59);
      this.tweens.add({ targets: p, x: cx, y: cy + 34, alpha: 0, duration: 520, ease: "Sine.easeIn", onComplete: () => p.destroy() });
    }
    this.time.delayedCall(1500, () => {
      this.tweens.add({ targets: [omen, nameT], alpha: 0, duration: 420, onComplete: () => { omen.destroy(); nameT.destroy(); } });
    });

    this.pushLog(`⚠ ${t.icon} ${t.name} が 近づいている…`);
  }

  // 進行の可視化：節目・最高到達ライン・深度の色（DR：この先に何かある感）
  checkProgress() {
    const m = Math.floor(this.distance / C.PROGRESS.milestoneEvery);
    if (m > this.lastMilestone) {
      this.lastMilestone = m;
      this.pushLog(`── ${m * C.PROGRESS.milestoneEvery}m ──`);
      this.flashWhite(0.1);
      this.depthTint();
    }
    if (!this.bestMarked && this.savedBest > 0 && this.distance > this.savedBest) {
      this.bestMarked = true;
      this.pushLog("★ これまでの最高到達を越えた");
      this.distanceText.setColor("#ffd24d");
      this.flashWhite(0.18);
    }
  }

  flashWhite(a) {
    this.edgeFlash.setFillStyle(0xffffff, 0);
    this.tweens.add({ targets: this.edgeFlash, fillAlpha: a, duration: 120, yoyo: true });
  }

  depthTint() {
    const t = Math.min(1, this.distance / 1500);
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    const r = lerp(0x0a, 0x18);
    const g = lerp(0x0a, 0x0c);
    const b = lerp(0x0f, 0x1e);
    this.bgRect.setFillStyle((r << 16) | (g << 8) | b);
  }

  // ============================ battle ============================
  rollGroupSize() {
    if (!C.COMBAT.swarmEnabled) return 1; // 群れは一旦オフ（1体ずつ）
    const r = Math.random();
    if (r < 0.45) return 1;
    if (r < 0.85) return 2;
    return 3;
  }

  startBattle(opts = {}) {
    this.dismissCare();
    this.mode = "battle";
    this.heroSkillCharge = 0;
    this.heroSprite.y = this.heroY;
    if (this.heroIsImage && this.heroFormKey && this.heroSprite.texture.key !== this.heroFormKey) this.heroSprite.setTexture(this.heroFormKey); // 歩行→待機に戻す
    this.heroStats.hp = this.heroStats.maxHp; // 接敵の最初だけ全回復（群れの間はHP持ち越し＝圧）

    // 群れ編成（ボスは単体）。先頭と控え（右に並ぶ）。
    const groupSize = opts.boss ? 1 : this.rollGroupSize();
    const front = opts.boss ? this.makeBoss(this.distance) : this.makeEnemy(this.distance);
    this.enemyQueue = [];
    for (let i = 1; i < groupSize; i++) this.enemyQueue.push(this.makeEnemy(this.distance));
    this.spawnQueueSilhouettes();
    this.engageEnemy(front);
  }

  // 1体と交戦開始（先頭/次の敵が右から歩いて来て、到着で戦闘開始）。HPは持ち越し。
  engageEnemy(enemy) {
    this.currentEnemy = enemy;
    this.battleTicks = 0;
    this.battle = createBattle(this.heroStats, enemy, this.companions, { skillEvery: this.skill.every, skillMult: this.skill.mult });

    const scale = enemy.boss ? 1.5 : 1;
    this.enemySprite.setText(enemy.icon).setVisible(true).setScale(scale).setAlpha(1);
    this.enemySprite.x = this.W + 60;
    this.enemyLabel.setText(enemy.boss ? `― ${enemy.label} ―` : enemy.label).setVisible(true).setAlpha(1).setColor(enemy.boss ? "#ffd24d" : "#9a9aac");
    this.enemyLabel.x = this.W + 60;

    // 敵アート（ボス=大きく／雑魚=小さく色変異）。位置/フェードは enemySprite が駆動。
    const artKey = enemy.boss ? "boss_" + enemy.lean : "enemy_" + enemy.lean;
    if (!this.enemyImg && this.textures.exists(artKey)) this.enemyImg = this.add.image(this.enemyX, this.enemyY, artKey).setDepth(2).setVisible(false); // 保険で遅延生成
    const hasArt = this.enemyImg && this.textures.exists(artKey);
    if (hasArt) {
      this.enemyImg.setTexture(artKey).setVisible(true).setAlpha(1).setDepth(2).setFlipX(false).setTint(enemy.tint || 0xffffff); // 反転しない（元絵が主人公向き）
      const px = enemy.boss ? enemy.bossPx || 300 : Math.round(92 * (enemy.mobScale || 1)); // ボスは段階的サイズ／雑魚は個体差
      this.enemyImgFit = px / (this.enemyImg.width || 256);
      this.enemyImg.setScale(this.enemyImgFit);
      this.enemyImgActive = true;
      this.enemyImgBoss = !!enemy.boss;
      this.enemyImgLift = enemy.boss ? Math.round(px * 0.2) : 6; // 大きいほど持ち上げる
      this.enemyImgAura = enemy.boss ? px / 66 : 1.6; // オーラ倍率もサイズ比例
      this.enemySprite.setText(""); // 絵文字は隠す
      this.enemyLabel.setVisible(!enemy.boss); // 雑魚は名前、ボスは上部の大型HPバー
    } else {
      this.enemyImgActive = false;
      this.enemyImgBoss = false;
      if (this.enemyImg) this.enemyImg.setVisible(false);
    }
    this.drawHpBars();

    this.tweens.add({
      targets: [this.enemySprite, this.enemyLabel],
      x: this.enemyX,
      duration: 420,
      ease: "Sine.easeOut",
      onComplete: () => {
        if (this.mode !== "battle" || this.currentEnemy !== enemy) return;
        if (enemy.boss) this.tweens.add({ targets: this.enemySprite, scale: scale * 1.08, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        this.startBattleTimer();
      },
    });
  }

  // 群れの決着後：控えが居れば次へ（HP持ち越し）、居なければ戦闘終了。
  afterBattleResolved() {
    if (this.enemyQueue && this.enemyQueue.length > 0) {
      const next = this.enemyQueue.shift();
      this.removeQueueSilhouette();
      this.engageEnemy(next);
    } else {
      this.endBattle();
    }
  }

  // 控えの敵を右に薄く並べる（群れが見える）
  spawnQueueSilhouettes() {
    this.clearQueueSilhouettes();
    this.queueSprites = [];
    (this.enemyQueue || []).forEach((e, i) => {
      const x = this.W - 26 - i * 30;
      const s = this.add.text(x, this.enemyY, e.icon, { fontFamily: EMOJI_FONT, fontSize: "34px" }).setOrigin(0.5).setAlpha(0.33).setScale(0.8);
      this.tweens.add({ targets: s, y: this.enemyY - 4, duration: 620 + i * 90, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.queueSprites.push(s);
    });
  }

  removeQueueSilhouette() {
    if (this.queueSprites && this.queueSprites.length) {
      const s = this.queueSprites.shift();
      this.tweens.killTweensOf(s);
      s.destroy();
    }
  }

  clearQueueSilhouettes() {
    if (this.queueSprites) for (const s of this.queueSprites) {
      this.tweens.killTweensOf(s);
      s.destroy();
    }
    this.queueSprites = [];
  }

  makeEnemy(distance) {
    const factor = Math.pow(C.ENEMY_BASE.growth, distance / 10);
    const type = Phaser.Utils.Array.GetRandom(C.ENEMY_TYPES);
    const hp = Math.round(C.ENEMY_BASE.hp * factor * type.hpMod);
    const atk = Math.max(1, Math.round(C.ENEMY_BASE.atk * factor * type.atkMod));
    const rawSpd = Phaser.Math.Between(C.ENEMY_BASE.spdMin, C.ENEMY_BASE.spdMax) * type.spdMod;
    // 個体差：色変異（パレットスワップ）＋サイズ変異で"違うキャラ"感を出す
    const TINTS = {
      anger: [0xffffff, 0xffffff, 0xff8a5a, 0xd070ff, 0xffbe40],
      sadness: [0xffffff, 0xffffff, 0x66c8ff, 0x86ffe0, 0xa088ff],
      courage: [0xffffff, 0xffffff, 0xfff090, 0x9aff80, 0xffc866],
      hope: [0xffffff, 0xffffff, 0xffe0a0, 0xc0e0ff, 0xffc0e0],
    };
    const pal = TINTS[type.key] || [0xffffff];
    const tint = Phaser.Utils.Array.GetRandom(pal);
    const mobScale = 0.82 + Math.random() * 0.42; // 大きさもバラつかせる
    return { hp, maxHp: hp, atk, spd: Math.max(1, Math.round(rawSpd)), icon: type.icon, label: type.label, lean: type.key, tint, mobScale };
  }

  // 固定距離ボス：強敵。感情系統は順に巡る（戦い方の多様性を促す）。
  makeBoss(distance) {
    const factor = Math.pow(C.ENEMY_BASE.growth, distance / 10);
    const emotion = C.EMOTION_ORDER[this.bossCount % C.EMOTION_ORDER.length];
    const t = C.BOSS.types[emotion];
    // 距離ベースHP と 「主人公攻撃力×最低撃破回数」の大きい方 → 強い育成でも即溶けしない
    const distHp = C.ENEMY_BASE.hp * factor * C.BOSS.hpMult;
    const powerHp = (this.heroStats ? this.heroStats.atk : 20) * (C.BOSS.minHitsToKill || 30);
    const hp = Math.round(Math.max(distHp, powerHp));
    const atk = Math.max(1, Math.round(C.ENEMY_BASE.atk * factor * C.BOSS.atkMult));
    const spd = Math.max(1, Math.round(((C.ENEMY_BASE.spdMin + C.ENEMY_BASE.spdMax) / 2) * C.BOSS.spdMult));
    // 序盤ボスは控えめ→深部で大きく（最初がラスボス級すぎ問題）
    const n = this.bossCount;
    const bossPx = Math.round(196 + Math.min(n, 9) * 20); // boss0=196 … boss9+=376
    // 同じ種でも雰囲気が変わる色変異（控えめ）
    const TINTS = {
      anger: [0xffffff, 0xffffff, 0xff9a6a, 0xff7070, 0xd070d0],
      sadness: [0xffffff, 0xffffff, 0x8ad0ff, 0x9aa0ff, 0x70e0d0],
      courage: [0xffffff, 0xffffff, 0xfff0a0, 0xffd070, 0xd0ff90],
      hope: [0xffffff, 0xffffff, 0xffe0c0, 0xd0e0ff, 0xffd0e0],
    };
    const tint = Phaser.Utils.Array.GetRandom(TINTS[emotion] || [0xffffff]);
    this.bossCount += 1;
    return { hp, maxHp: hp, atk, spd, icon: t.icon, label: t.name, lean: emotion, boss: true, bossPx, tint };
  }

  battleTick() {
    try {
      this._battleTick();
    } catch (e) {
      // 何かが落ちても戦闘がフリーズしないよう、安全に決着させる
      console.error("battleTick error", e);
      if (this.battleTimer) this.battleTimer.remove();
      this.currentEnemy = null;
      this.endBattle();
    }
  }

  _battleTick() {
    // 長期化した戦闘は強制決着（フリーズ防止の安全網）
    this.battleTicks = (this.battleTicks || 0) + 1;
    if (!this.battle.finished && this.battleTicks > C.COMBAT.maxBattleTicks) forceFinish(this.battle);

    const events = stepBattle(this.battle);
    for (const ev of events) {
      if (ev.heal) {
        // 仲間（癒し）が主人公を回復＝後衛からの癒しの波
        this.popDamage(this.heroX, this.heroY - 38, "+" + ev.heal, "#7fff9f");
        const ally = this.companions.find((c) => c.id === ev.allyId);
        if (ally) this.playCompanionSkill(ally, true);
        this.pulseCompanion(ev.allyId);
      } else if (ev.target === "enemy") {
        const ratio = this.currentEnemy ? ev.dmg / this.currentEnemy.maxHp : 0;
        if (ev.by === "ally") {
          // 仲間の技（役割別の演出）
          const ally = this.companions.find((c) => c.id === ev.allyId);
          if (ally) this.playCompanionSkill(ally, false);
          this.pulseCompanion(ev.allyId);
          this.popDamage(this.enemyX, this.enemyY - 38, ev.dmg, "#bfe0ff", ratio);
          this.knockback(this.enemySprite, this.enemyX, 1, Phaser.Math.Clamp(ratio, 0.2, 1));
          sfx.hit();
        } else if (ev.skill) {
          // 主人公の必殺技（大きく踏み込む）
          this.lunge(this.heroSprite, this.heroX, 1, 110);
          this.heroAttackAnim();
          this.playHeroSkill(ev.dmg);
          this.heroSkillCharge = 0;
        } else {
          // 主人公の通常攻撃（踏み込んでクラッシュ＋技ゲージが溜まる）
          this.lunge(this.heroSprite, this.heroX, 1, 78);
          this.heroAttackAnim();
          this.popDamage(this.enemyX, this.enemyY - 38, ev.dmg, "#ff9a9a", ratio);
          this.knockback(this.enemySprite, this.enemyX, 1, Phaser.Math.Clamp(ratio, 0.2, 1));
          sfx.hit();
          this.heroSkillCharge = Math.min(this.skill.every, this.heroSkillCharge + 1);
        }
      } else {
        // 敵の攻撃：敵が主人公へ踏み込む
        const ratio = ev.dmg / this.heroStats.maxHp;
        this.lunge(this.enemySprite, this.enemyX, -1, 78);
        this.bossAttackAnim();
        this.popDamage(this.heroX, this.heroY - 38, ev.dmg, "#ffffff", ratio);
        this.knockback(this.heroSprite, this.heroX, -1, Phaser.Math.Clamp(ratio, 0.2, 1));
        sfx.heroHit();
      }
    }
    this.drawHpBars();
    if (this.battle.finished) {
      this.battleTimer.remove();
      this.time.delayedCall(280, this.resolveBattle, [], this);
    }
  }

  resolveBattle() {
    try {
      this._resolveBattle();
    } catch (e) {
      console.error("resolveBattle error", e);
      this.currentEnemy = null;
      this.endBattle();
    }
  }

  _resolveBattle() {
    if (this.battle.win) {
      this.enemyLabel.setVisible(false);
      this.tweens.killTweensOf(this.enemySprite); // ボスの鼓動など残演出を止める
      const isBoss = !!(this.currentEnemy && this.currentEnemy.boss);
      if (isBoss) sfx.bossDown();
      else sfx.defeat();

      // ごく稀に、倒した敵（＝捨てられた感情）が浄化されて仲間になる（ボスは対象外・設計書§17）
      const joinEmotion = this.currentEnemy ? this.currentEnemy.lean : null;
      const willJoin =
        joinEmotion && !isBoss && this.companions.length < C.COMPANION.maxParty && Math.random() < C.COMPANION.joinChance;
      if (willJoin) {
        this.purifyEnemyToCompanion(joinEmotion);
      } else {
        // 撃破：吹き飛びながら消える
        this.tweens.add({
          targets: this.enemySprite,
          alpha: 0,
          scale: 0.5,
          x: this.enemyX + 44,
          duration: 260,
          ease: "Quad.easeIn",
          onComplete: () => this.enemySprite.setVisible(false).setScale(1).setAlpha(1).setX(this.enemyX),
        });
      }

      let reward = Math.round((3 + Math.floor(this.distance / 10)) * (1 + this.coinBonus / 100));
      if (isBoss) {
        reward *= C.BOSS.rewardMult;
        // 撃破：大演出＋次のボスへ
        this.flashWhite(0.3);
        this.cameras.main.shake(260, 0.008);
        this.pushLog(`★ ${this.currentEnemy.label} を 打ち倒した！`);
        // 確定で素材（その感情）を授かる
        const bonus = Array(C.BOSS.materialBonus).fill(this.currentEnemy.lean);
        addMaterials(bonus);
        // レア報酬：レア以上の装備＋感情の結晶を確定で
        const rw = bossReward(this.distance, this.currentEnemy.lean);
        this.pushLog(`🎁 ${rw.equip.name}〈${rw.rar.label}〉と 💎結晶 を授かった`);
        // ボスは強い仲間として迎え入れる（深部ボスほど高レア確定）
        const floor = this.bossCount >= C.COMPANION.bossFloorDeepFrom ? C.COMPANION.bossRarityFloorDeep : C.COMPANION.bossRarityFloor;
        this.time.delayedCall(420, () => this.spawnRecruit(joinEmotion, { minRarity: floor, big: true }));
        this.nextBoss += C.BOSS.everyMeters;
        this.bossWarned = false;
      }
      this.coins += reward;
      this.kills += 1;
      if (this.battle.minHpRatio < 0.12) this.despair += 1; // 瀕死を耐えた＝絶望の蓄積
      if (this.autoInvest) this.autoInvestSpend(); // おまかせ：見守るだけでも育つ
      this.refreshCoinUi();

      const firstKey = this.battle.emotions[0];
      gainEmotions(this.emotions, this.battle.emotions, {
        resonanceKey: this.resonanceKey,
        resonanceBonus: C.SOUL.resonanceBonus,
        fragMult: this.fragMult,
      });
      this.updateGauges();
      this.absorbLight(firstKey);
      this.flashEdge(firstKey);
      sfx.frag(C.EMOTION_ORDER.indexOf(firstKey));
      if (this.coins > 0) sfx.coin();
      this.pushLog(this.emotionLogLine(this.battle));

      // 素材＋装備ドロップ（ホームの制作・装備につながる）
      addMaterials(this.battle.emotions);
      const drop = rollEquipmentDrop(this.distance);
      if (drop) {
        const rar = C.EQUIPMENT.rarities.find((r) => r.key === drop.rarity);
        this.pushLog(`🎁 装備「${drop.name}〈${rar.label}〉」を拾った`);
      }

      this.advanceCompanionVoices(); // 同行で「声」が育つ（設計書§17-2）

      const evoForm = this.nextEvolutionForm(); // 多段進化：次の段階へ進めるか
      if (evoForm) {
        this.time.delayedCall(500, () => this.doEvolution(evoForm));
      } else {
        this.afterBattleResolved(); // 群れに控えが居れば次へ、居なければ終了
      }
    } else {
      this.onDeath();
    }
  }

  endBattle() {
    this.clearQueueSilhouettes();
    this.enemyQueue = [];
    this.enemySprite.setVisible(false);
    this.enemyLabel.setVisible(false);
    this.currentEnemy = null;
    this.heroStats.hp = this.heroStats.maxHp;
    this.drawHpBars();
    this.mode = "walk";
    this.nextEncounter = this.distance + this.encounterGap();
    this.maybeTriggerCare();
    // 進軍：倒して前へ。背景を一気に流し、主人公が一歩踏み出す。
    this.scrollWorld(140);
    this.tweens.add({
      targets: this.heroSprite,
      x: this.heroX + 26,
      duration: 170,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.heroSprite.x = this.heroX;
      },
    });
  }

  // ---- 感情のケア（DR：溢れる前にそっと受け止める。任意・見守るだけでもOK）----
  maybeTriggerCare() {
    if (this.careBtn || this.evolved && Math.random() < 0.5) return; // 進化後は控えめ
    if (Math.random() >= C.CARE.chance) return;
    const lead = leadingEmotion(this.emotions);
    if (!lead.key || lead.value <= 0) return;
    this.triggerCare(lead.key);
  }

  triggerCare(key) {
    const info = C.EMOTIONS[key];
    const y0 = this.heroY - 98;
    const cont = this.add.container(this.heroX, y0).setDepth(45).setAlpha(0);
    const bg = this.add.rectangle(0, 0, 124, 40, 0x101018, 0.94).setStrokeStyle(1, info.color).setInteractive({ useHandCursor: true });
    const ic = this.add.text(-46, 0, info.icon, { fontFamily: EMOJI_FONT, fontSize: "20px" }).setOrigin(0.5);
    const tx = this.add.text(10, 0, "受け止める", { fontFamily: UI_FONT, fontSize: "14px", color: "#e8e8ef" }).setOrigin(0.5);
    cont.add([bg, ic, tx]);
    this.tweens.add({ targets: cont, alpha: 1, y: y0 - 8, duration: 250 });
    this.carePulse = this.tweens.add({ targets: cont, scale: 1.08, duration: 480, yoyo: true, repeat: -1 });
    bg.on("pointerdown", () => this.applyCare(key));
    this.careBtn = cont;
    this.careTimer = this.time.delayedCall(C.CARE.windowMs, () => {
      if (this.careBtn) {
        this.pushLog("溢れる感情は、そっと ながれていった");
        this.dismissCare();
      }
    });
  }

  applyCare(key) {
    const info = C.EMOTIONS[key];
    this.emotions[key] += C.CARE.bonusFrag;
    this.updateGauges();
    this.heroStats.hp = this.heroStats.maxHp;
    this.drawHpBars();
    this.popDamage(this.heroX, this.heroY - 40, "🫶", "#ffd9e6");
    this.flashEdge(key);
    sfx.care();
    this.pushLog(`🫶 溢れる ${info.icon}${info.label} を 受け止めた … 力になった`);
    this.dismissCare();
  }

  dismissCare() {
    if (this.carePulse) {
      this.carePulse.stop();
      this.carePulse = null;
    }
    if (this.careTimer) {
      this.careTimer.remove();
      this.careTimer = null;
    }
    if (this.careBtn) {
      this.careBtn.destroy(true);
      this.careBtn = null;
    }
  }

  emotionLogLine(b) {
    const k = b.emotions[0];
    const info = C.EMOTIONS[k];
    const flavor =
      {
        anger: "一気に押し切った",
        sadness: "傷つきながら 耐えて勝った",
        courage: "先んじて 倒しきった",
        hope: "瀕死から 立て直した",
      }[k] || "勝った";
    let line = `${flavor} … ${info.icon}${info.label}の欠片を得た`;
    if (b.emotions.length > 1) {
      const extra = b.emotions.slice(1).map((e) => C.EMOTIONS[e].icon).join("");
      line += `（＋${extra}）`;
    }
    return line;
  }

  // 感情の拮抗具合で進化の姿を決める：三重混合 / 闇堕ち / 二重混合 / 単一(null)
  resolveMix() {
    const ranked = C.EMOTION_ORDER.map((k) => ({ key: k, value: this.emotions[k] })).sort((a, b) => b.value - a.value);
    const lead = ranked[0].value;
    if (lead <= 0) return null;
    const ratio = C.MIXED_EVOLUTION.ratio;
    const second = ranked[1];
    const third = ranked[2];
    const fourth = ranked[3];

    // 三重混合：上位3つが拮抗 → 欠けた1感情(最下位)で姿が決まる
    if (third.value > 0 && third.value >= lead * ratio) {
      const form = C.TRIPLE_EVOLUTION.forms[fourth.key];
      return form ? { ...form, kind: "triple" } : null;
    }
    // 二重混合：2位が拮抗
    if (second.value > 0 && second.value >= lead * ratio) {
      const pair = [ranked[0].key, second.key].sort((a, b) => C.EMOTION_ORDER.indexOf(a) - C.EMOTION_ORDER.indexOf(b)).join("+");
      // 絶望が深ければ混合が闇に堕ちる
      if (this.despair >= C.DARK_EVOLUTION.despairThreshold && C.DARK_EVOLUTION.forms[pair]) {
        return { ...C.DARK_EVOLUTION.forms[pair], kind: "dark" };
      }
      const form = C.MIXED_EVOLUTION.forms[pair];
      return form ? { ...form, kind: "double" } : null;
    }
    return null;
  }

  // 次に進化できる形態を返す（無ければ null）。単一は3段、混合/三重/闇堕ちは初進化の特別ルート。
  nextEvolutionForm() {
    if (this.evoSpecial) return null; // 特別形態は終点
    const nextStage = this.evoStage + 1;
    if (nextStage > 3) return null;
    if (nextStage === 1) {
      const lead = leadingEmotion(this.emotions);
      if (!lead.key || lead.value < this.evoThresholds[0]) return null;
      const mix = this.resolveMix(); // 拮抗/絶望なら特別形態
      if (mix) return { ...mix, key: lead.key, stage: 1 };
      const f = C.EVOLUTION_STAGES.forms[lead.key][0];
      return { key: lead.key, name: f.name, label: f.label, icon: f.icon, color: C.EMOTIONS[lead.key].color, kind: "stage", stage: 1 };
    }
    // 段階2・3：最初に進化した感情の道を辿る
    const key = this.evolvedKey;
    if (!key) return null;
    if ((this.emotions[key] || 0) < this.evoThresholds[nextStage - 1]) return null;
    const f = C.EVOLUTION_STAGES.forms[key][nextStage - 1];
    return { key, name: f.name, label: f.label, icon: f.icon, color: C.EMOTIONS[key].color, kind: "stage", stage: nextStage };
  }

  // ============================ evolution（多段進化：スライム→獣→戦士→化身）============================
  doEvolution(form) {
    this.mode = "evolve";
    sfx.evolve();
    this.evolved = true;
    this.evolvedKey = form.key;
    this.evoStage = form.stage;
    if (form.kind !== "stage") this.evoSpecial = true; // 混合/三重/闇堕ちは終点
    const icon = form.icon;
    const color = form.color;
    const dispName = form.name;
    const species = form.label;

    const veil = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000012).setDepth(60).setFillStyle(0x000012, 0);
    this.tweens.add({ targets: veil, fillAlpha: 0.7, duration: 600 });

    this.tweens.add({
      targets: this.heroSprite,
      scale: this.heroFit * 1.45,
      duration: 550,
      onComplete: () => {
        const flash = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, color).setDepth(61).setFillStyle(color, 0);
        this.tweens.add({
          targets: flash,
          fillAlpha: 0.85,
          duration: 200,
          yoyo: true,
          onComplete: () => {
            flash.destroy();
            if (this.heroIsImage) {
              const tkey = "hero_" + form.key + "_" + (form.kind === "stage" ? form.stage : 1);
              if (this.textures.exists(tkey)) {
                this.heroSprite.setTexture(tkey);
                this.heroFormKey = tkey;
              }
              this.heroFit = this.heroFitFor(form.stage);
              this.heroSprite.setScale(this.heroFit);
            } else {
              this.heroSprite.setText(icon).setScale(1);
            }
            this.evoMult *= C.EVOLUTION.statMultiplier; // 進化倍率（強化と別管理で整合）
            this.applyRunUpgrades();
            this.heroStats.hp = this.heroStats.maxHp;

            const subText =
              form.kind === "triple"
                ? "── 三つの感情が、ひとつに ──"
                : form.kind === "dark"
                  ? "── 感情が、絶望に呑まれて ──"
                  : form.kind === "double"
                    ? "── 二つの感情が、まじり合って ──"
                    : form.stage === 1
                      ? "── 名もなき雫が、名を得る ──"
                      : form.stage === 2
                        ? "── さらに、力を増す ──"
                        : "── 感情の化身へ ──";
            const sub = this.add
              .text(this.W / 2, this.H / 2 - 158, subText, { fontFamily: UI_FONT, fontSize: "15px", color: form.kind === "dark" ? "#b07a9a" : "#d6c2e0", align: "center" })
              .setOrigin(0.5)
              .setDepth(62)
              .setAlpha(0);
            this.tweens.add({ targets: sub, alpha: 1, duration: 700 });
            this.time.delayedCall(2300, () => sub.destroy());

            const named = form.kind === "stage" && form.stage > 1; // 既に名がある→「進化した」
            const nameTxt = this.add
              .text(this.W / 2, this.H / 2 - 110, `キミは "${dispName}"\n〈${species}〉${named ? "へと 進化した" : "と名づけられた"}`, {
                fontFamily: UI_FONT,
                fontSize: "23px",
                color: "#ffffff",
                align: "center",
                lineSpacing: 6,
                wordWrap: { width: this.W - 60 },
              })
              .setOrigin(0.5)
              .setDepth(62)
              .setAlpha(0);
            this.tweens.add({ targets: nameTxt, alpha: 1, y: this.H / 2 - 124, duration: 700 });
            const evoTag =
              form.kind === "triple" ? "（三重混合）" : form.kind === "dark" ? "（闇堕ち）" : form.kind === "double" ? "（混合進化）" : form.stage === 3 ? "（化身）" : form.stage === 2 ? "（戦士）" : "";
            this.pushLog(`✨ キミは "${dispName}"〈${species}〉になった${evoTag}`);
            recordForm(dispName); // 感情図鑑に刻む

            this.time.delayedCall(2300, () => {
              this.tweens.add({
                targets: [veil, nameTxt],
                alpha: 0,
                duration: 600,
                onComplete: () => {
                  veil.destroy();
                  nameTxt.destroy();
                  this.afterBattleResolved();
                },
              });
            });
          },
        });
      },
    });
  }

  // ============================ 転生：ホームへ戻る ============================
  retreatToHome() {
    if (this.upPanel || this._leaving) return;
    // 進化・エピローグ・死亡演出中以外は、戦闘中でも撤退できる（引き際の裁量）
    if (this.mode !== "walk" && this.mode !== "battle") return;
    if (this.battleTimer) this.battleTimer.remove();
    this.dismissCare();
    this.bankRunAndGoHome(false);
  }

  bankRunAndGoHome(died) {
    if (this._leaving) return;
    this._leaving = true;
    this.clearQueueSilhouettes();
    const run = { distance: this.distance, emotions: { ...this.emotions }, evolved: this.evolved, kills: this.kills };
    const summary = transmigrate(run);
    summary.emotions = run.emotions;
    summary.died = died;
    // 仲間の去就を確定（魂の絆で繋がる／光に還る）。設計書§17
    const fate = commitRunCompanions(this.companions, this.distance);
    summary.companionsBonded = fate.newlyBonded.map((c) => ({ name: c.name, icon: c.icon }));
    summary.companionsDispersed = fate.dispersed;
    summary.hatched = fate.hatched ? { name: fate.hatched.name, icon: fate.hatched.icon, roleLabel: fate.hatched.roleLabel } : null;
    summary.newEgg = fate.newEgg ? { emotion: fate.newEgg.emotion } : null;
    // 4つの感情をすべて理解した者には、一度だけ「統合」が訪れる（§17-4）
    if (empathyUnlocked() && !getSave().endingSeen) this.playEnding(summary);
    else this.playEpilogue(summary);
  }

  // ============================ 感情統合エンディング（§17-4：二層構造の真実）============================
  playEnding(summary) {
    this.mode = "epilogue";
    this.dismissCare();
    if (this.battleTimer) this.battleTimer.remove();
    markEndingSeen();
    recordForm("感情の精霊"); // 図鑑：頂点

    const cx = this.W / 2;
    const c = this.add.container(0, 0).setDepth(320);
    const veil = this.add.rectangle(cx, this.H / 2, this.W, this.H, 0x07060a, 0).setInteractive();
    const warm = this.add.rectangle(cx, this.H / 2, this.W, this.H, 0xffd9a0, 0); // 色が戻る暖かさ
    c.add([veil, warm]);
    this.tweens.add({ targets: veil, fillAlpha: 0.97, duration: 900 });

    const hero = this.add.text(cx, this.H / 2 - 210, "🌈", { fontFamily: EMOJI_FONT, fontSize: "58px" }).setOrigin(0.5).setAlpha(0);
    c.add(hero);
    this.tweens.add({ targets: hero, alpha: 1, duration: 1200, delay: 700 });
    this.tweens.add({ targets: hero, scale: 1.08, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    const hint = this.add.text(cx, this.H - 52, "タップしてつづける", { fontFamily: UI_FONT, fontSize: "13px", color: "#6a6a80" }).setOrigin(0.5).setAlpha(0);
    c.add(hint);
    this.tweens.add({ targets: hint, alpha: 1, duration: 900, delay: 900 });

    const dyn = this.add.container(0, 0);
    c.add(dyn);
    const T = (y, str, opts = {}) => {
      const t = this.add.text(cx, y, str, { fontFamily: UI_FONT, fontSize: opts.size || "20px", color: opts.color || "#efeae2", align: "center", lineSpacing: 9, wordWrap: { width: this.W - 64 } }).setOrigin(0.5).setAlpha(0);
      dyn.add(t);
      this.tweens.add({ targets: t, alpha: 1, duration: 700 });
      return t;
    };

    const my = this.H / 2 + 30;
    const beats = [
      () => {
        T(my - 20, "── すべての感情を、知った ──", { size: "22px" });
        T(my + 28, "怒りも、悲しみも、勇気も、希望も。", { size: "15px", color: "#cfc6ba" });
      },
      () => {
        T(my - 16, "キミは ずっと、見守られていた。", { size: "19px" });
        T(my + 30, 'その "心" は ── かつて、キミを 捨てた。', { size: "16px", color: "#cfc6ba" });
      },
      () => {
        T(my - 16, "感情を捨てた、ひとりの人間の\n空っぽの心。", { size: "18px" });
        T(my + 44, "それが、キミを 導いていた。", { size: "16px", color: "#cfc6ba" });
      },
      () => {
        T(my - 24, "捨てられた感情 ＝ キミ。", { size: "18px", color: "#ffd9a0" });
        T(my + 6, "捨てた心 ＝ わたし。", { size: "18px", color: "#bfe0ff" });
        T(my + 40, "二つで、ひとりの 人間だった。", { size: "16px", color: "#cfc6ba" });
      },
      () => {
        // 色が戻る暖かい和音
        this.tweens.add({ targets: warm, fillAlpha: 0.16, duration: 1400 });
        sfx.ending();
        T(my - 6, "分かたれていた心が、ひとつに戻る。", { size: "19px", color: "#fff4e6" });
      },
      () => {
        // 感情の精霊にプレイヤーが名をつける（設計書§頂点：プレイヤー命名）
        let nm = getSave().spiritName;
        if (!nm) {
          const input = typeof window !== "undefined" && window.prompt ? window.prompt("生まれた精霊に、名をつけて。", "") : "";
          nm = (input || "").trim().slice(0, 12);
          if (!nm) nm = "ヒカリ";
          setSpiritName(nm);
        }
        T(my - 12, `── "${nm}" ──`, { size: "26px", color: "#fff4e6" });
        T(my + 34, "それが、ひとつに戻った心の 名。", { size: "14px", color: "#cfc6ba" });
      },
      () => {
        T(my - 40, "「ありがとう」", { size: "30px", color: "#ffffff" });
        T(my + 18, "── 感情を捨てた、人間たちへ。", { size: "14px", color: "#cfc6ba" });
        T(my + 56, "捨てられなければ、生まれなかった。\nそれすら、肯定する。", { size: "14px", color: "#cfc6ba" });
      },
      () => {
        T(my - 16, "……わかってほしかった。\nただ、それだけ。", { size: "17px", color: "#e6dccf" });
        T(my + 52, "けれど、問いは残る。\n人は、また 感情を捨てる。\n── まだ、途上。", { size: "13px", color: "#9a9088" });
      },
    ];

    let idx = -1;
    const next = () => {
      idx += 1;
      if (idx >= beats.length) {
        this.input.off("pointerdown", next);
        this.tweens.add({ targets: c, alpha: 0, duration: 800, onComplete: () => this.scene.start("HomeScene") });
        return;
      }
      dyn.removeAll(true);
      beats[idx]();
    };
    this.time.delayedCall(1000, () => {
      next();
      this.input.on("pointerdown", next);
    });
  }

  // ============================ 転生エピローグ（別れの演出：DR最優先②）============================
  //  数値清算で終えず、作品の山場にする。初回はフル／2回目以降はサマリー。
  playEpilogue(summary) {
    this.mode = "epilogue";
    this.dismissCare();
    if (this.battleTimer) this.battleTimer.remove();
    this.tweens.killTweensOf(this.heroSprite);

    const c = this.add.container(0, 0).setDepth(300);
    const veil = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x05050c, 0).setInteractive();
    c.add(veil);
    this.tweens.add({ targets: veil, fillAlpha: 0.96, duration: 700 });

    const hint = this.add.text(this.W / 2, this.H - 54, "タップしてつづける", { fontFamily: UI_FONT, fontSize: "13px", color: "#6a6a80" }).setOrigin(0.5).setAlpha(0);
    c.add(hint);
    this.tweens.add({ targets: hint, alpha: 1, duration: 800, delay: 700 });

    const dyn = this.add.container(0, 0);
    c.add(dyn);

    // 初めての転生、または最高到達を更新した"節目"の旅はフル演出（DR：初回フル/以降サマリー）
    const full = summary.rebirths <= 1 || summary.newBest;
    const beats = this.buildEpilogueBeats(summary, full);
    let idx = -1;
    const next = () => {
      idx += 1;
      if (idx >= beats.length) {
        this.input.off("pointerdown", next);
        this.tweens.add({ targets: c, alpha: 0, duration: 500, onComplete: () => this.scene.start("HomeScene") });
        return;
      }
      dyn.removeAll(true);
      beats[idx](dyn);
    };
    this.time.delayedCall(700, () => {
      next();
      this.input.on("pointerdown", next);
    });
  }

  buildEpilogueBeats(summary, full) {
    const cx = this.W / 2;
    const beats = [];
    // 中央寄せテキストをふわっと出すヘルパ
    const T = (dyn, y, str, opts = {}) => {
      const t = this.add
        .text(cx, y, str, { fontFamily: UI_FONT, fontSize: opts.size || "22px", color: opts.color || "#e8e8ef", align: "center", lineSpacing: 8, wordWrap: { width: this.W - 70 } })
        .setOrigin(0.5)
        .setAlpha(0);
      dyn.add(t);
      this.tweens.add({ targets: t, alpha: 1, duration: 600 });
      return t;
    };

    // 1) 入り
    beats.push((dyn) => {
      T(dyn, this.H / 2 - 24, summary.died ? "── ここで、倒れた ──" : "── この旅を、終える ──", { size: "24px" });
      T(dyn, this.H / 2 + 26, `${summary.distance}m を歩いた${summary.newBest ? "　★最高到達" : ""}`, { size: "15px", color: summary.newBest ? "#ffd24d" : "#9a9aac" });
    });

    // 2) フラッシュバック：感情が散る（節目のみ／情緒の核）
    if (full) {
      beats.push((dyn) => {
        T(dyn, 168, "集めた感情は、散らばっていく", { size: "18px", color: "#cfcfe0" });
        const ems = C.EMOTION_ORDER.filter((k) => (summary.emotions[k] || 0) > 0);
        const list = ems.length ? ems : C.EMOTION_ORDER;
        list.forEach((k, i) => {
          const info = C.EMOTIONS[k];
          const x = cx + (i - (list.length - 1) / 2) * 72;
          const ic = this.add.text(x, this.H / 2 + 30, info.icon, { fontFamily: EMOJI_FONT, fontSize: "40px" }).setOrigin(0.5);
          const cnt = this.add.text(x, this.H / 2 + 72, `${Math.round((summary.emotions[k] || 0) * 10) / 10}`, { fontFamily: UI_FONT, fontSize: "13px", color: colorToCss(info.color) }).setOrigin(0.5);
          dyn.add([ic, cnt]);
          this.tweens.add({ targets: [ic, cnt], y: "-=66", alpha: 0.12, duration: 1900, delay: 250 + i * 160, ease: "Sine.easeIn" });
        });
      });
    }

    // 3) 仲間の別れ（あれば）
    const hasComp = (summary.companionsDispersed?.length || 0) + (summary.companionsBonded?.length || 0) > 0;
    if (hasComp) {
      beats.push((dyn) => {
        let y = this.H / 2 - 110;
        if (summary.companionsBonded?.length) {
          T(dyn, y, summary.companionsBonded.map((cp) => `${cp.icon}${cp.name}`).join("　"), { size: "18px", color: "#e6c2ff" });
          y += 28;
          T(dyn, y, "魂の絆で、ついてくる", { size: "14px", color: "#c79ad0" });
          y += 56;
        }
        if (summary.companionsDispersed?.length) {
          T(dyn, y, summary.companionsDispersed.map((cp) => `${cp.icon}${cp.name}`).join("　"), { size: "18px", color: "#9a9aac" });
          y += 28;
          T(dyn, y, "光になって、還っていった", { size: "14px", color: "#8a7a90" });
        }
      });
    }

    // 4) 魂に残るもの（継承）
    beats.push((dyn) => {
      T(dyn, 168, "けれど ── 魂に、残るものがある", { size: "18px", color: "#cfcfe0" });
      let y = this.H / 2 - 30;
      if (summary.resonanceKey) {
        const info = C.EMOTIONS[summary.resonanceKey];
        T(dyn, y, `記憶の傾向　${info.icon}${info.label}`, { size: "17px", color: "#cfcfe0" });
        y += 40;
      }
      T(dyn, y, `魂レベル +${summary.levelGain}　→　Lv.${summary.newLevel}`, { size: "18px", color: "#bfffbf" });
      y += 36;
      if (summary.satoriGain > 0) {
        T(dyn, y, `導く心は 旅から学んだ　悟り +${summary.satoriGain}`, { size: "16px", color: "#bfe0ff" });
        y += 34;
      }
      if (summary.goldGain > 0) {
        T(dyn, y, `🪙 お金 +${summary.goldGain}`, { size: "15px", color: "#ffe08a" });
        y += 30;
      }
      if (summary.artifacts && summary.artifacts.length) {
        T(dyn, y, `💎 感情の結晶を ${summary.artifacts.length} つ 得た`, { size: "16px", color: "#ffd9a0" });
        y += 32;
      }
      if (summary.hatched) {
        T(dyn, y, `🥚 卵から ${summary.hatched.icon}${summary.hatched.name}〈${summary.hatched.roleLabel}〉が 生まれた`, { size: "15px", color: "#bfffd9" });
        y += 30;
      }
      if (summary.newEgg) {
        T(dyn, y, `🥚 ${C.EMOTIONS[summary.newEgg.emotion].icon} 感情の卵が 生まれた（共鳴）`, { size: "14px", color: "#e6dccf" });
      }
    });

    // 5) テーマ（節目のみ。通奏低音）
    if (full) {
      beats.push((dyn) => {
        T(dyn, this.H / 2 - 20, "感情は、弱さではない。", { size: "23px", color: "#ffffff" });
        T(dyn, this.H / 2 + 34, "……わかってほしかった。\nただ、それだけ。", { size: "15px", color: "#9a9aac" });
      });
    }

    return beats;
  }

  onDeath() {
    if (this.reviveItems > 0) {
      this.reviveFromItem();
      return;
    }
    this.mode = "dead";
    this.battle = null;
    this.enemyLabel.setVisible(false);
    this.tweens.killTweensOf(this.enemySprite);
    sfx.death();
    this.pushLog("倒れた… 感情は散らばった。（記憶だけが、残る）");
    this.tweens.add({ targets: this.heroSprite, alpha: 0.2, angle: 90, duration: 400 });
    this.tweens.add({ targets: this.enemySprite, alpha: 0, duration: 300 });
    this.time.delayedCall(1500, () => this.bankRunAndGoHome(true));
  }

  // 不死鳥の羽：倒れても一度だけ立ち上がり、旅を続ける
  reviveFromItem() {
    this.reviveItems -= 1;
    useItem("phoenix", 1);
    this.battle = null;
    this.heroStats.hp = this.heroStats.maxHp;
    this.heroSprite.setAlpha(1).setAngle(0);
    this.enemyLabel.setVisible(false);
    this.tweens.killTweensOf(this.enemySprite);
    this.tweens.add({
      targets: this.enemySprite,
      alpha: 0,
      x: this.enemyX + 44,
      duration: 300,
      onComplete: () => this.enemySprite.setVisible(false).setScale(1).setAlpha(1).setX(this.enemyX),
    });
    this.flashWhite(0.25);
    sfx.revive();
    this.pushLog("🪶 不死鳥の羽が砕け、立ち上がった");
    this.drawHpBars();
    this.endBattle();
  }

  // ============================ visuals ============================
  drawHpBars() {
    this.drawBar(this.heroHpG, this.heroX - 35, this.heroY + 46, 70, 8, this.heroStats.hp / this.heroStats.maxHp);
    const inBattle = this.mode === "battle" && this.currentEnemy;
    const boss = inBattle && this.currentEnemy.boss;
    if (inBattle && !boss) {
      this.drawBar(this.enemyHpG, this.enemyX - 35, this.enemyY + 46, 70, 8, Math.max(0, this.currentEnemy.hp) / this.currentEnemy.maxHp);
    } else {
      this.enemyHpG.clear();
    }
    // ボスは上部に大型HPバー
    if (boss) {
      const info = C.EMOTIONS[this.currentEnemy.lean] || { color: 0xff4d4d };
      const x = 28;
      const y = 138;
      const w = this.W - 56;
      const ratio = Math.max(0, this.currentEnemy.hp) / this.currentEnemy.maxHp;
      this.bossHpG.clear();
      this.bossHpG.fillStyle(0x000000, 0.4);
      this.bossHpG.fillRect(x - 3, y - 3, w + 6, 20);
      this.bossHpG.fillStyle(0x222230, 1);
      this.bossHpG.fillRect(x, y, w, 14);
      this.bossHpG.fillStyle(info.color, 1);
      this.bossHpG.fillRect(x, y, w * ratio, 14);
      this.bossHpG.lineStyle(1, 0xffd24d, 0.8);
      this.bossHpG.strokeRect(x, y, w, 14);
      this.bossNameT.setVisible(true).setText(`${this.currentEnemy.icon} ${this.currentEnemy.label}`);
    } else {
      this.bossHpG.clear();
      this.bossNameT.setVisible(false);
    }
    this.drawSkillGauge();
  }

  // 技ゲージ（あと何回で技が出るか・主人公HPバーの下）
  drawSkillGauge() {
    if (!this.skillG) return;
    this.skillG.clear();
    if (this.mode !== "battle") return;
    const x = this.heroX - 35;
    const y = this.heroY + 57;
    const w = 70;
    this.skillG.fillStyle(0x222230, 1);
    this.skillG.fillRect(x, y, w, 4);
    const ratio = Phaser.Math.Clamp((this.heroSkillCharge || 0) / (this.skill ? this.skill.every : C.SKILL.heroEvery), 0, 1);
    this.skillG.fillStyle(ratio >= 1 ? 0xfff0a0 : 0xffd24d, 1);
    this.skillG.fillRect(x, y, w * ratio, 4);
  }

  // ============================ 技演出 ============================
  // 主人公の必殺技：主感情の色の弾が敵に着弾＋技名＋大ダメージ
  playHeroSkill(dmg) {
    const lead = leadingEmotion(this.emotions);
    const key = lead.value > 0 ? lead.key : null;
    const color = key ? C.EMOTIONS[key].color : 0xffffff;
    const name = key ? C.SKILL.names[key] : C.SKILL.defaultName;
    sfx.skill();

    const label = this.add.text(this.heroX, this.heroY - 64, name, { fontFamily: UI_FONT, fontSize: "16px", color: colorToCss(color), fontStyle: "bold" }).setOrigin(0.5).setDepth(46).setAlpha(0);
    this.tweens.add({ targets: label, alpha: 1, y: this.heroY - 84, duration: 240, hold: 240, yoyo: true, onComplete: () => label.destroy() });

    const proj = this.add.circle(this.heroX, this.heroY, 14, color, 0.9).setDepth(46);
    this.tweens.add({
      targets: proj,
      x: this.enemyX,
      y: this.enemyY,
      scale: 1.5,
      duration: 200,
      ease: "Quad.easeIn",
      onComplete: () => {
        proj.destroy();
        const ring = this.add.circle(this.enemyX, this.enemyY, 12, color, 0.55).setDepth(46);
        this.tweens.add({ targets: ring, scale: 3.4, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
        this.flashWhite(0.12);
        this.cameras.main.shake(120, 0.004);
        this.popDamage(this.enemyX, this.enemyY - 40, dmg, colorToCss(color), 1);
        this.knockback(this.enemySprite, this.enemyX, 1, 1);
      },
    });
  }

  // 仲間の技：役割（距離）で演出が変わる ── 怒り=近接 / 勇気・希望=遠隔 / 悲しみ=後衛の癒し
  playCompanionSkill(comp, isHeal) {
    const info = C.EMOTIONS[comp.emotion] || { color: 0xb0b0c0 };
    const o = this.companionSprites[comp.id];
    const ox = o ? o.spr.x : this.heroX;
    const oy = o ? o.spr.y : this.partyY;

    if (isHeal) {
      const orb = this.add.circle(ox, oy, 8, info.color, 0.9).setDepth(45);
      this.tweens.add({
        targets: orb,
        x: this.heroX,
        y: this.heroY,
        scale: 0.4,
        duration: 380,
        onComplete: () => {
          orb.destroy();
          const aura = this.add.circle(this.heroX, this.heroY, 16, 0x7fff9f, 0.5).setDepth(44);
          this.tweens.add({ targets: aura, scale: 2.2, alpha: 0, duration: 360, onComplete: () => aura.destroy() });
        },
      });
      return;
    }
    this.companionLunge(comp); // 攻撃時は前へ踏み込む（一緒に戦ってる感）
    if (comp.emotion === "anger") {
      // 前衛・近接：敵の位置で爆ぜる
      const burst = this.add.text(this.enemyX, this.enemyY, "💥", { fontFamily: EMOJI_FONT, fontSize: "30px" }).setOrigin(0.5).setDepth(45).setScale(0.4);
      this.tweens.add({ targets: burst, scale: 1.1, alpha: 0, duration: 300, onComplete: () => burst.destroy() });
    } else {
      // 遠隔：後方の仲間 → 敵へ 弾が飛ぶ
      const glyph = comp.emotion === "courage" ? "⚡" : comp.emotion === "hope" ? "✨" : "•";
      const p = this.add.text(ox, oy, glyph, { fontFamily: EMOJI_FONT, fontSize: "20px" }).setOrigin(0.5).setDepth(45);
      this.tweens.add({
        targets: p,
        x: this.enemyX,
        y: this.enemyY,
        duration: 200,
        ease: "Quad.easeIn",
        onComplete: () => {
          p.destroy();
          const ring = this.add.circle(this.enemyX, this.enemyY, 8, info.color, 0.5).setDepth(45);
          this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 250, onComplete: () => ring.destroy() });
        },
      });
    }
  }

  drawBar(g, x, y, w, h, ratio) {
    ratio = Phaser.Math.Clamp(ratio, 0, 1);
    g.clear();
    g.fillStyle(0x222230, 1);
    g.fillRect(x, y, w, h);
    let color = 0x4caf50;
    if (ratio < 0.3) color = 0xe53935;
    else if (ratio < 0.6) color = 0xfbc02d;
    g.fillStyle(color, 1);
    g.fillRect(x, y, w * ratio, h);
  }

  popDamage(x, y, dmg, color, ratio = 0) {
    const big = Phaser.Math.Clamp(ratio, 0, 1);
    const size = Math.round(18 + big * 22); // 大ダメージほど大きく
    const pop = 1 + big * 0.4;
    const t = this.add
      .text(x + Phaser.Math.Between(-10, 10), y, "" + dmg, { fontFamily: UI_FONT, fontSize: size + "px", color, fontStyle: "bold" })
      .setOrigin(0.5)
      .setScale(pop)
      .setDepth(40);
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, scale: pop * 0.9, duration: 600, onComplete: () => t.destroy() });
  }

  // 踏み込み（攻撃側が相手へ素早く突っ込んでクラッシュ→戻る）。"戦ってる感"の核。
  lunge(sprite, homeX, dir, dist = 78) {
    this.tweens.add({
      targets: sprite,
      x: homeX + dir * dist,
      duration: 100,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => {
        sprite.x = homeX;
      },
    });
  }

  // ノックバック（溜め→吹き飛び）。homeX に必ず戻す。
  knockback(sprite, homeX, dir, power = 0.4) {
    this.tweens.add({
      targets: sprite,
      x: homeX + dir * (6 + 12 * power),
      duration: 70,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => {
        sprite.x = homeX;
      },
    });
  }

  absorbLight(key) {
    if (!key) return;
    const info = C.EMOTIONS[key];
    const dot = this.add.circle(this.enemyX, this.enemyY, 9, info.color).setDepth(45);
    this.tweens.add({ targets: dot, x: this.heroX, y: this.heroY, scale: 0.2, duration: 600, onComplete: () => dot.destroy() });
  }

  flashEdge(key) {
    if (!key) return;
    const info = C.EMOTIONS[key];
    this.edgeFlash.setFillStyle(info.color, 0);
    this.tweens.add({ targets: this.edgeFlash, fillAlpha: 0.12, duration: 150, yoyo: true });
  }

  updateGauges() {
    for (const key of C.EMOTION_ORDER) {
      const g = this.gauges[key];
      const val = this.emotions[key];
      g.count.setText("" + Math.round(val * 10) / 10);
      const ratio = Phaser.Math.Clamp(val / this.evoThreshold, 0, 1);
      g.bar.width = Math.max(1, 56 * ratio);
    }
    const lead = leadingEmotion(this.emotions);
    for (const key of C.EMOTION_ORDER) {
      this.gauges[key].icon.setScale(key === lead.key && lead.value > 0 ? 1.25 : 1);
    }
    this.updateHeroAura(lead);
  }

  // 主人公の感情オーラ：主感情の色／進行で濃く・大きく（①可視化）
  updateHeroAura(lead) {
    if (!this.heroAura) return;
    lead = lead || leadingEmotion(this.emotions);
    if (!lead.key || lead.value <= 0) {
      this.heroAura.setFillStyle(0xffffff, 0);
      return;
    }
    const info = C.EMOTIONS[lead.key];
    const ratio = Phaser.Math.Clamp(lead.value / this.evoThreshold, 0, 1);
    this.heroAura.setFillStyle(info.color, 0.1 + ratio * 0.32);
    this.heroAura.setScale(0.9 + ratio * 0.35);
    // 欠片を得た瞬間のひと脈動
    this.tweens.add({ targets: this.heroAura, scale: this.heroAura.scale + 0.12, duration: 130, yoyo: true });
  }

  pushLog(line) {
    this.logLines.push(line);
    if (this.logLines.length > 3) this.logLines.shift();
    this.logText.setText(this.logLines.join("\n"));
  }

  // ============================ 仲間（設計書§17）============================
  buildParty() {
    // 出撃時に同行している仲間を主人公のまわりに配置
    this.companions.forEach((c) => this.addCompanionSprite(c));
    this.layoutCompanions(true);
  }

  partySlotX(i) {
    return 70 + 60 * i; // 主人公（x=120）の足元にならぶ隊列
  }

  bobCompanions(time) {
    let i = 0;
    for (const comp of this.companions) {
      const o = this.companionSprites[comp.id];
      if (o) {
        const base = o.baseY != null ? o.baseY : this.partyY;
        o.spr.y = base + (Math.floor(time / 340 + i * 1.4) % 2 === 0 ? 0 : -3); // 2コマ待機（少しずらして）
      }
      i += 1;
    }
  }

  // ============================ 隊列（仲間は常に主人公のまわりに）============================
  // 役割で前衛/後衛に並ぶ。戦闘後も足元に戻さず、常にこの配置。instant=起動時は即配置。
  layoutCompanions(instant = false) {
    const rank = { attacker: 3, striker: 2, clutch: 1, healer: 0 };
    const slots = [
      { dx: 34, dy: 16 }, // 前衛（前方寄り）
      { dx: -40, dy: 32 }, // 中
      { dx: -74, dy: 10 }, // 後衛
      { dx: 72, dy: 42 }, // 予備
    ];
    const order = this.companions.slice().sort((a, b) => (rank[b.role] || 0) - (rank[a.role] || 0));
    order.forEach((comp, i) => {
      const o = this.companionSprites[comp.id];
      if (!o) return;
      const s = slots[Math.min(i, slots.length - 1)];
      o.baseX = this.heroX + s.dx;
      o.baseY = this.heroY + s.dy;
      if (o.nm) o.nm.setVisible(false); // 常にそばに居るので名前は隠す（アイコンで識別）
      const fit = o.fitScale != null ? o.fitScale : 0.85;
      this.tweens.killTweensOf(o.spr);
      if (instant) {
        o.spr.setPosition(o.baseX, o.baseY).setScale(fit);
      } else {
        this.tweens.add({ targets: o.spr, x: o.baseX, y: o.baseY, scale: fit, duration: 320, ease: "Quad.easeOut" });
      }
    });
  }

  // 仲間が攻撃時に敵へ踏み込む＋スクワッシュ＋2コマ攻撃フレーム（生きてる手触り）
  companionLunge(comp) {
    const o = this.companionSprites[comp.id];
    if (!o) return;
    const hx = o.baseX != null ? o.baseX : o.spr.x;
    const fit = o.fitScale != null ? o.fitScale : 0.85;
    // 画像仲間は攻撃フレームへ差し替え → 戻す（フレームアニメ）。3倍速は軽量化のため簡略。
    const light = this.speed >= 3;
    if (!light && o.spr.type === "Image" && this.textures.exists("char_" + comp.emotion + "_atk")) {
      o.spr.setTexture("char_" + comp.emotion + "_atk");
      this.time.delayedCall(220, () => {
        if (o.spr && o.spr.scene && o.spr.type === "Image" && this.textures.exists("char_" + comp.emotion)) o.spr.setTexture("char_" + comp.emotion);
      });
    }
    this.tweens.add({ targets: o.spr, x: hx + 48, duration: 110, yoyo: true, ease: "Quad.easeOut", onComplete: () => { o.spr.x = hx; } });
    if (!light) this.tweens.add({ targets: o.spr, scaleX: fit * 1.15, scaleY: fit * 0.9, duration: 90, yoyo: true, ease: "Quad.easeOut", onComplete: () => o.spr.setScale(fit) });
  }

  // 主人公の攻撃モーション：攻撃フレームへ差替＋スクワッシュ（ピクセル2コマ）
  heroAttackAnim() {
    if (!this.heroIsImage || !this.heroFormKey) return;
    const atk = this.heroFormKey + "_atk";
    if (!this.textures.exists(atk)) return;
    this.heroSprite.setTexture(atk);
    const fit = this.heroFit || 1;
    if (this.speed < 3) this.tweens.add({ targets: this.heroSprite, scaleX: fit * 1.12, scaleY: fit * 0.92, duration: 90, yoyo: true, onComplete: () => this.heroSprite.setScale(fit) });
    this.time.delayedCall(240, () => {
      if (this.heroSprite && this.heroSprite.scene && this.heroIsImage && this.textures.exists(this.heroFormKey)) this.heroSprite.setTexture(this.heroFormKey);
    });
  }

  // ボスの攻撃モーション：攻撃フレームへ差替（拡大は updatePresence が維持）
  bossAttackAnim() {
    if (!this.enemyImgActive || !this.currentEnemy) return;
    const base = "boss_" + this.currentEnemy.lean;
    const atk = base + "_atk";
    if (!this.textures.exists(atk)) return;
    this.enemyImg.setTexture(atk);
    this.time.delayedCall(260, () => {
      if (this.enemyImg && this.enemyImgActive && this.currentEnemy && this.textures.exists(base)) this.enemyImg.setTexture(base);
    });
  }

  // 倒した雑魚が浄化されて仲間になる（レアは距離なり）
  purifyEnemyToCompanion(emotion) {
    this.tweens.add({
      targets: this.enemySprite,
      alpha: 0,
      scale: 0.4,
      duration: 300,
      onComplete: () => this.enemySprite.setVisible(false).setScale(1).setAlpha(1),
    });
    this.spawnRecruit(emotion);
  }

  // 仲間を1体、主人公のもとへ迎える。opts.minRarity=下限レア（ボス）、opts.big=強調演出。
  spawnRecruit(emotion, opts = {}) {
    const comp = makeCompanion(emotion, this.distance, this.nextCompanionId++, opts);
    this.companions.push(comp);
    recordBond(emotion);
    const info = C.EMOTIONS[emotion];
    const rar = C.COMPANION.rarities.find((r) => r.key === comp.rarity) || C.COMPANION.rarities[0];

    // やわらかい光が主人公のもとへ降りて、仲間になる（レア色で強さを示す）
    const r0 = opts.big ? 30 : 22;
    const glow = this.add.circle(this.enemyX, this.enemyY, r0, rar.color, 0.95).setDepth(46);
    const ring = this.add.circle(this.enemyX, this.enemyY, r0, info.color, 0).setStrokeStyle(2, rar.color, 0.8).setDepth(46);
    this.tweens.add({ targets: ring, scale: opts.big ? 2.4 : 1.8, alpha: 0, duration: 620, onComplete: () => ring.destroy() });
    this.tweens.add({
      targets: glow,
      x: this.heroX,
      y: this.heroY + 20,
      scale: 0.4,
      alpha: 0.4,
      duration: 650,
      ease: "Sine.easeInOut",
      onComplete: () => {
        glow.destroy();
        this.addCompanionSprite(comp);
        this.layoutCompanions(); // 主人公のまわりの隊列に合流
      },
    });

    const verb = opts.big ? "が 心を開いて 仲間になった" : "が ついてきた";
    this.pushLog(`✨ ${rar.star} ${comp.name}〈${comp.roleLabel}〉${verb}【${rar.label}】`);
    this.pushLog(`「${pickVoiceLine(1)}」— ${comp.name}`);
    return comp;
  }

  addCompanionSprite(comp) {
    // 主人公のそばに出現。位置と拡大は layoutCompanions が担当。
    const bx = this.heroX;
    const by = this.heroY + 24;
    const emo = C.EMOTIONS[comp.emotion];
    const bodyColor = emo ? emo.color : 0xffffff;
    const shadow = this.add.ellipse(bx, by + 22, 58, 15, 0x000000, 0.26).setDepth(0);
    const body = this.add.circle(bx, by, 26, bodyColor, 0.14).setDepth(1);
    // 相棒アートがあれば画像、無ければ絵文字。fitScale＝settled時の拡大率（画像は384px基準で正規化）
    let spr, fitScale;
    if (this.textures.exists("char_" + comp.emotion)) {
      spr = this.add.image(bx, by, "char_" + comp.emotion).setDepth(2);
      fitScale = 54 / spr.width;
    } else {
      spr = this.add.text(bx, by, comp.icon, { fontFamily: EMOJI_FONT, fontSize: "32px" }).setOrigin(0.5).setDepth(2);
      fitScale = 0.85;
    }
    spr.setScale(0);
    const nm = this.add.text(bx, by, comp.name, { fontFamily: UI_FONT, fontSize: "11px", color: "#9a9aac" }).setOrigin(0.5).setDepth(2).setVisible(false);
    this.companionSprites[comp.id] = { spr, nm, body, shadow, baseX: bx, baseY: by, fitScale };
  }

  pulseCompanion(id) {
    const o = this.companionSprites[id];
    if (!o) return;
    const fit = o.fitScale != null ? o.fitScale : 0.85;
    this.tweens.add({ targets: o.spr, scale: fit * 1.4, duration: 90, yoyo: true, onComplete: () => o.spr.setScale(fit) });
  }

  // 同行距離が伸びると「声」の段階が上がり、やがて進化する（§17-2 / §17）
  advanceCompanionVoices() {
    for (const comp of this.companions) {
      const st = voiceStage(comp, this.distance);
      if (st > comp.stage) {
        comp.stage = st;
        this.pushLog(`「${pickVoiceLine(st)}」— ${comp.name}`);
      }
      if (!comp.evo && comp.stage >= C.COMPANION.evolveAtStage) this.evolveCompanion(comp);
    }
  }

  // 仲間の進化：同行で姿と力が育つ
  evolveCompanion(comp) {
    comp.evo = 1;
    comp.atk = Math.round(comp.atk * C.COMPANION.evolveStatMult);
    comp.heal = Math.round(comp.heal * C.COMPANION.evolveStatMult);
    comp.spd += 1;
    comp.icon = C.COMPANION.evolvedIcons[comp.emotion] || comp.icon;
    const o = this.companionSprites[comp.id];
    if (o) {
      const fit = o.fitScale != null ? o.fitScale : 0.85;
      if (typeof o.spr.setText === "function") o.spr.setText(comp.icon); // 絵文字仲間は姿を差し替え（画像仲間は据え置き）
      this.tweens.add({ targets: o.spr, scale: fit * 1.6, duration: 200, yoyo: true, onComplete: () => o.spr.setScale(fit) });
      const glow = this.add.circle(o.spr.x, o.spr.y, 26, (C.EMOTIONS[comp.emotion] && C.EMOTIONS[comp.emotion].color) || 0xffffff, 0.5).setDepth(3);
      this.tweens.add({ targets: glow, scale: 2.4, alpha: 0, duration: 500, onComplete: () => glow.destroy() });
    }
    this.pushLog(`✨ ${comp.name} が 育った 〈${comp.roleLabel}〉`);
  }
}
