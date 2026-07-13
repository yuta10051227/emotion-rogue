// =====================================================================
//  GameScene.js  ── 進軍シーン（自動戦闘）
//  ホームから[出発]で開始。倒れる/撤退すると転生してホームへ戻る。
//  魂レベル・装備・記憶の共鳴を反映して旅立つ（設計書§6/§9）。
// =====================================================================

import Phaser from "phaser";
import * as C from "../data/config.js";
import { preloadIcons, makeIcon } from "../data/icons.js";
import { ornateFrame } from "../ui/ornate.js";
import { createBattle, stepBattle, forceFinish, commandAttack, commandSkill, heroSkillReady } from "../logic/combat.js";
import { createEmotionState, gainEmotions, checkEvolution, leadingEmotion, secondEmotion } from "../logic/evolution.js";
import { makeCompanion, voiceStage, pickVoiceLine } from "../logic/companion.js";
import { sfx, onFirstGesture, setMuted, setMusicMood } from "../logic/audio.js";
import { getSave, computeHeroStats, transmigrate, rollEquipmentDrop, addMaterials, fragMultipliers, effectiveEvoThreshold, recordBond, getActiveCompanions, commitRunCompanions, getPref, setPref, getArtifactBonuses, useItem, itemCount, empathyUnlocked, markEndingSeen, skillParams, bossReward, setSpiritName, recordForm, markBattleCoached, recordEnding, endingCollected, getPlayer, abyssActive, formSeen, mixUnlocked, tripleUnlocked, trueChapterUnlocked, markTrueChapter, getStarterEgg } from "../data/save.js";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';

// ---- スプライトの向き（設計書外・実測）----
//  敵は常に右(enemyX>heroX)。味方は右を向くべき。だが元絵の向きはアセットごとにバラバラ。
//  下記は「元絵が左を向いている」キー＝反転(flipX=true)して右(敵)を向かせる対象。
//  ここに無いキーは元絵のまま(右向き/正面)＝反転しない。
//  実測日 2026-07-12：全スプライト（atk/walk含む）を3倍拡大モンタージュで再判定（顔・腕・武器の向きで判断）。
//  ※_atkフレームは左向きが多い＝反転しないと「後ろの子(主人公)に攻撃してるように見える」（ユーザー指摘）。
const FACE_LEFT = new Set([
  "hero_slime", "hero_slime_walk", "hero_slime_atk",
  "hero_anger_1", "hero_anger_1_walk",
  "hero_anger_2_atk", "hero_anger_3_atk",
  "hero_courage_1", "hero_courage_1_walk", "hero_courage_1_atk",
  "hero_courage_2", "hero_courage_2_walk", "hero_courage_2_atk",
  "hero_courage_3_atk",
  "hero_sadness_1_walk", "hero_sadness_1_atk", "hero_sadness_2_atk",
  "hero_hope_1_atk", "hero_hope_3_atk",
  "kid_boy_walk",
  "char_anger", "char_sadness", "char_courage",
  "char_sadness_atk", "char_hope_atk",
]);
// 敵アートのうち「元絵が右を向いている」キー＝敵は左(主人公)を向くべきなので反転する対象。
//  （enemy_ruins_anger=右向き剣士 / boss_hope_atk=右へ突撃 / boss_sadness_atk=頭が右向き）
const ENEMY_FACE_RIGHT = new Set(["enemy_ruins_anger", "boss_hope_atk", "boss_sadness_atk"]);
// スプライトを「敵(右)向き」にする。テクスチャ差し替えのたびに呼ぶこと（flipXは保持されるので誤差替の防止）。
function faceEnemy(sprite, key) {
  if (!sprite || !sprite.setFlipX) return;
  sprite.setFlipX(FACE_LEFT.has(key));
}
// 敵スプライトを「主人公(左)向き」にする。敵のテクスチャ差し替えのたびに呼ぶこと。
function faceHero(sprite, key) {
  if (!sprite || !sprite.setFlipX) return;
  sprite.setFlipX(ENEMY_FACE_RIGHT.has(key));
}

// 大きな数を短く（例 12,345,678 → 1234万 / 1.2兆）。HPバー上の狭い表示向け。
const NUM_UNITS = [
  [1e16, "京"], [1e12, "兆"], [1e8, "億"], [1e4, "万"],
];
function fmtShort(n) {
  n = Math.max(0, Math.floor(n));
  for (const [v, u] of NUM_UNITS) {
    if (n >= v) {
      const q = n / v;
      return (q >= 100 ? Math.floor(q) : Math.round(q * 10) / 10) + u;
    }
  }
  return String(n);
}

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
    this.nextEventAt = 30 + Math.random() * 40; // 旅のイベント（分岐マス）：最初は30〜70mで出会う
    // 固定距離ボス（DR④）
    this.bossCount = 0;
    this.nextBoss = C.BOSS.everyMeters;
    this.bossWarned = false;
    // 群れ（複数の敵）
    this.enemyQueue = [];
    this.queueSprites = [];
    this.emotions = createEmotionState();
    this.runLean = { anger: 0, sadness: 0, courage: 0, hope: 0 }; // 感情の岐路カードで傾けた感情（獲得倍率に加算）
    this.runStatLean = { atk: 0, def: 0, spd: 0, luk: 0 }; // 岐路カードの run 限定ステ強化
    this.evolved = false;
    this.evolvedKey = null;
    this.evoStage = 0; // 0スライム→1獣→2戦士→3化身（多段進化）
    this.evoSpecial = false; // 混合/三重/闇堕ちに進んだら以降は段階進化しない（特別形態は終点）
    this.mode = "walk";
    this.battle = null;
    this.currentEnemy = null;
    this._leaving = false;
    this.logLines = [];

    // 深淵モード（エンディング後の高難度）：敵が苛烈になる代わりに報酬が跳ねる
    this.abyss = abyssActive();
    this.bossKillCount = 0;
    // 感情スキル（CD式アクティブ）：残りクールダウン（戦闘ティック数）
    this.skillCd = { anger: 0, sadness: 0, courage: 0, hope: 0 };
    this._skillHintShown = false;

    // 仲間（救った感情）。同行＝魂の絆で持ち越した子＋旅で新たに出会う子。
    this.companionSprites = {};
    this.nextCompanionId = 1;
    this.recruitedThisRun = []; // 旅で浄化して迎えた仲間（バトルには並べず、帰還時にロスターへ）
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
    this.heroBase = { maxHp: stats.maxHp, atk: stats.atk, spd: stats.spd, def: stats.def, luk: stats.luk };
    this.resonanceKey = stats.resonanceKey; // 記憶の共鳴（多く抱いた感情）
    this.baseFragMult = fragMultipliers(); // ツリーの欠片獲得ボーナス
    this.evoThreshold = effectiveEvoThreshold(); // ツリーで下がりうる進化閾値（1段目）
    this.evoThresholds = [this.evoThreshold, this.evoThreshold + C.EVOLUTION_STAGES.step2, this.evoThreshold + C.EVOLUTION_STAGES.step3]; // 獣/戦士/化身（config.jsで調整可能）
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
    this.manualMode = !!getPref("manual"); // てうち（手動）モード：子供が相棒に こうげき/ひっさつ を指示
    this.savedBest = getSave().soul.bestDistance;
    this.coinBonus = getArtifactBonuses().coin; // 結晶のコイン%（DR④）
    this.lastMilestone = 0;
    this.bestMarked = false;
    this.paused = false;
    this.upPanel = null;
    this.statusPanel = null;

    this.buildBackground();
    this.buildParallax();
    this.buildHud();
    this.buildGauges();
    this.buildArena();
    this.buildLog();
    this.buildControls();
    this.buildParty();

    // ヒットストップ（実時間タイマー）。シーン終了時に必ず復帰させる＝timeScale残留の根絶
    this._hitStopTid = null;
    this.events.once("shutdown", () => {
      if (this._hitStopTid) {
        window.clearTimeout(this._hitStopTid);
        this._hitStopTid = null;
      }
      if (this.time) this.time.timeScale = 1;
      if (this.tweens) this.tweens.timeScale = 1;
    });

    // ログウィズ流「タップ攻撃」：戦闘エリアを叩くと相棒が応えて小さな追撃（命令ではなく応援）
    const tapZone = this.add.zone(this.W / 2, 380, this.W, 420).setInteractive();
    tapZone.on("pointerdown", (p) => this.tapAssist(p));
    // 長押し連続強化の解除はグローバルに拾う（ボタンが作り直されても離した瞬間に止まる）
    this.input.on("pointerup", () => this.stopUpgradeHold());
    this.events.once("shutdown", () => this.stopUpgradeHold());

    // 音：ミュート設定を反映し、初回操作で解錠
    setMuted(getPref("muted"));
    this.input.once("pointerdown", onFirstGesture);
    this.input.keyboard.once("keydown", onFirstGesture);
    setMusicMood("journey"); // 旅は少し陰る調べ

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
    const lean = this.runStatLean || { atk: 0, def: 0, spd: 0, luk: 0 };
    const maxHp = Math.round(this.heroBase.maxHp * (1 + U.hp.per * this.runUp.hp) * this.evoMult * (1 + (this.itemHpPct || 0)));
    const atk = Math.round(this.heroBase.atk * (1 + U.atk.per * this.runUp.atk) * this.evoMult * (1 + (this.itemAtkPct || 0)) * (1 + (lean.atk || 0)));
    const spd = this.heroBase.spd + U.spd.per * this.runUp.spd + (lean.spd || 0);
    const def = (this.heroBase.def || 0) + (lean.def || 0); // 素体(装備)＋岐路カードのrun強化
    const luk = (this.heroBase.luk || 0) + (lean.luk || 0);
    if (!this.heroStats) {
      this.heroStats = { hp: maxHp, maxHp, atk, spd, def, luk };
    } else {
      const grew = Math.max(0, maxHp - this.heroStats.maxHp);
      this.heroStats.maxHp = maxHp;
      this.heroStats.atk = atk;
      this.heroStats.spd = spd;
      this.heroStats.def = def;
      this.heroStats.luk = luk;
      this.heroStats.hp = Math.min(maxHp, this.heroStats.hp + grew); // 守り強化は今のHPも底上げ
    }
    // 欠片獲得倍率＝ツリー由来 ＋ コイン強化「欠片」
    const fragBonus = U.frag.per * this.runUp.frag;
    this.fragMult = {};
    const rl = this.runLean || {};
    for (const k of C.EMOTION_ORDER) this.fragMult[k] = this.baseFragMult[k] + fragBonus + (rl[k] || 0);
    // 深淵：欠片獲得×2（gainEmotions は amount×(1+mult) なので (m+1)×2−1 に変換）
    if (this.abyss) for (const k of C.EMOTION_ORDER) this.fragMult[k] = (this.fragMult[k] + 1) * C.ABYSS.fragMult - 1;
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
    if (this.coinText) this.coinText.setText("" + this.coins); // 数字のみ（コインアイコンは左に別配置）
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

  // ⓘ 旅のステータス確認（今の強さ・仲間・結晶を一覧。読むだけ・一時停止）
  openRunStatusPanel() {
    if (this.upPanel || this.statusPanel || this.mode === "dead" || this.mode === "evolve" || this.mode === "epilogue" || this._leaving || this._choice || this._coach) return;
    this.dismissCare && this.dismissCare();
    this.paused = true;
    if (this.battleTimer) this.battleTimer.paused = true;
    const cx = this.W / 2, cy = this.H / 2;
    const c = (this.statusPanel = this.add.container(0, 0).setDepth(210));
    const bg = this.add.rectangle(cx, cy, this.W, this.H, 0x0d1524, 0.62).setInteractive();
    const cw = this.W - 40, ch = 452;
    const card = this.add.graphics();
    card.fillStyle(0x14203a, 0.99); card.fillRoundedRect(cx - cw / 2, cy - ch / 2, cw, ch, 14);
    card.fillStyle(0x1c2c44, 1); card.fillRoundedRect(cx - cw / 2, cy - ch / 2, cw, 46, { tl: 14, tr: 14, bl: 0, br: 0 });
    ornateFrame(card, cx, cy, cw, ch, 14, { thick: 3, inset: 6, corners: true, cornerArm: 15 });
    c.add([bg, card]);
    let y = cy - ch / 2 + 24;
    c.add(this.add.text(cx, y, "旅のステータス", { fontFamily: UI_FONT, fontSize: "19px", color: "#f4dc86", fontStyle: "bold" }).setOrigin(0.5));
    y += 44;
    // 主人公の現ステ
    const st = this.heroStats || {};
    const stageLabel = ["スライム", "獣", "戦士", "化身"][this.evoStage] || "—";
    const line = (label, val, col) => {
      c.add(this.add.text(cx - cw / 2 + 26, y, label, { fontFamily: UI_FONT, fontSize: "14px", color: "#9fb2cc" }).setOrigin(0, 0.5));
      c.add(this.add.text(cx + cw / 2 - 26, y, val, { fontFamily: UI_FONT, fontSize: "15px", color: col || "#e8eef7", fontStyle: "bold" }).setOrigin(1, 0.5));
      y += 30;
    };
    line("❤ 最大HP", fmtShort(st.maxHp || 0), "#ff9a9a");
    line("⚔ こうげき", fmtShort(st.atk || 0), "#ffcaa0");
    line("⚡ すばやさ", "" + (st.spd || 0), "#bfe0ff");
    line("🔮 魂レベル", "Lv." + (getSave().soul.level || 1), "#d8c0ff");
    line("🧬 進化", `${stageLabel}（第${this.evoStage}段階）`, "#bfffbf");
    // 結晶の恒久ボーナス
    const art = getArtifactBonuses();
    line("💎 結晶ボーナス", `HP+${Math.round(art.hp)}% / ATK+${Math.round(art.atk)}%`, "#8fd0ff");
    // 同行の仲間
    y += 6;
    c.add(this.add.text(cx - cw / 2 + 26, y, `🤝 同行の仲間　${this.companions.length}体`, { fontFamily: UI_FONT, fontSize: "14px", color: "#f4dc86" }).setOrigin(0, 0.5));
    y += 28;
    if (!this.companions.length) {
      c.add(this.add.text(cx, y, "（今回は一人旅）", { fontFamily: UI_FONT, fontSize: "13px", color: "#8496b0" }).setOrigin(0.5));
      y += 26;
    } else {
      for (const comp of this.companions.slice(0, 4)) {
        const info = C.EMOTIONS[comp.emotion] || {};
        c.add(this.add.text(cx - cw / 2 + 30, y, `${info.icon || "・"} ${comp.name}`, { fontFamily: UI_FONT, fontSize: "13px", color: "#d6e2f2" }).setOrigin(0, 0.5));
        c.add(this.add.text(cx + cw / 2 - 26, y, `${comp.roleLabel || comp.role || ""}　⚔${fmtShort(comp.atk || 0)}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#9fb2cc" }).setOrigin(1, 0.5));
        y += 26;
      }
      if (this.companions.length > 4) { c.add(this.add.text(cx, y, `ほか ${this.companions.length - 4}体`, { fontFamily: UI_FONT, fontSize: "12px", color: "#8496b0" }).setOrigin(0.5)); y += 24; }
    }
    // 閉じる
    const close = this.makeBarButton(cx, cy + ch / 2 - 30, 160, 42, "閉じる", () => this.closeRunStatusPanel(), { color: 0x24344e, stroke: 0xc9a23a, textColor: "#f4dc86" });
    c.add([close.gfx, close.rect, close.txt]);
  }
  closeRunStatusPanel() {
    if (!this.statusPanel) return;
    this.statusPanel.destroy(true);
    this.statusPanel = null;
    this.paused = false;
    if (this.battleTimer && this.mode === "battle" && this.battle && !this.battle.finished) this.battleTimer.paused = false;
  }

  // ---- 初回コーチマーク（第一戦で核＝戦い方が感情を決める・を教える。スキップ可・一度きり）----
  maybeCoach() {
    const s = getSave();
    if (s.battleCoached || this._coach) return;
    this._coachStep = 0;
    this.paused = true;
    if (this.battleTimer) this.battleTimer.paused = true;
    this._coachSteps = [
      { text: "これが 君の相棒。\n共に、前へ進む。", arrow: { x: this.heroX, y: this.heroY - 40 } },
      { text: "前の敵は、相棒が自動で倒す。\n君は その戦いを 見守り、導く。", arrow: { x: this.enemyX, y: this.heroY - 30 } },
      { text: "上の 🔥💧⚡✨ は 今 兆している感情。\n速攻=🔥 / 耐える=💧 / 先手=⚡ / 逆転=✨", arrow: { x: this.W / 2, y: 92 } },
      { text: "感情が満ちると、相棒は「進化」する。\nどの姿になるかは、君が選ぶ。", arrow: { x: this.heroX, y: this.heroY - 62 } },
      { text: "戦闘中の 4つのアイコンは『感情スキル』。\n溜まればタップで発動（おまかせ中は自動）。", arrow: { x: this.W / 2, y: this.H - 244 } },
      { text: "下のボタンで ⚙強化・速度・↩撤退。\n引き際を見極めるのも、君の裁量。", arrow: { x: this.W / 2, y: this.H - 90 } },
      { text: "それでは ──\n旅立とう。" },
    ];
    this.buildCoach();
  }

  buildCoach() {
    if (this._coach) this._coach.destroy(true);
    const step = this._coachSteps[this._coachStep];
    const c = this.add.container(0, 0).setDepth(230);
    const dim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x05050c, 0.72).setInteractive();
    dim.on("pointerdown", () => this.advanceCoach()); // どこをタップしても進む
    c.add(dim);
    if (step.arrow) {
      const ring = this.add.circle(step.arrow.x, step.arrow.y, 30, 0xffe14d, 0).setStrokeStyle(2, 0xffe14d, 0.9);
      this.tweens.add({ targets: ring, scale: 1.3, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
      c.add(ring);
    }
    const boxY = this.H / 2 + 130;
    const box = this.add.rectangle(this.W / 2, boxY, this.W - 56, 158, 0x12121c, 0.98).setStrokeStyle(1, 0x4a4a66);
    const txt = this.add.text(this.W / 2, boxY - 26, "", { fontFamily: UI_FONT, fontSize: "17px", color: "#e8e8ef", align: "center", lineSpacing: 9, wordWrap: { width: this.W - 96 } }).setOrigin(0.5);
    this.typewrite(txt, step.text, { speed: 26 }); // 1文字ずつ（案内も"語り"に）
    const idx = this.add.text(this.W / 2, boxY + 40, `${this._coachStep + 1} / ${this._coachSteps.length}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#8a8aa0" }).setOrigin(0.5);
    const last = this._coachStep >= this._coachSteps.length - 1;
    const next = this.add.text(this.W / 2 + 118, boxY + 40, last ? "はじめる ▶" : "次へ ▶", { fontFamily: UI_FONT, fontSize: "16px", color: "#bfffbf" }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    const skip = this.add.text(this.W / 2 - 118, boxY + 40, "スキップ", { fontFamily: UI_FONT, fontSize: "13px", color: "#8a8aa0" }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    next.on("pointerdown", () => this.advanceCoach());
    skip.on("pointerdown", () => this.finishCoach());
    c.add([box, txt, idx, next, skip]);
    this._coach = c;
  }

  advanceCoach() {
    if (this.flushTypewriters()) return; // タイプ中のタップは早送りに消費（送らない）
    this._coachStep += 1;
    if (this._coachStep >= this._coachSteps.length) {
      this.finishCoach();
      return;
    }
    this.buildCoach();
  }

  finishCoach() {
    if (this._coach) {
      this._coach.destroy(true);
      this._coach = null;
    }
    markBattleCoached();
    this.paused = false;
    if (this.battleTimer && this.mode === "battle" && this.battle && !this.battle.finished) this.battleTimer.paused = false;
  }

  // ---- 感情の岐路（節目=ボス直前の3択。委ねた感情の獲得+60%＝どの進化へ向かうかを操縦＋対応ステ強化。おまかせは自動選択）----
  openChoicePanel() {
    if (this._choice || this.mode !== "walk") return;
    this.dismissCare(); // ケア中の吹き出しを消してから（強化パネルと同じ作法）
    this.paused = true;
    if (this.battleTimer) this.battleTimer.paused = true;
    const DEFS = {
      anger: { title: "怒りに委ねる", desc: "🔥 攻撃が 鋭くなる", statLabel: "攻撃 +10%" },
      sadness: { title: "悲しみを抱く", desc: "💧 守りが 増す", statLabel: "DEF +8" },
      courage: { title: "勇気を掲げる", desc: "⚡ 速く 動ける", statLabel: "素早さ +3" },
      hope: { title: "希望を灯す", desc: "✨ 会心が 増す", statLabel: "運 +8" },
    };
    const pool = C.EMOTION_ORDER.slice();
    Phaser.Utils.Array.Shuffle(pool);
    const keys = pool.slice(0, 3);
    const c = this.add.container(0, 0).setDepth(215);
    const dim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x05050c, 0.82).setInteractive();
    c.add(dim);
    c.add(this.add.text(this.W / 2, 150, "── 感情の岐路 ──", { fontFamily: UI_FONT, fontSize: "20px", color: "#ffd24d" }).setOrigin(0.5));
    c.add(this.add.text(this.W / 2, 182, "どの感情に 委ねる？", { fontFamily: UI_FONT, fontSize: "14px", color: "#cfcfe0" }).setOrigin(0.5));
    const cardW = 130;
    const gap = 10;
    const total = keys.length * cardW + (keys.length - 1) * gap;
    let x = this.W / 2 - total / 2 + cardW / 2;
    const cardY = this.H / 2 + 20;
    keys.forEach((key) => {
      const info = C.EMOTIONS[key];
      const cd = DEFS[key];
      const card = this.add.rectangle(x, cardY, cardW, 230, 0x14141f, 0.98).setStrokeStyle(2, info.color).setInteractive({ useHandCursor: true });
      const icon = this.add.text(x, cardY - 80, info.icon, { fontFamily: EMOJI_FONT, fontSize: "42px" }).setOrigin(0.5);
      const title = this.add.text(x, cardY - 28, cd.title, { fontFamily: UI_FONT, fontSize: "15px", color: colorToCss(info.color), align: "center", wordWrap: { width: cardW - 12 } }).setOrigin(0.5);
      const desc = this.add.text(x, cardY + 42, `${cd.desc}\n\n${info.label}の獲得 +60%\n${cd.statLabel}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#b8b8c8", align: "center", lineSpacing: 4, wordWrap: { width: cardW - 14 } }).setOrigin(0.5);
      card.on("pointerover", () => card.setFillStyle(0x1e1e2c, 0.98));
      card.on("pointerout", () => card.setFillStyle(0x14141f, 0.98));
      card.on("pointerdown", () => this.applyChoice(key));
      c.add([card, icon, title, desc]);
      x += cardW + gap;
    });
    c.add(this.add.text(this.W / 2, this.H - 92, this.autoInvest ? "おまかせ：自動で選びます…" : "カードを タップ", { fontFamily: UI_FONT, fontSize: "13px", color: "#8a8aa0" }).setOrigin(0.5));
    this._choice = c;
    if (this.autoInvest) this.time.delayedCall(1200, () => { if (this._choice) this.applyChoice(keys[Math.floor(Math.random() * keys.length)]); });
  }

  applyChoice(key) {
    if (!this._choice) return;
    this._choice.destroy(true);
    this._choice = null;
    const AMT = { anger: { stat: "atk", amount: 0.1 }, sadness: { stat: "def", amount: 8 }, courage: { stat: "spd", amount: 3 }, hope: { stat: "luk", amount: 8 } };
    this.runLean[key] = (this.runLean[key] || 0) + 0.6; // その感情の獲得+60%（進化がその道へ寄る）
    const a = AMT[key];
    this.runStatLean[a.stat] = (this.runStatLean[a.stat] || 0) + a.amount;
    this.applyRunUpgrades();
    const info = C.EMOTIONS[key];
    this.pushLog(`${info.icon} ${info.label}に 心が傾いた（岐路）`, colorToCss(info.color));
    this.flashEdge(key);
    this.refreshEvoHint();
    this.paused = false;
    if (this.battleTimer && this.mode === "battle" && this.battle && !this.battle.finished) this.battleTimer.paused = false;
  }

  // ---- 旅のイベント（分岐マス：進軍中に低頻度で出会う選択。旅ごとの物語感を出す）----
  openTravelEvent() {
    if (this._choice || this.mode !== "walk") return;
    this.dismissCare(); // ケア中の吹き出しを消してから（岐路カードと同じ作法）
    this.paused = true;
    if (this.battleTimer) this.battleTimer.paused = true;
    const def = C.TRAVEL_EVENTS.defs[Math.floor(Math.random() * C.TRAVEL_EVENTS.defs.length)];
    const c = this.add.container(0, 0).setDepth(215);
    const dim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x05050c, 0.82).setInteractive();
    c.add(dim);
    c.add(this.add.text(this.W / 2, 200, def.icon, { fontFamily: EMOJI_FONT, fontSize: "40px" }).setOrigin(0.5));
    c.add(this.add.text(this.W / 2, 250, `── ${def.title} ──`, { fontFamily: UI_FONT, fontSize: "18px", color: "#ffd24d" }).setOrigin(0.5));
    c.add(this.add.text(this.W / 2, 300, def.desc, { fontFamily: UI_FONT, fontSize: "13px", color: "#cfcfe0", align: "center", lineSpacing: 6 }).setOrigin(0.5));
    // 選択肢は縦積み（物語の分岐らしく1本ずつ読ませる）
    let y = 400;
    const affordable = [];
    for (const choice of def.choices) {
      const ok = !choice.cost || this.coins >= choice.cost;
      const btn = this.add.rectangle(this.W / 2, y, 300, 54, ok ? 0x14141f : 0x0d0d14, 0.98).setStrokeStyle(1, ok ? 0x8a8aa0 : 0x3a3a4c);
      const label = this.add.text(this.W / 2, y - 10, choice.label, { fontFamily: UI_FONT, fontSize: "15px", color: ok ? "#e8e8ef" : "#5a5a70" }).setOrigin(0.5);
      const hint = this.add.text(this.W / 2, y + 13, ok ? choice.hint : `${choice.hint}（💰不足）`, { fontFamily: UI_FONT, fontSize: "11px", color: ok ? "#8a8aa0" : "#4a4a5c" }).setOrigin(0.5);
      if (ok) {
        btn.setInteractive({ useHandCursor: true });
        btn.on("pointerover", () => btn.setFillStyle(0x1e1e2c, 0.98));
        btn.on("pointerout", () => btn.setFillStyle(0x14141f, 0.98));
        btn.on("pointerdown", () => this.applyTravelEvent(def, choice));
        affordable.push(choice);
      }
      c.add([btn, label, hint]);
      y += 66;
    }
    c.add(this.add.text(this.W / 2, this.H - 92, this.autoInvest ? "おまかせ：自動で選びます…" : "どうする？", { fontFamily: UI_FONT, fontSize: "13px", color: "#8a8aa0" }).setOrigin(0.5));
    this._choice = c; // 岐路/進化パネルと同じガード（同時に開かない）
    if (this.autoInvest && affordable.length) {
      // おまかせ：コインが心もとなければ無償の選択肢を優先し、あとは先頭の払えるものを選ぶ
      const free = affordable.find((ch) => !ch.cost);
      const pick = this.coins < 60 && free ? free : affordable[0];
      this.time.delayedCall(1400, () => { if (this._choice) this.applyTravelEvent(def, pick); });
    }
  }

  applyTravelEvent(def, choice) {
    if (!this._choice) return;
    this._choice.destroy(true);
    this._choice = null;
    if (choice.cost) {
      this.coins -= choice.cost;
      this.refreshCoinUi();
    }
    const e = choice.effect || {};
    if (e.heal) {
      // 最大HPの%回復（負値はダメージ）。歩き中はheroStatsを書き換えれば次の描画で反映される
      const st = this.heroStats;
      st.hp = Math.max(1, Math.min(st.maxHp, Math.round(st.hp + st.maxHp * e.heal)));
      if (e.heal > 0) this.pushLog(`${def.icon} 傷が癒えた（HP ${st.hp}/${st.maxHp}）`, "#bfffbf");
      else this.pushLog(`${def.icon} 少し消耗した（HP ${st.hp}/${st.maxHp}）`, "#ff9d9d");
    }
    if (e.coins) {
      this.coins += e.coins;
      this.refreshCoinUi();
      this.pushLog(`${def.icon} 💰${e.coins} を 手に入れた`, "#ffd24d");
    }
    if (e.frag) {
      // 感情の欠片：戦闘勝利と同じ獲得経路を通す（共鳴・ツリー倍率・逓減が自然に効く）
      const key = e.frag.key || leadingEmotion(this.emotions).key || "hope";
      const times = Math.max(1, Math.round(e.frag.amount || 1));
      gainEmotions(this.emotions, Array(times).fill(key), {
        resonanceKey: this.resonanceKey,
        resonanceBonus: C.SOUL.resonanceBonus,
        fragMult: this.fragMult,
      });
      this.updateGauges();
      this.flashEdge(key);
      const info = C.EMOTIONS[key];
      this.pushLog(`${def.icon} ${info.icon} ${info.label}の欠片が 満ちた`, colorToCss(info.color));
    }
    if (e.lean) {
      // 旅の間だけのステ強化（岐路カードと同じ層に重ねる）
      this.runStatLean[e.lean.stat] = (this.runStatLean[e.lean.stat] || 0) + e.lean.amount;
      this.applyRunUpgrades();
      this.pushLog(`${def.icon} 力が 宿った（${choice.hint}）`, "#bfd8ff");
    }
    if (e.despair) {
      this.despair = Math.max(0, (this.despair || 0) - e.despair);
      this.pushLog(`${def.icon} 心の澱が 洗い流された`, "#bfefff");
    }
    if (e.nothing) {
      this.pushLog(`${def.icon} …何も 起こらなかった`);
    }
    this.paused = false;
    if (this.battleTimer && this.mode === "battle" && this.battle && !this.battle.finished) this.battleTimer.paused = false;
  }

  buildUpgradePanel() {
    const c = this.upPanel;
    c.removeAll(true);
    const cx = this.W / 2;
    const cy = this.H / 2;
    const bg = this.add.rectangle(cx, cy, this.W, this.H, 0x1a2a3e, 0.55).setInteractive();
    const card = this.add.rectangle(cx, cy, this.W - 30, 430, 0xf3f8ff, 0.98).setStrokeStyle(1, 0xaecbe8);
    c.add([bg, card]);
    c.add(this.add.text(cx, cy - 192, "強化（この旅だけ・倒れたら1から）", { fontFamily: UI_FONT, fontSize: "18px", color: "#22344a" }).setOrigin(0.5));
    c.add(this.add.text(cx, cy - 164, `💰 ${this.coins}`, { fontFamily: UI_FONT, fontSize: "20px", color: "#b8860b" }).setOrigin(0.5));

    let y = cy - 120;
    for (const it of C.UPGRADES.items) {
      const lv = this.runUp[it.key];
      const cost = this.upgradeCost(it.key);
      const can = this.coins >= cost;
      const bonus = it.kind === "pct" ? `+${Math.round(it.per * lv * 100)}%` : `+${it.per * lv}`;
      const row = this.add.rectangle(cx, y, this.W - 60, 54, 0xffffff).setStrokeStyle(1, 0xd6e2f0);
      const icon = this.add.text(54, y, it.icon, { fontFamily: EMOJI_FONT, fontSize: "22px" }).setOrigin(0.5);
      const nm = this.add.text(80, y - 10, `${it.label}　Lv${lv}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#22344a" }).setOrigin(0, 0.5);
      const ds = this.add.text(80, y + 11, `現在 ${bonus}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0, 0.5);
      const btn = this.add.rectangle(this.W - 86, y, 96, 38, can ? 0x4caf50 : 0xe6ebf2).setStrokeStyle(1, can ? 0x2e7d32 : 0xc2ccd8).setInteractive({ useHandCursor: can });
      const bt = this.add.text(this.W - 86, y, `💰${cost}`, { fontFamily: UI_FONT, fontSize: "14px", color: can ? "#ffffff" : "#9aa5b3" }).setOrigin(0.5);
      if (can) {
        btn.on("pointerdown", () => {
          if (this.buyUpgrade(it.key)) this.buildUpgradePanel();
          this.beginUpgradeHold(it.key); // 長押しで連続強化（ログウィズ流QoL）
        });
      }
      c.add([row, icon, nm, ds, btn, bt]);
      y += 62;
    }

    // おまかせ（自動投資）トグル
    const tg = this.add.rectangle(cx, cy + 142, this.W - 60, 38, this.autoInvest ? 0xeef7e4 : 0xffffff).setStrokeStyle(1, this.autoInvest ? 0x4caf50 : 0xd6e2f0).setInteractive({ useHandCursor: true });
    const tgt = this.add.text(cx, cy + 142, this.autoInvest ? "おまかせ強化：ON（自動で投資・見守るだけでOK）" : "おまかせ強化：OFF（自分で配分する）", { fontFamily: UI_FONT, fontSize: "13px", color: this.autoInvest ? "#2e7d32" : "#4c5e76" }).setOrigin(0.5);
    tg.on("pointerdown", () => {
      this.autoInvest = !this.autoInvest;
      setPref("autoInvest", this.autoInvest);
      if (this.autoInvest) this.autoInvestSpend();
      this.buildUpgradePanel();
    });
    // おまかせの中身を明示（autoInvestSpend は "いちばん安い強化" から順に買う）
    const hint = this.add.text(cx, cy + 165, "≫ おまかせは 安い強化から 自動で 投資", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5);
    c.add([tg, tgt, hint]);

    const close = this.add.rectangle(cx, cy + 194, 160, 38, 0xe9f1fb).setStrokeStyle(1, 0xaecbe8).setInteractive({ useHandCursor: true });
    const ct = this.add.text(cx, cy + 194, "閉じる", { fontFamily: UI_FONT, fontSize: "16px", color: "#22344a" }).setOrigin(0.5);
    close.on("pointerdown", () => this.closeUpgradePanel());
    c.add([close, ct]);
  }

  // ============================ build ============================
  buildBackground() {
    this.bgRect = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xbfe4ff).setDepth(-12); // 明るい空色（旧: 0x0a0a0f 真っ黒）
    this.edgeFlash = this.add
      .rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xffffff)
      .setDepth(50)
      .setFillStyle(0xffffff, 0);
    // 深淵：世界が紫の闇に沈む（背景の上・キャラの下）
    if (this.abyss) this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, C.ABYSS.tint, 0.34).setDepth(-4);
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
    // 地面：明るい土の道（緑の縁＋暖色のダッシュ）。旧: 真っ黒に近い藍。
    this.makeTex("ground_strip", 64, 120, (g) => {
      g.fillStyle(0xcbb083, 1); // 明るい土色
      g.fillRect(0, 0, 64, 120);
      g.fillStyle(0x8fc46a, 1); // 上端：草の縁
      g.fillRect(0, 0, 64, 6);
      g.fillStyle(0xe0cba0, 1); // 道のハイライト
      g.fillRect(0, 8, 64, 3);
      g.fillStyle(0xa9885a, 1); // 小石・轍
      [8, 24, 40, 56].forEach((x) => g.fillRect(x, 34, 6, 3));
      [16, 48].forEach((x) => g.fillRect(x, 72, 4, 3));
    });

    const horizon = this.heroY - 16;
    this.farLayer = this.add.tileSprite(this.W / 2, horizon, this.W, 130, "far_hills").setOrigin(0.5, 1).setDepth(-9).setAlpha(0.85);
    this.midLayer = this.add.tileSprite(this.W / 2, this.heroY + 32, this.W, 150, "mid_trees").setOrigin(0.5, 1).setDepth(-7).setAlpha(0.92);
    this.groundLayer = this.add.tileSprite(this.W / 2, this.heroY + 62, this.W, 250, "ground_strip").setOrigin(0.5, 0).setDepth(-5);

    // ピクセル遠景があれば採用。空グラデを画面上部まで敷き、バイオームで切替。
    if (this.textures.exists("bg_far")) {
      this.skyG = this.add.graphics().setDepth(-11); // 空グラデ（下地）
      // ピクセル背景を上端〜地面近くまで大きく敷く（1タイルで縦を埋める＝縦リピート無し）
      this.farLayer.setOrigin(0.5, 0);
      this.farLayer.y = 0;
      this.farLayer.height = this.heroY + 46;
      this.farLayer.setTexture("bg_far");
      const sc = this.farLayer.height / 144;
      this.farLayer.setTileScale(sc, sc);
      // 遠景の夜景ピクセル画は暗い。透過を下げ＋明色ティントで「昼のかすんだ遠山」にし、
      // 背後の明るい空グラデを透けさせる（= 全体が明るく）。深淵時のみ濃いめに残す。
      // 遠景の情景をしっかり見せる（0.4だと薄すぎて「どこにいるか分からない」＝場所感が消えていた）。
      this.farLayer.setAlpha(this.abyss ? 0.82 : 0.68);
      this.farLayer.setTint(this.abyss ? 0x9a7ad0 : 0xccd8ea); // 明るい空と調和する青灰。情景の輪郭は残す。
      this.midLayer.setVisible(false);
      // バイオーム（距離で移り変わる世界観）。空を明るい昼の色に（ポケモン/デジモン級の明るさ）。
      //  art＝生成アート背景キー（あれば優先。無ければ従来のピクセル遠景texへフォールバック）
      //  art＝専用の生成アート（あれば最優先）。無い間は sub＝山アートにこの色を掛けて流用（暗いピクセル夜景を出さない）。
      this.biomes = [
        { tex: "bg_far", art: "bg_biome_mountain", top: 0x7ec8ff, bot: 0xe8f6ff, name: "山鳴りの道", sub: 0xffffff }, // 晴れた青空（本物）
        { tex: "bg_far1", art: "bg_biome_forest", top: 0x9be0b4, bot: 0xf0fff4, name: "囁きの森", sub: 0x86c98f }, // 新緑がかった
        { tex: "bg_far2", art: "bg_biome_ruins", top: 0xffc98f, bot: 0xfff2e0, name: "忘れられた廃墟", sub: 0xe6b877 }, // 夕陽の琥珀
        { tex: "bg_far3", art: "bg_biome_void", top: 0xcfa8ff, bot: 0xf4eaff, name: "幽玄の境", sub: 0xb69ae6 }, // 薄紫
      ].filter((b) => this.textures.exists(b.tex));
      // アート未配置バイオームの代用に使う「実在する生成アート」（＝山）を1つ確保
      this.fallbackArt = (this.biomes.find((b) => b.art && this.textures.exists(b.art)) || {}).art || null;
      // 生成アート背景を敷く用の画像（cover表示・ゆっくり漂う）。テクスチャは setBiome で差し替え。
      //  中心を画面中央より上に置き、地平線を上げて「空を減らし景色を大きく」見せる（背景ズーム＋キャラUP）。
      this.bgCenterY = 330;
      this.biomeArtImg = this.add.image(this.W / 2, this.bgCenterY, "bg_far").setDepth(-10).setVisible(false);
      this.tweens.add({ targets: this.biomeArtImg, x: this.W / 2 + 34, duration: 17000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); // 遠景の微かな漂い

      // ── 水面リフレクション（ログウィズ風の映り込み）──
      // 背景を「水位ライン」で上下反転ミラー。青く半透明にし、横揺れ＋ハイライトで水に見せる。
      this.waterTop = this.heroY + 70; // 岸のすぐ下（足元より下）に水位
      this.waterImg = this.add.image(this.W / 2, 2 * this.waterTop - this.bgCenterY, "bg_far").setFlipY(true).setDepth(-4).setAlpha(0.55).setTint(0x7fb0dd).setVisible(false);
      // 水面帯にだけ映すマスク（空・キャラには被せない）
      const wmg = this.make.graphics({ add: false });
      wmg.fillRect(0, this.waterTop, this.W, this.H - this.waterTop);
      this.waterImg.setMask(wmg.createGeometryMask());
      this.tweens.add({ targets: this.waterImg, x: this.W / 2 + 12, duration: 4200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); // さざ波の横揺れ
      this.tweens.add({ targets: this.waterImg, alpha: 0.42, duration: 2600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); // 光の明滅
      // 岸のきわの光ライン（水面の始まりを示す）
      this.add.rectangle(this.W / 2, this.waterTop, this.W, 2, 0xdff1ff, 0.5).setDepth(-3);
      // 水面のハイライト筋（横に流れる白い反射）
      this.makeTex("water_glint", 200, 40, (g) => { g.fillStyle(0xffffff, 0.5); [8, 60, 130].forEach((x) => g.fillRect(x, 18, 40, 2)); });
      this.waterGlint = this.add.tileSprite(this.W / 2, this.waterTop + 40, this.W, 70, "water_glint").setOrigin(0.5, 0).setDepth(-3).setAlpha(0.18);

      this.curBiome = -1;
      this.setBiome(0);
    }
  }

  // 2色を乗算合成（水の反射色づくり用）。a×b/255 で暗めに混ざる。
  blendTint(a, b) {
    const r = Math.round((((a >> 16) & 255) * ((b >> 16) & 255)) / 255);
    const g = Math.round((((a >> 8) & 255) * ((b >> 8) & 255)) / 255);
    const bl = Math.round(((a & 255) * (b & 255)) / 255);
    return (r << 16) | (g << 8) | bl;
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
    // 専用アート→無ければ山アートをバイオーム色にティントして流用→それも無ければ従来のピクセル遠景。
    const ownArt = b.art && this.textures.exists(b.art) ? b.art : null;
    const useArt = ownArt || this.fallbackArt; // 代用（山）でも写実背景を出す
    if (useArt && this.biomeArtImg) {
      this.biomeArtImg.setTexture(useArt).setVisible(true);
      this.biomeArtImg.setTint(ownArt ? 0xffffff : b.sub || 0xffffff); // 代用時のみ色を掛けて別の土地に見せる
      const cover = Math.max(this.W / this.biomeArtImg.width, this.H / this.biomeArtImg.height) * 1.42; // ズームイン（旧1.12）で空を減らし景色を大きく
      this.biomeArtImg.setScale(cover);
      if (this.farLayer) this.farLayer.setVisible(false); // ピクセル遠景は隠す
      // 水面の映り込みも同じ景色に更新（青く落として反射に）
      if (this.waterImg) {
        this.waterImg.setTexture(useArt).setVisible(true).setScale(cover);
        // バイオーム色 × 水の青 を掛け合わせて、土地ごとに水の色も変える
        this.waterImg.setTint(this.blendTint(ownArt ? 0xffffff : b.sub || 0xffffff, 0x7fb0dd));
      }
    } else {
      if (this.biomeArtImg) this.biomeArtImg.setVisible(false);
      if (this.waterImg) this.waterImg.setVisible(false);
      if (this.farLayer) {
        this.farLayer.setVisible(true);
        if (this.textures.exists(b.tex)) this.farLayer.setTexture(b.tex);
      }
    }
  }

  // 進軍に合わせて各層を流す（奥ほどゆっくり＝奥行き）
  scrollWorld(d) {
    if (this.farLayer) this.farLayer.tilePositionX += d * 0.15;
    if (this.midLayer) this.midLayer.tilePositionX += d * 0.4;
    if (this.groundLayer) this.groundLayer.tilePositionX += d * 1.0;
    if (this.waterGlint) this.waterGlint.tilePositionX += d * 0.5; // 水面の光筋も流す
  }

  buildHud() {
    // 上部HUDフレーム（情報ゾーン：DRの2ゾーン指針）
    // 上部HUD帯：明るい空の上でも文字が読めるよう、やわらかい紺の半透明バナー
    this.add.rectangle(this.W / 2, 54, this.W, 108, 0x102138, 0.46).setDepth(-1);
    // 帯の下端を金の二重ヘアラインで縁取る（額縁の統一感）
    this.add.rectangle(this.W / 2, 107, this.W, 2, 0xc9a23a, 0.9).setDepth(-1);
    this.add.rectangle(this.W / 2, 109, this.W, 1, 0x7d611a, 0.8).setDepth(-1);

    this.distanceText = this.add.text(18, 12, "距離 0m", { fontFamily: UI_FONT, fontSize: "20px", color: "#e8e8ef" });
    this.coinText = this.add.text(this.W - 18, 12, "0", { fontFamily: UI_FONT, fontSize: "20px", color: "#ffd24d" }).setOrigin(1, 0); // 数字のみ
    this.coinIcon = makeIcon(this, this.W - 58, 20, "💰", 20, EMOJI_FONT); // コインアイコン（数字の左に固定配置）
    // 深淵モードのタグ（距離ラベルの隣・紫）
    if (this.abyss) this.add.text(this.W / 2, 22, `🕳 ${C.ABYSS.label}`, { fontFamily: UI_FONT, fontSize: "14px", color: "#c9a0e0", fontStyle: "bold" }).setOrigin(0.5);

    // 次の節目までの進捗バー（旗に向かって進軍する）
    const bw = this.W - 44;
    this._progW = bw;
    this._progX = this.W / 2 - bw / 2;
    this.add.rectangle(this.W / 2, 44, bw, 7, 0x1a1a28).setStrokeStyle(1, 0x2e2e46);
    this.progFill = this.add.rectangle(this._progX, 44, 2, 7, 0x6a8fd0).setOrigin(0, 0.5);
    this.progFlag = this.add.text(this._progX + bw + 2, 44, "🚩", { fontFamily: EMOJI_FONT, fontSize: "14px" }).setOrigin(0, 0.5);
    this.progLabel = this.add.text(this.W / 2, 44, "", { fontFamily: UI_FONT, fontSize: "10px", color: "#9aa0c0" }).setOrigin(0.5);
    // 目標バナー（今いる"道"の名＋次のボスまで＝没入・世界観）
    this.objectiveBanner = this.add.text(this.W / 2, 58, "", { fontFamily: UI_FONT, fontSize: "13px", color: "#d8cfc0" }).setOrigin(0.5); // 感情ゲージ行(y78)と重ならない位置へ
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
      // 戦闘中に「その戦いで兆している感情」を光らせるグロー（アイコン背後・加算合成）
      const formGlow = this.add.circle(cx - 10, y, 19, info.color, 0).setBlendMode(Phaser.BlendModes.ADD);
      const icon = makeIcon(this, cx - 10, y, info.icon, 26, EMOJI_FONT); // 感情アイコン（自作SVG）
      // makeIcon(画像)は setDisplaySize でスケールを決める。強調時に setScale で上書きすると
      // 128pxテクスチャの絶対倍率になり巨大化する不具合があったため、基準スケールを保持しておく。
      const iconBase = icon.scaleX || 1;
      const count = this.add.text(cx + 16, y, "0", { fontFamily: UI_FONT, fontSize: "16px", color: "#cfcfe0" }).setOrigin(0, 0.5);
      this.add.rectangle(cx, y + 24, 56, 6, 0x2a2a3a).setOrigin(0.5);
      const bar = this.add.rectangle(cx - 28, y + 24, 1, 6, info.color).setOrigin(0, 0.5);
      // 「今の戦い」での形成度バー（記憶バーの少し上に薄く重ねる）
      const formBar = this.add.rectangle(cx - 28, y + 19, 1, 3, info.color, 0.95).setOrigin(0, 0.5).setVisible(false);
      this.gauges[key] = { icon, iconBase, count, bar, formGlow, formBar };
    });
    // 兆している主感情のラベル（戦闘中のみ・目標バナー位置を借りる）
    this.formLabel = this.add.text(this.W / 2, 58, "", { fontFamily: UI_FONT, fontSize: "13px", color: "#d8cfc0" }).setOrigin(0.5).setDepth(6).setVisible(false);
    // 「あと N で進化」予告（主人公の上・報酬の予感で初進化を山場に）
    this.evoHint = this.add.text(0, 0, "", { fontFamily: UI_FONT, fontSize: "12px", color: "#ffe0a0", fontStyle: "bold" }).setOrigin(0.5).setDepth(7).setVisible(false);
    this._evoHintShow = false;
  }

  preload() {
    preloadIcons(this); // 絵文字→自作SVGアイコンを読込
    // 仲間・ボス・主人公進化アート（Gemini生成）。無ければ絵文字にフォールバック。
    if (!this.textures.exists("bg_far")) this.load.image("bg_far", "chars/bg_far.png"); // ピクセル遠景
    for (let i = 1; i <= 3; i++) if (!this.textures.exists("bg_far" + i)) this.load.image("bg_far" + i, "chars/bg_far" + i + ".png"); // バイオーム
    // 生成アートのバイオーム背景（有るものだけ。追加は下の配列にキーを足すだけ）
    for (const bk of ["mountain", "forest", "ruins", "void"]) if (!this.textures.exists("bg_biome_" + bk)) this.load.image("bg_biome_" + bk, "chars/bg_biome_" + bk + ".jpg"); // 未配置は404→山アートのティント流用にフォールバック
    if (!this.textures.exists("hero_slime")) this.load.image("hero_slime", "chars/hero_slime.png");
    for (const k of ["kid_boy", "kid_boy_walk", "kid_girl", "kid_girl_walk"]) if (!this.textures.exists(k)) this.load.image(k, "chars/" + k + ".png"); // 主人公(男/女)＝相棒に指示
    if (!this.textures.exists("hero_slime_atk")) this.load.image("hero_slime_atk", "chars/hero_slime_atk.png");
    if (!this.textures.exists("hero_slime_walk")) this.load.image("hero_slime_walk", "chars/hero_slime_walk.png");
    for (const sc of C.SHOP_COMPANIONS) if (!this.textures.exists("shop_" + sc.id)) this.load.image("shop_" + sc.id, "chars/shop_" + sc.id + ".png"); // 課金の特別な子
    for (const b of C.BIOME_ENEMIES || []) for (const t of b.types || []) { // バイオーム別の敵アート（無い組み合わせは404→感情別にフォールバック）
      const bk = "enemy_" + b.key + "_" + t.lean;
      if (b.key && !this.textures.exists(bk)) this.load.image(bk, "chars/" + bk + ".png");
    }
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
    return (70 + (stage || 0) * 10) / (this.heroBaseW || 384); // 存在感を上げるため一回り大きく（旧58+9）
  }

  buildArena() {
    this.heroX = 120;
    this.heroY = 388; // キャラをステージ中央寄りに（旧430）。上部の空きを減らす。
    this.enemyX = 330;
    this.enemyY = 388;

    this.add.rectangle(this.W / 2, this.heroY + 62, this.W, 2, 0x20202c);

    // 感情オーラ（①可視化：主人公が"今いちばん宿している感情の色"に染まる）
    this.heroAura = this.add.circle(this.heroX, this.heroY, 46, 0xffffff, 0).setDepth(1);

    // 接地シャドウ（浮遊感を解消）＋スピリットボディ（絵文字の背後の発光体＝存在感）
    this.heroShadow = this.add.ellipse(this.heroX, this.heroY + 44, 82, 20, 0x000000, 0.3).setDepth(0);
    this.heroBody = this.add.circle(this.heroX, this.heroY, 30, 0xffffff, 0).setDepth(1); // ピクセルではオーラ無し
    this.enemyShadow = this.add.ellipse(this.enemyX, this.enemyY + 40, 70, 18, 0x000000, 0.28).setDepth(0).setVisible(false);
    this.enemyBody = this.add.circle(this.enemyX, this.enemyY, 26, 0xff4d4d, 0.1).setDepth(1).setVisible(false);
    // ボスのアート（大きく登場）。enemySprite の位置/フェードをミラーする。
    this.enemyImg = this.textures.exists("boss_anger") ? this.add.image(this.enemyX, this.enemyY, "boss_anger").setDepth(2).setVisible(false) : null;
    this.enemyImgActive = false;
    this.enemyImgFit = 0.3;

    // 主人公：進化アートがあれば画像（段で姿とサイズが変わる）、無ければ絵文字。
    if (this.textures.exists("hero_slime")) {
      // 元絵は右向き（攻撃フレームが右へ踏み込む＝敵 enemyX=330 の方向）。反転しないのが正しい。
      // 元絵は正面〜左向き。敵は右(enemyX=330)なので反転して敵を向く（flipXはテクスチャ差替を跨いで保持）。
      this.heroSprite = this.add.image(this.heroX, this.heroY, "hero_slime").setDepth(2);
      faceEnemy(this.heroSprite, "hero_slime"); // 元絵の向きに応じて敵(右)を向く
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
    // 始まりの卵（真章）：選んだ系統の第1形態でスタート（一段育った状態＝ラスボス撃破の褒美）
    const starter = getStarterEgg();
    if (starter && this.heroIsImage && this.textures.exists("hero_" + starter + "_1")) {
      const tkey = "hero_" + starter + "_1";
      this.heroSprite.setTexture(tkey);
      faceEnemy(this.heroSprite, tkey);
      this.heroFormKey = tkey;
      this.evolvedKey = starter;
      this.evoStage = 1;
      this.evoMult *= C.EVOLUTION.statMultiplier; // 第1形態ぶんの強化を最初から
      this.heroFit = this.heroFitFor(1);
      this.heroSprite.setScale(this.heroFit);
      this._starterEgg = starter; // ヒント表示用
      this.applyRunUpgrades(); // evoMult反映（create冒頭の確定より後なので再計算）
      if (this.heroStats) this.heroStats.hp = this.heroStats.maxHp;
    }
    this.enemySprite = this.add.text(this.enemyX, this.enemyY, "", { fontFamily: EMOJI_FONT, fontSize: "56px" }).setOrigin(0.5).setDepth(2).setVisible(false);
    // 敵ネームプレート（暗い下地＋金枠）。ログウィズ風に「名前が据わる」印象へ。原点中心に描き、x/yで移動。
    this.enemyNamePlate = this.add.graphics().setDepth(2.4).setVisible(false);
    { const nw = 132, nh = 22; this.enemyNamePlate.fillStyle(0x0e0e18, 0.74); this.enemyNamePlate.fillRoundedRect(-nw / 2, -nh / 2, nw, nh, 6); this.enemyNamePlate.lineStyle(1, 0xc9a23a, 0.7); this.enemyNamePlate.strokeRoundedRect(-nw / 2, -nh / 2, nw, nh, 6); this.enemyNamePlate.fillStyle(0xf4dc86, 0.28); this.enemyNamePlate.fillRect(-nw / 2 + 2, -nh / 2 + 1, nw - 4, 1); }
    this.enemyNamePlate.setPosition(this.enemyX, this.enemyY - 50);
    this.enemyLabel = this.add.text(this.enemyX, this.enemyY - 50, "", { fontFamily: UI_FONT, fontSize: "13px", color: "#f0e6d0", stroke: "#0a0a12", strokeThickness: 3 }).setOrigin(0.5).setDepth(2.5).setVisible(false);

    // 主人公の子供（男の子/女の子）＝相棒に指示を出す。戦闘には参加しない別オーバーレイ。
    const pg = getPlayer() || { gender: "boy" };
    this.kidFormKey = "kid_" + (pg.gender === "girl" ? "girl" : "boy");
    this.kidX = this.heroX - 52;
    if (this.textures.exists(this.kidFormKey)) {
      this.kidSprite = this.add.image(this.kidX, this.heroY + 6, this.kidFormKey).setDepth(2).setScale(0.86);
      faceEnemy(this.kidSprite, this.kidFormKey); // 元絵の向きに応じて敵(右)を向く
      this.kidIsImage = true;
    } else {
      this.kidSprite = this.add.text(this.kidX, this.heroY, pg.gender === "girl" ? "👧" : "👦", { fontFamily: EMOJI_FONT, fontSize: "40px" }).setOrigin(0.5).setDepth(2);
      this.kidIsImage = false;
    }

    this.addAtmosphere(); // 周縁ビネット
    this.time.addEvent({ delay: 130, loop: true, callback: () => this.emitEmotionParticle() }); // 感情の専用パーティクル

    // HPプレート（暗い下地＋金の細枠）。バー中心=+50に合わせ、視認性と「作り込まれた」印象を出す。
    const hpPlate = (cx, cy) => {
      const gp = this.add.graphics().setDepth(1.6);
      gp.fillStyle(0x0e0e18, 0.8);
      gp.fillRoundedRect(cx - 41, cy - 8, 82, 16, 5);
      gp.lineStyle(1, 0xc9a23a, 0.75);
      gp.strokeRoundedRect(cx - 41, cy - 8, 82, 16, 5);
      gp.fillStyle(0xf4dc86, 0.3); // 上辺の光
      gp.fillRect(cx - 39, cy - 7, 78, 1);
      return gp;
    };
    this.heroHpPlate = hpPlate(this.heroX, this.heroY + 50);
    this.enemyHpPlate = hpPlate(this.enemyX, this.enemyY + 50).setVisible(false);
    this.heroHpG = this.add.graphics().setDepth(1.7);
    this.enemyHpG = this.add.graphics().setDepth(1.7);
    this.skillG = this.add.graphics().setDepth(1.7); // 技ゲージ
    // HP数値（バーの上に重ねる。狭いので短縮表記＋読みやすい縁取り）
    const hpStyle = { fontFamily: UI_FONT, fontSize: "11px", color: "#ffffff", stroke: "#0a0a12", strokeThickness: 3, fontStyle: "bold" };
    this.heroHpT = this.add.text(this.heroX, this.heroY + 50, "", hpStyle).setOrigin(0.5).setDepth(3);
    this.enemyHpT = this.add.text(this.enemyX, this.enemyY + 50, "", hpStyle).setOrigin(0.5).setDepth(3).setVisible(false);
    // ボス用の大型HPバー（上部）
    this.bossHpG = this.add.graphics().setDepth(5);
    this.bossNameT = this.add.text(this.W / 2, 124, "", { fontFamily: UI_FONT, fontSize: "15px", color: "#ffd24d" }).setOrigin(0.5).setDepth(5).setVisible(false);
    this.bossHpT = this.add.text(this.W - 30, 145, "", { fontFamily: UI_FONT, fontSize: "12px", color: "#ffffff", stroke: "#0a0a12", strokeThickness: 3, fontStyle: "bold" }).setOrigin(1, 0.5).setDepth(6).setVisible(false);
  }

  // 周縁のごく淡いフレーミング。明るい世界を保つため、暗さは最小限に。
  //  ただし下部だけは「旅のしるし（ログ）」の可読性のため、少し濃いめの藍スクリムを残す。
  addAtmosphere() {
    const c = this.abyss ? 0x140a24 : 0x22406e; // 深淵は紫、通常は淡い藍
    const g = this.add.graphics().setDepth(-1);
    const w = 70;
    const topA = this.abyss ? 0.4 : 0.1;
    const botA = this.abyss ? 0.5 : 0.32; // 下はログ背景を兼ねてやや濃く
    const sideA = this.abyss ? 0.35 : 0.08;
    g.fillGradientStyle(c, c, c, c, topA, topA, 0, 0);
    g.fillRect(0, 0, this.W, 72); // 上
    g.fillGradientStyle(c, c, c, c, 0, 0, botA, botA);
    g.fillRect(0, this.H - 120, this.W, 120); // 下（ログの下地）
    g.fillGradientStyle(c, c, c, c, sideA, 0, sideA, 0);
    g.fillRect(0, 0, w, this.H); // 左
    g.fillGradientStyle(c, c, c, c, 0, sideA, 0, sideA);
    g.fillRect(this.W - w, 0, w, this.H); // 右
  }

  // 毎フレーム、シャドウ／ボディを絵文字に追従させ、ゆっくり呼吸させる
  updatePresence(time) {
    const breath = 1 + Math.sin(time / 340) * 0.06;
    if (this.kidSprite) {
      this.kidSprite.y = this.heroY + 6 + (Math.floor(time / 260) % 2 === 0 ? 0 : -3); // 子供も跳ねる
      if (this.kidIsImage && this.mode === "walk" && this.textures.exists(this.kidFormKey + "_walk")) {
        const wk = Math.floor(time / 220) % 2 === 0 ? this.kidFormKey : this.kidFormKey + "_walk";
        if (this.kidSprite.texture.key !== wk) { this.kidSprite.setTexture(wk); faceEnemy(this.kidSprite, wk); }
      } else if (this.kidIsImage && this.kidSprite.texture.key !== this.kidFormKey) {
        this.kidSprite.setTexture(this.kidFormKey);
        faceEnemy(this.kidSprite, this.kidFormKey);
      }
    }
    if (this.heroBody) {
      this.heroBody.setPosition(this.heroSprite.x, this.heroSprite.y).setScale(breath);
      this.heroShadow.setPosition(this.heroSprite.x, this.heroY + 44).setScale(1 / breath, 1);
    }
    // 相棒＋子供の呼吸（生きてる感）。攻撃スクワッシュ/進化演出中は触らない＝スケールのドリフト防止
    if (this.heroSprite && this.heroSprite.scene && !this._heroSquash && (this.mode === "walk" || this.mode === "battle")) {
      const fit = this.heroFit || 1;
      const amp = this.mode === "battle" ? 0.03 : 0.02; // 戦闘待機は深め、進軍中はかすかなボブ
      this.heroSprite.setScale(fit, fit * (1 + Math.max(0, Math.sin(time / 286)) * amp));
    }
    if (this.kidSprite && this.kidSprite.scene && (this.mode === "walk" || this.mode === "battle")) {
      const kfit = this.kidIsImage ? 0.86 : 1;
      this.kidSprite.setScale(kfit, kfit * (1 + Math.max(0, Math.sin(time / 310)) * 0.03));
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
        this.enemyBody.setPosition(this.enemySprite.x, this.enemySprite.y - (bossA ? lift * 0.8 : 0)).setFillStyle(col, (this.enemyImgBoss ? 0.16 : 0) * this.enemySprite.alpha).setScale(breath * 0.98 * (bossA ? aura : 1)); // 雑魚はオーラ無し・ボスのみ控えめ
        this.enemyShadow.setPosition(this.enemySprite.x, this.enemyY + 44).setAlpha(0.28 * this.enemySprite.alpha).setScale(bossA ? Math.max(1.15, aura * 0.5) : 1, 1);
      }
      if (this.enemyImg && bossA) {
        // ボスは戦闘中ずっと表示・不透明で固定。決着の退場フェード中のみ enemySprite の値を反映＝途中消失の根絶。
        const resolving = !this.battle || this.battle.finished;
        const forceBoss = this.enemyImgBoss && !resolving && this.mode === "battle";
        const vis = forceBoss ? true : v;
        this.enemyImg.setVisible(vis);
        if (vis) {
          this.enemyImg
            .setPosition(this.enemySprite.x, this.enemySprite.y - lift + Math.sin(time / 520) * (this.enemyImgBoss ? 4 : 2))
            .setAlpha(forceBoss ? 1 : this.enemySprite.alpha)
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

  // 戦闘中、「その戦いで兆している感情」を4アイコンにライブ表示する。
  //  勝ち方(速攻/耐え/先制/逆転)がリアルタイムで感情に結晶化する様を"見て"分かる＝見守り型の王冠差別化。
  updateFormingEmotions(time) {
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const b = this.battle;
    const show = this.mode === "battle" && b && !b.finished && !!this.currentEnemy;
    if (this.objectiveBanner) this.objectiveBanner.setVisible(this.mode === "walk"); // 進軍中のみ表示（戦闘/死亡/進化中は隠す＝死亡時の残バナー点滅も防止）
    const R = C.EMOTION_RULES;
    let lead = null;
    let leadV = 0.14;
    const eHp = show ? Math.max(0, this.currentEnemy.hp) / this.currentEnemy.maxHp : 1;
    for (const key of C.EMOTION_ORDER) {
      const g = this.gauges[key];
      if (!g || !g.formGlow) continue;
      let v = 0;
      if (show) {
        if (key === "anger") v = clamp01((1 - eHp) * clamp01(R.angerTurns / Math.max(1, b.turnsToWin))); // 速攻で押し切る勢い
        else if (key === "sadness") v = clamp01(b.damageTaken / Math.max(1, this.heroStats.maxHp * R.sadnessDamageRatio)); // 耐えた量
        else if (key === "courage") v = b.enemyAttacked === 0 ? clamp01(1 - eHp) : 0; // 先制で削り切る（1発でも被弾で消灯）
        else if (key === "hope") v = clamp01((1 - b.minHpRatio) / Math.max(0.01, 1 - R.hopeHpRatio)); // 瀕死から（満HPでは0、勝利閾値で満）
      }
      const pulse = 1 + Math.sin(time / 240) * 0.14 * v;
      g.formGlow.setAlpha(0.55 * v).setScale((0.85 + v * 0.9) * pulse);
      if (g.formBar) {
        g.formBar.setVisible(show && v > 0.02);
        g.formBar.width = Math.max(1, 56 * v);
      }
      if (v > leadV) {
        leadV = v;
        lead = key;
      }
    }
    if (this.formLabel) {
      if (show && lead) {
        if (lead !== this._formLead) {
          const info = C.EMOTIONS[lead];
          this.formLabel.setText(`${info.icon} ${info.label} が 兆している`).setColor(colorToCss(info.color)); // 主感情が変わった時だけ再描画（毎フレームのcanvas再生成を回避）
          this._formLead = lead;
        }
        this.formLabel.setVisible(true).setAlpha(0.55 + 0.45 * Math.min(1, leadV));
      } else {
        this.formLabel.setVisible(false);
        this._formLead = null;
      }
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
    // （旧「─ 旅のしるし ─」見出しは円形スキル名と重なるため撤去。ログ帯だけ残す）
    // 行ごとに色を持てるよう、1行=1テキストで積む（感情の欠片ログをその感情色に）
    this.logTextObjs = [];
    // 手動ボタン(661〜715)と重ならないよう、ログ帯を 598〜652 にクリップ。
    const mk = this.make.graphics({ x: 0, y: 0, add: false });
    mk.fillRect(0, 598, this.W, 56);
    this._logMask = mk.createGeometryMask();
  }

  // ---- 下部操作バー（親指圏：倍速／強化／撤退。DRの2ゾーン指針）----
  buildControls() {
    this.input.keyboard.on("keydown-H", () => this.retreatToHome());

    // 操作デッキ：道テクスチャの雑然さを隠し、スキル/ログ/操作を1枚の面にまとめる（清潔感）。
    //  depth -0.5：道(-5)・ビネット(-1)より前、ボタン(6)・バー(0)より後。
    const deckTop = 524;
    const deck = this.add.graphics().setDepth(-0.5);
    deck.fillStyle(0x0e1830, 0.96);
    deck.fillRoundedRect(-10, deckTop, this.W + 20, this.H - deckTop + 12, 20);
    // 金の彫刻フレーム（左右は画面外に逃がし、上辺だけが金の額縁として見える）
    const dw = this.W + 20, dh = this.H - deckTop + 12;
    ornateFrame(deck, -10 + dw / 2, deckTop + dh / 2, dw, dh, 20, { thick: 3, inset: 5, corners: false });

    const barY = 752;
    this.add.rectangle(this.W / 2, barY, this.W, 64, 0x101a30, 0.6);

    // 倍速セグメント（"見守る速度"の操作。放置ゲーの最重要操作なので大きめ・見やすく）
    this.add.text(16, barY - 24, "速さ", { fontFamily: UI_FONT, fontSize: "11px", color: "#8a8aa0", fontStyle: "bold" }).setOrigin(0, 0.5);
    this.speedBtns = [];
    C.SPEED_STEPS.forEach((mult, i) => {
      const x = 34 + i * 44;
      const rect = this.add.rectangle(x, barY + 4, 40, 40, 0x1c1c2a).setInteractive({ useHandCursor: true });
      const gfx = this.add.graphics(); // 金枠（選択状態はrefreshSpeedBtnsで塗り替え）
      const txt = this.add.text(x, barY + 4, "×" + mult, { fontFamily: UI_FONT, fontSize: "16px", color: "#cfcfe0", fontStyle: "bold" }).setOrigin(0.5);
      const lock = this.add.text(x, barY + 4, "🔒", { fontFamily: EMOJI_FONT, fontSize: "14px" }).setOrigin(0.5).setVisible(false); // 未解放の鍵
      rect.on("pointerdown", () => this.trySetSpeed(mult));
      this.speedBtns.push({ mult, rect, txt, lock, gfx, x, y: barY + 4 });
    });
    // 起動時、保存されている速度がまだ未解放なら、解放済みの最大速度に落とす
    if (!this.speedUnlocked(this.speed)) {
      const maxOk = C.SPEED_STEPS.filter((m) => this.speedUnlocked(m)).pop() || 1;
      this.speed = maxOk;
      setPref("speed", maxOk);
    }

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

    // ⓘ ステータス確認（旅の今の強さを一覧・金の円ボタン）。デッキ右上に常時表示。
    const ix = this.W - 30, iy = 548;
    const iGlow = this.add.circle(ix, iy, 22, 0xffd24d, 0).setDepth(5);
    const iRing = this.add.graphics().setDepth(6);
    this.drawSkillRing(iRing, ix, iy, 19, 0x8fb0e0);
    const iHit = this.add.circle(ix, iy, 19, 0xffffff, 0.001).setDepth(6).setInteractive({ useHandCursor: true });
    const iTxt = this.add.text(ix, iy, "ⓘ", { fontFamily: UI_FONT, fontSize: "20px", color: "#f4dc86", fontStyle: "bold" }).setOrigin(0.5).setDepth(7);
    iHit.on("pointerdown", () => { this.tweens.add({ targets: [iRing, iTxt], scale: 0.9, duration: 70, yoyo: true }); this.openRunStatusPanel(); });

    // ---- 手動バトル操作（子供が相棒に指示）。戦闘中のみ表示 ----
    this.modeBtn = this.makeBarButton(52, 688, 92, 40, this.manualMode ? "手動" : "おまかせ", () => this.toggleManual(), { color: 0x1c2c1c, stroke: 0x4a6a4a, textColor: "#bfe0bf", fontSize: "13px" });
    this.attackBtn = this.makeBarButton(this.W / 2 - 6, 688, 138, 54, "⚔ 攻撃", () => this.doCommand(false), { color: 0x2a3a2a, stroke: 0x4caf50, textColor: "#bfffbf", fontSize: "19px" });
    this.skillBtn = this.makeBarButton(this.W - 88, 688, 138, 54, "✦ 必殺", () => this.doCommand(true), { color: 0x3a2a48, stroke: 0xb060e0, textColor: "#e6c2ff", fontSize: "19px" });
    for (const b of [this.modeBtn, this.attackBtn, this.skillBtn]) {
      b.rect.setDepth(6);
      b.txt.setDepth(6);
      if (b.gfx) b.gfx.setDepth(6);
    }

    // ---- 感情スキル（CD式アクティブ）。操作バーの上・戦闘中のみ表示 ----
    this.buildSkillButtons();

    this.setBattleActionsVisible(false);

    this.refreshSpeedBtns();
  }

  makeBarButton(x, y, w, h, label, onClick, opts = {}) {
    const rect = this.add.rectangle(x, y, w, h, opts.color ?? 0x1c1c2a).setInteractive({ useHandCursor: true });
    // 金の彫刻枠（元の stroke色は内側のアクセント罫に残す＝ボタンの色分けを維持）
    const gfx = this.add.graphics();
    ornateFrame(gfx, x, y, w, h, 8, { thick: 2, inset: 4, accent: opts.stroke ?? 0x3a3a52 });
    const txt = this.add.text(x, y, label, { fontFamily: UI_FONT, fontSize: opts.fontSize ?? "15px", color: opts.textColor ?? "#e8e8ef" }).setOrigin(0.5);
    rect.on("pointerdown", () => {
      this.tweens.add({ targets: [rect, txt], scale: 0.95, duration: 60, yoyo: true });
      onClick();
    });
    return { rect, txt, gfx };
  }

  // 倍速の解放条件：×2は第1のボス撃破、×3は第5のボス撃破（累計）。今回の旅の撃破もその場で数える。
  speedBossReq(mult) {
    return mult >= 3 ? 5 : mult >= 2 ? 1 : 0;
  }
  effectiveBossKills() {
    return (getSave().lifetime.bossKills || 0) + (this.bossKillCount || 0);
  }
  speedUnlocked(mult) {
    return this.effectiveBossKills() >= this.speedBossReq(mult);
  }

  trySetSpeed(mult) {
    if (this.speedUnlocked(mult)) {
      this.setSpeed(mult);
    } else {
      const req = this.speedBossReq(mult);
      this.pushLog(`×${mult}は 第${req}のボスを 倒すと 使える（あと ${req - this.effectiveBossKills()} 体）`);
      this.refreshSpeedBtns();
    }
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
      const unlocked = this.speedUnlocked(b.mult);
      const on = b.mult === this.speed && unlocked;
      if (!unlocked) {
        b.rect.setFillStyle(0x14141c);
        b.txt.setColor("#55556a").setAlpha(0.5);
        if (b.lock) b.lock.setVisible(true);
      } else {
        // 選択中＝金地＋金文字（ログウィズ調）。非選択は控えめな鉄色。
        b.rect.setFillStyle(on ? 0x2a2416 : 0x1c1c2a);
        b.txt.setColor(on ? "#f4dc86" : "#cfcfe0").setAlpha(1);
        if (b.lock) b.lock.setVisible(false);
      }
      // 金の彫刻枠（選択中は太く光る）
      if (b.gfx) {
        b.gfx.clear();
        ornateFrame(b.gfx, b.x, b.y, 40, 40, 7, { thick: on ? 3 : 2, inset: 4, accent: unlocked ? (on ? 0xf4dc86 : 0x3a3a52) : 0x2a2a38 });
      }
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
    if (this.paused && this.battleTimer) this.battleTimer.paused = true; // パネル等を開いた最中に生成されたタイマーは停止（閉じたら再開＝歩き込み中フリーズ防止）
  }

  // ============================ update loop ============================
  update(time, delta) {
    if (this.paused) return; // 強化パネル等を開いている間は世界を止める
    this.updateFormingEmotions(time); // 戦闘中の「兆している感情」ライブ表示（勝ち方が感情に結晶化する様を見せる）
    if (this.evoHint) {
      const on = this._evoHintShow && (this.mode === "walk" || this.mode === "battle");
      this.evoHint.setVisible(on);
      if (on) this.evoHint.setPosition(this.heroX, this.heroSprite.y - 76 + Math.sin(time / 300) * 2); // 主人公の頭上でふわり
    }
    if (this.mode === "walk") {
      const dt = Math.min(delta, 50) / 1000; // 大きなフレーム間隔(タブ復帰/低FPS)で距離がワープし節目カードやボス警告を飛ばさないよう上限
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
        if (this.heroSprite.texture.key !== wkey) { this.heroSprite.setTexture(wkey); faceEnemy(this.heroSprite, wkey); }
      }
      this.heroAura.y = this.heroSprite.y;
      this.bobCompanions(time);
      this.updatePresence(time);
      this.drawHpBars();
      this.checkProgress();
      if (this.paused) return; // 感情の岐路カードが開いたら、このフレームでのボス/遭遇開始を止める
      // 旅のイベント（分岐マス）：低頻度で出会う物語的な選択。ボス直前は見せ場を邪魔しない
      if (this.distance >= this.nextEventAt && !this._choice && !this._coach && !this._leaving && this.nextBoss - this.distance > C.TRAVEL_EVENTS.bossBuffer) {
        this.nextEventAt = this.distance + C.TRAVEL_EVENTS.minGap + Math.random() * (C.TRAVEL_EVENTS.maxGap - C.TRAVEL_EVENTS.minGap);
        this.openTravelEvent();
        if (this.paused) return; // イベントが開いたら、このフレームでのボス/遭遇開始を止める
      }
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
    // カメラのズームパンチ（ぐっと寄って戻る＝気配の圧）
    if (this.speed < 3) {
      this.cameras.main.zoomTo(1.06, 120, "Quad.easeOut");
      this.time.delayedCall(200, () => {
        if (this.cameras && this.cameras.main) this.cameras.main.zoomTo(1, 360, "Sine.easeInOut");
      });
    }
    // 周縁が暗く脈打つビネットパルス
    const vg = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x05050c, 0).setDepth(57);
    this.tweens.add({ targets: vg, fillAlpha: 0.35, duration: 220, yoyo: true, repeat: 1, onComplete: () => vg.destroy() });

    // 画面が感情色に沈む（重い気配）
    const veil = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, info.color, 0).setDepth(58);
    this.tweens.add({ targets: veil, fillAlpha: 0.2, duration: 320, yoyo: true, hold: 260, ease: "Sine.easeInOut", onComplete: () => veil.destroy() });
    this.edgeFlash.setFillStyle(info.color, 0);
    this.tweens.add({ targets: this.edgeFlash, fillAlpha: 0.36, duration: 240, yoyo: true, repeat: 2 });

    // 中央に「気配 → 名の顕現」
    const cx = this.W / 2;
    const cy = this.H / 2 - 30;
    const omen = this.add.text(cx, cy, "── 強大な気配 ──", { fontFamily: UI_FONT, fontSize: "18px", color: colorToCss(info.color) }).setOrigin(0.5).setDepth(59).setAlpha(0);
    // 名前は縁取り(stroke)＋和文フォントで。絵文字を混ぜると縁取りで文字化けするので分離。
    const nameT = this.add
      .text(cx - 40, cy + 40, t.name, { fontFamily: UI_FONT, fontSize: "28px", color: "#ffffff", fontStyle: "bold", stroke: colorToCss(info.color), strokeThickness: 4, letterSpacing: 4 })
      .setOrigin(0.5)
      .setDepth(59)
      .setAlpha(0)
      .setScale(1.35);
    // 絵文字アイコンは専用の絵文字フォントで別描画（縁取りなし＝文字化け回避）
    const iconT = this.add
      .text(cx, cy + 6, t.icon, { fontFamily: EMOJI_FONT, fontSize: "34px" })
      .setOrigin(0.5)
      .setDepth(59)
      .setAlpha(0);
    this.tweens.add({ targets: [omen, iconT], alpha: 1, duration: 260 });
    this.tweens.add({ targets: nameT, alpha: 1, x: cx, duration: 320, ease: "Quad.easeOut" }); // 横からドラマチックにスライドイン
    this.tweens.add({ targets: nameT, scale: 1, duration: 460, ease: "Back.easeOut" });
    // 名の周りに感情色の粒が集う
    for (let i = 0; i < 14; i++) {
      const ang = (Math.PI * 2 * i) / 14;
      const p = this.add.circle(cx + Math.cos(ang) * 120, cy + 34 + Math.sin(ang) * 70, 3, info.color, 0.9).setDepth(59);
      this.tweens.add({ targets: p, x: cx, y: cy + 34, alpha: 0, duration: 520, ease: "Sine.easeIn", onComplete: () => p.destroy() });
    }
    this.time.delayedCall(1500, () => {
      this.tweens.add({ targets: [omen, nameT, iconT], alpha: 0, duration: 420, onComplete: () => { omen.destroy(); nameT.destroy(); iconT.destroy(); } });
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
      this.openChoicePanel(); // 感情の岐路：どの感情に委ねるか＝進化を操縦（ボス直前の選択）
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
    if (this.heroIsImage && this.heroFormKey && this.heroSprite.texture.key !== this.heroFormKey) { this.heroSprite.setTexture(this.heroFormKey); faceEnemy(this.heroSprite, this.heroFormKey); } // 歩行→待機に戻す
    this.heroStats.hp = this.heroStats.maxHp; // 接敵の最初だけ全回復（群れの間はHP持ち越し＝圧）

    // 群れ編成（ボスは単体）。先頭と控え（右に並ぶ）。
    const groupSize = opts.boss ? 1 : this.rollGroupSize();
    const front = opts.boss ? this.makeBoss(this.distance) : this.makeEnemy(this.distance);
    this.enemyQueue = [];
    for (let i = 1; i < groupSize; i++) this.enemyQueue.push(this.makeEnemy(this.distance));
    this.spawnQueueSilhouettes();
    this.engageEnemy(front);
    this.setBattleActionsVisible(true); // 手動なら こうげき/ひっさつ を表示
    this.maybeCoach(); // 初回だけ：戦い方→感情→進化の核を教える
  }

  // 1体と交戦開始（先頭/次の敵が右から歩いて来て、到着で戦闘開始）。HPは持ち越し。
  engageEnemy(enemy) {
    this.tweens.killTweensOf(this.enemySprite); // 前の敵の撃破/浄化フェードtweenを止める（次の敵＝ボスが透明化するバグ根絶）
    this.tweens.killTweensOf(this.enemyLabel);
    if (this._dissolveFitTween) {
      this._dissolveFitTween.stop(); // 前の敵のディゾルブ膨張が enemyImgFit を上書きし続けないように
      this._dissolveFitTween = null;
    }
    this.enemySprite.y = this.enemyY; // ディゾルブ途中の浮き上がりをリセット
    this.currentEnemy = enemy;
    this.mode = "battle"; // 進化(mode=evolve)後の群れ継戦でも walk-in→startBattleTimer が動くよう再設定＝ソフトロック根絶
    this._enemyAtkToken = (this._enemyAtkToken || 0) + 1; // 前の敵の攻撃フレーム復帰タイマーを無効化（絵の取り違え防止）
    this._resolveScheduled = false; // 決着スケジュールの二重防止（手動commandとtickの競合対策）
    this._heroIdle = 0;
    this.battleTicks = 0;
    this.battle = createBattle(this.heroStats, enemy, this.companions, { skillEvery: this.skill.every, skillMult: this.skill.mult, manual: this.manualMode });

    const scale = enemy.boss ? 1.5 : 1;
    this.enemySprite.setText(enemy.icon).setVisible(true).setScale(scale).setAlpha(1);
    this.enemySprite.x = this.W + 60;
    this.enemyLabel.setText(enemy.boss ? `― ${enemy.label} ―` : enemy.label).setVisible(true).setAlpha(1).setColor(enemy.boss ? "#ffd24d" : "#f0e6d0");
    this.enemyLabel.x = this.W + 60;
    // ネームプレートは雑魚のみ（ボスは上部の大型バー）。ラベルと一緒に滑り込む。
    this.enemyNamePlate.setVisible(!enemy.boss).setPosition(this.W + 60, this.enemyY - 50);

    // 敵アート（ボス=大きく／雑魚=小さく色変異）。位置/フェードは enemySprite が駆動。
    const biomeArt = !enemy.boss && enemy.biomeKey ? "enemy_" + enemy.biomeKey + "_" + enemy.lean : null;
    const artKey = enemy.boss ? "boss_" + enemy.lean : biomeArt && this.textures.exists(biomeArt) ? biomeArt : "enemy_" + enemy.lean; // バイオーム別アート優先→無ければ感情別
    if (!this.enemyImg && this.textures.exists(artKey)) this.enemyImg = this.add.image(this.enemyX, this.enemyY, artKey).setDepth(2).setVisible(false); // 保険で遅延生成
    const hasArt = this.enemyImg && this.textures.exists(artKey);
    if (hasArt) {
      this.enemyImg.setTexture(artKey).setVisible(true).setAlpha(1).setDepth(2).setTint(enemy.tint || 0xffffff);
      faceHero(this.enemyImg, artKey); // 元絵が右向きの敵だけ反転して主人公(左)を向かせる
      const px = enemy.boss ? enemy.bossPx || 300 : Math.round(112 * (enemy.mobScale || 1)); // ボスは段階的サイズ／雑魚は個体差（存在感UP: 旧92）
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
      targets: [this.enemySprite, this.enemyLabel, this.enemyNamePlate],
      x: this.enemyX,
      duration: 420,
      ease: "Sine.easeOut",
      onComplete: () => {
        if (this.mode !== "battle" || this.currentEnemy !== enemy) return;
        if (enemy.boss) {
          this.tweens.add({ targets: this.enemySprite, scale: scale * 1.08, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
          this.bossRevealPunch();
        }
        this.startBattleTimer();
      },
    });
  }

  // 群れの決着後：控えが居れば次へ（HP持ち越し）、居なければ戦闘終了。
  afterBattleResolved() {
    if (this._leaving) return; // 撤退中は次の敵に進めない
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
      const x = this.W - 34 - i * 36;
      let s;
      if (this.textures.exists("enemy_" + e.lean)) {
        const sz = 68 * (e.mobScale || 1);
        s = this.add.image(x, this.enemyY, "enemy_" + e.lean).setDisplaySize(sz, sz).setTint(0x2a2a3c).setAlpha(0.6).setDepth(1);
      } else {
        s = this.add.text(x, this.enemyY, e.icon, { fontFamily: EMOJI_FONT, fontSize: "34px" }).setOrigin(0.5).setAlpha(0.33).setScale(0.8);
      }
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
    // 深淵：距離インフレが急＋基礎倍率（HP/ATKに効く。spdは据え置き）
    const factor = Math.pow(this.abyss ? C.ABYSS.growth : C.ENEMY_BASE.growth, distance / 10) * (this.abyss ? C.ABYSS.enemyStatMult : 1);
    // バイオーム別ロスターから選ぶ（周回マンネリ対策）。データ欠落時は従来 ENEMY_TYPES にフォールバック。
    const bi = (((this.curBiome || 0) % 4) + 4) % 4;
    const roster = (C.BIOME_ENEMIES && C.BIOME_ENEMIES[bi]) || null;
    const type = roster && roster.types && roster.types.length ? Phaser.Utils.Array.GetRandom(roster.types) : Phaser.Utils.Array.GetRandom(C.ENEMY_TYPES);
    const lean = type.lean || type.key;
    // 深部変種：一定距離以深で強化＋接頭辞（territory の奥ほど手強く）
    const deep = roster && roster.deep && distance >= C.BIOME_DEEP_DIST ? roster.deep : null;
    const hpMod = type.hpMod * (deep ? 1 + (deep.hp || 0) : 1);
    const atkMod = type.atkMod * (deep ? 1 + (deep.atk || 0) : 1);
    const hp = Math.round(C.ENEMY_BASE.hp * factor * hpMod);
    const atk = Math.max(1, Math.round(C.ENEMY_BASE.atk * factor * atkMod));
    const rawSpd = Phaser.Math.Between(C.ENEMY_BASE.spdMin, C.ENEMY_BASE.spdMax) * type.spdMod;
    // 色：アーキタイプ指定色を基調に、4割は素の色（見やすさ）。サイズも個体差。
    const tint = type.tint != null && Math.random() >= 0.4 ? type.tint : 0xffffff;
    const mobScale = 0.82 + Math.random() * 0.42;
    const label = (deep ? deep.prefix : "") + (type.name || type.label);
    return { hp, maxHp: hp, atk, spd: Math.max(1, Math.round(rawSpd)), icon: type.icon, label, lean, tint, mobScale, biomeKey: roster ? roster.key : null };
  }

  // 固定距離ボス：強敵。感情系統は順に巡る（戦い方の多様性を促す）。
  makeBoss(distance) {
    // 深淵：距離インフレが急＋基礎倍率（HP/ATKに効く）
    const abyssMult = this.abyss ? C.ABYSS.enemyStatMult : 1;
    const factor = Math.pow(this.abyss ? C.ABYSS.growth : C.ENEMY_BASE.growth, distance / 10);
    const emotion = C.EMOTION_ORDER[this.bossCount % C.EMOTION_ORDER.length];
    const t = C.BOSS.types[emotion];
    // 初ボス(100m)が硬すぎて初回の旅が1.5〜2分の殴り合いになる問題。距離で段階化し、
    // 序盤ボスは挑みやすく・深部ボスは今まで通り硬い壁に（大器晩成）。
    const distanceScale = distance <= 120 ? 0.6 : distance <= 250 ? 0.8 : 1.0; // ≈3.3 / ≈4.4 / 5.5
    // 距離ベースHP と 「主人公攻撃力×最低撃破回数」の大きい方 → 強い育成でも即溶けしない
    const distHp = C.ENEMY_BASE.hp * factor * C.BOSS.hpMult * distanceScale;
    const powerHp = (this.heroStats ? this.heroStats.atk : 20) * (C.BOSS.minHitsToKill || 30);
    const hp = Math.round(Math.max(distHp, powerHp) * abyssMult);
    const atk = Math.max(1, Math.round(C.ENEMY_BASE.atk * factor * C.BOSS.atkMult * abyssMult));
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
    // 真章の門番：エンディング到達済み＆未解放なら、500m以降のボス枠にラスボス「空白の王」が現れる
    if (distance >= C.LAST_BOSS.distance && getSave().endingSeen && !trueChapterUnlocked()) {
      const lb = C.LAST_BOSS;
      this.bossCount += 1;
      return { hp: Math.round(hp * lb.hpMult), maxHp: Math.round(hp * lb.hpMult), atk: Math.round(atk * lb.atkMult), spd, icon: lb.icon, label: lb.name, lean: emotion, boss: true, lastBoss: true, bossPx: Math.round(bossPx * 1.12), tint: 0xffffff };
    }
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

    // 感情スキルのCDを1減らす（ティック基準＝倍速でも自然にスケール）
    if (this.skillCd) {
      let cdChanged = false;
      for (const k in this.skillCd) {
        if (this.skillCd[k] > 0) {
          this.skillCd[k] -= 1;
          cdChanged = true;
        }
      }
      if (cdChanged) this.refreshSkillButtons();
    }
    // おまかせ：状況を見て自動でスキルを導く
    if (this.autoInvest && this.battle && !this.battle.finished) this.autoCastSkill();
    if (!this.battle) return; // スキルで決着→resolve済みの保険

    const events = stepBattle(this.battle);
    this.renderBattleEvents(events);
    this.drawHpBars();
    // 手動：相棒が指示待ちのまま放置されたら、やさしく自動発動（理不尽/フリーズ防止）
    if (this.battle.manual && this.battle.heroReady && !this.battle.finished) {
      this._heroIdle = (this._heroIdle || 0) + 1;
      if (this._heroIdle > 8) this.doCommand(false);
    } else {
      this._heroIdle = 0;
    }
    this.refreshBattleButtons();
    this.checkBattleFinish();
  }

  // 戦闘イベントの演出（tickと手動コマンドの両方から呼ぶ）
  renderBattleEvents(events) {
    for (const ev of events) {
      if (ev.heal) {
        this.popDamage(this.heroX, this.heroY - 38, "+" + ev.heal, "#7fff9f");
        const ally = this.companions.find((c) => c.id === ev.allyId);
        if (ally) this.playCompanionSkill(ally, true);
        this.pulseCompanion(ev.allyId);
      } else if (ev.target === "enemy") {
        const ratio = this.currentEnemy ? ev.dmg / this.currentEnemy.maxHp : 0;
        if (ev.by === "ally") {
          const ally = this.companions.find((c) => c.id === ev.allyId);
          if (ally) this.playCompanionSkill(ally, false);
          this.pulseCompanion(ev.allyId);
          this.popDamage(this.enemyX, this.enemyY - 38, ev.dmg, ev.crit ? "#ffe14d" : "#bfe0ff", ev.crit ? Math.min(1, ratio * 1.5) : ratio, { crit: ev.crit });
          this.knockback(this.enemySprite, this.enemyX, 1, Phaser.Math.Clamp(ratio, 0.2, 1));
          this.impactFlash(this.enemyX, this.enemyY, ev.crit ? 0xffd24d : 0xffffff);
          this.hitTintFlash(this.enemyVictimSprite(), this.currentEnemy ? this.currentEnemy.tint : null);
          if (ev.crit) {
            this.critSparks(this.enemyX, this.enemyY);
            this.cameras.main.shake(90, 0.004);
            this.hitStop();
          }
          sfx.hit();
        } else if (ev.skill) {
          this.lunge(this.heroSprite, this.heroX, 1, 110);
          this.heroAttackAnim();
          this.playHeroSkill(ev.dmg);
          this.heroSkillCharge = 0;
        } else {
          this.lunge(this.heroSprite, this.heroX, 1, 78);
          this.heroAttackAnim();
          this.popDamage(this.enemyX, this.enemyY - 38, ev.dmg, ev.crit ? "#ffe14d" : "#ff9a9a", ev.crit ? Math.min(1, ratio * 1.5) : ratio, { crit: ev.crit });
          this.knockback(this.enemySprite, this.enemyX, 1, Phaser.Math.Clamp(ratio, 0.2, 1));
          this.impactFlash(this.enemyX, this.enemyY, ev.crit ? 0xffd24d : 0xffffff);
          this.hitTintFlash(this.enemyVictimSprite(), this.currentEnemy ? this.currentEnemy.tint : null);
          if (ev.crit) {
            this.critSparks(this.enemyX, this.enemyY);
            this.cameras.main.shake(90, 0.004);
            this.hitStop();
          }
          sfx.hit();
          this.heroSkillCharge = Math.min(this.skill.every, this.heroSkillCharge + 1);
        }
      } else {
        const ratio = ev.dmg / this.heroStats.maxHp;
        const eColor = (this.currentEnemy && C.EMOTIONS[this.currentEnemy.lean] && C.EMOTIONS[this.currentEnemy.lean].color) || 0xffffff;
        this.lunge(this.enemySprite, this.enemyX, -1, 78);
        this.enemyAttackAnim();
        this.popDamage(this.heroX, this.heroY - 38, ev.dmg, "#ffffff", ratio);
        this.knockback(this.heroSprite, this.heroX, -1, Phaser.Math.Clamp(ratio, 0.2, 1));
        this.impactFlash(this.heroX, this.heroY, eColor);
        this.hitTintFlash(this.heroSprite, null);
        if (this.currentEnemy && this.currentEnemy.boss) this.cameras.main.shake(70, 0.003); // ボスの一撃は画面が揺れる
        sfx.heroHit();
      }
    }
  }

  // 決着のスケジュール（tick/手動コマンドどちらから来ても一度だけ）
  checkBattleFinish() {
    if (!this.battle || !this.battle.finished || this._resolveScheduled) return;
    this._resolveScheduled = true;
    if (this.battle.win) this.hitStop(); // とどめの一撃は一瞬とまる（フィニッシュの余韻）
    if (this.battle.win && this.currentEnemy && this.currentEnemy.boss) this.finisherSlowmo(0.35, 300);
    if (this.battleTimer) this.battleTimer.remove();
    this.time.delayedCall(280, this.resolveBattle, [], this);
  }

  // 手動：こうげき/ひっさつ を実行（子供が相棒に指示）
  doCommand(skill) {
    if (!this.battle || this.battle.finished || this.paused) return;
    this._heroIdle = 0;
    const r = skill ? commandSkill(this.battle) : commandAttack(this.battle);
    if (!r) return;
    this.renderBattleEvents(r.events);
    this.drawHpBars();
    this.refreshBattleButtons();
    this.checkBattleFinish();
  }

  setBattleActionsVisible(inBattle) {
    if (!this.modeBtn) return;
    const showActions = inBattle && this.manualMode;
    this.modeBtn.rect.setVisible(inBattle);
    this.modeBtn.txt.setVisible(inBattle);
    if (this.modeBtn.gfx) this.modeBtn.gfx.setVisible(inBattle);
    for (const b of [this.attackBtn, this.skillBtn]) {
      b.rect.setVisible(showActions);
      b.txt.setVisible(showActions);
      if (b.gfx) b.gfx.setVisible(showActions);
    }
    if (showActions) this.refreshBattleButtons();
    // 感情スキルの列も戦闘中のみ
    if (this.skillBtns) {
      for (const key in this.skillBtns) for (const o of this.skillBtns[key].all) o.setVisible(inBattle);
      if (inBattle) {
        this.refreshSkillButtons();
        if (!this._skillHintShown) {
          this._skillHintShown = true;
          this.pushLog("感情スキルが 使えるようになった（ボタンで発動）");
        }
      }
    }
  }

  // ---- 感情スキル（ログウィズ①：CD式アクティブ。押さなくても勝てるが、押すと戦局が動く）----
  // 円形スキルスロットの金リングを描く（外の暗リム→金→感情色の内輪→上部ハイライト）
  drawSkillRing(g, x, y, r, color) {
    g.clear();
    g.fillStyle(0x14141f, 0.96);
    g.fillCircle(x, y, r); // 台座
    g.lineStyle(4, 0x140f08, 1); g.strokeCircle(x, y, r + 1); // 暗リム
    g.lineStyle(3, 0xc9a23a, 1); g.strokeCircle(x, y, r); // 金リング
    g.lineStyle(2, color, 0.9); g.strokeCircle(x, y, r - 4); // 感情色の内輪
    g.lineStyle(1, 0xf4dc86, 0.85); // 上部の光ハイライト
    g.beginPath(); g.arc(x, y, r, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(330)); g.strokePath();
  }

  buildSkillButtons() {
    this.skillBtns = {};
    const y = this.H - 250; // 円形スロットの中心。ログ・操作バーと非重複。
    const r = 28;
    const keys = C.EMOTION_ORDER;
    keys.forEach((key, i) => {
      const def = C.ACTIVE_SKILLS.defs[key];
      const info = C.EMOTIONS[key];
      if (!def || !info) return;
      const x = this.W / 2 + (i - (keys.length - 1) / 2) * 84;
      const glow = this.add.circle(x, y, r + 5, info.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(5); // ready時の淡い光
      const ring = this.add.graphics().setDepth(6); // 金リング
      this.drawSkillRing(ring, x, y, r, info.color);
      // 当たり判定は円（透明の円をヒットに）
      const hit = this.add.circle(x, y, r, 0xffffff, 0.001).setDepth(6).setInteractive({ useHandCursor: true });
      const icon = makeIcon(this, x, y - 4, def.icon, 24, EMOJI_FONT).setDepth(7);
      const name = this.add.text(x, y + r + 10, def.name, { fontFamily: UI_FONT, fontSize: "11px", color: colorToCss(info.color), fontStyle: "bold" }).setOrigin(0.5).setDepth(7);
      const cdArc = this.add.graphics().setDepth(8).setVisible(false); // クールダウンの円弧（減っていく暗いパイ）
      const cdTxt = this.add.text(x, y, "", { fontFamily: UI_FONT, fontSize: "16px", color: "#ffffff", stroke: "#0a0a12", strokeThickness: 3, fontStyle: "bold" }).setOrigin(0.5).setDepth(9).setVisible(false);
      hit.on("pointerdown", () => { this.tweens.add({ targets: [ring, icon], scale: 0.9, duration: 70, yoyo: true }); this.castEmotionSkill(key); });
      // ready時のゆっくりした明滅
      this.tweens.add({ targets: glow, alpha: { from: 0.05, to: 0.22 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut", paused: false });
      this.skillBtns[key] = { key, x, y, r, color: info.color, glow, ring, hit, icon, name, cdArc, cdTxt, all: [glow, ring, hit, icon, name, cdArc, cdTxt] };
    });
  }

  // スキルボタンの見た目更新（CD中は暗く沈み、幕と残り数を出す）
  refreshSkillButtons() {
    if (!this.skillBtns) return;
    const total = C.ACTIVE_SKILLS.cooldownTicks || 1;
    for (const key in this.skillBtns) {
      const b = this.skillBtns[key];
      const cd = this.skillCd ? this.skillCd[key] || 0 : 0;
      const ready = cd <= 0;
      const onScreen = b.hit.visible;
      b.icon.setAlpha(ready ? 1 : 0.4);
      b.name.setAlpha(ready ? 1 : 0.55);
      if (b.glow) b.glow.setVisible(ready && onScreen); // 撃てる時だけ光る
      const show = !ready && onScreen;
      b.cdArc.clear();
      b.cdArc.setVisible(show);
      b.cdTxt.setVisible(show);
      if (show) {
        // 残りCDぶんの暗い円弧（上から時計回り・減っていく）
        const frac = Math.min(1, cd / total);
        b.cdArc.fillStyle(0x05050c, 0.62);
        b.cdArc.slice(b.x, b.y, b.r - 2, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(-90 + 360 * frac), false);
        b.cdArc.fillPath();
        b.cdTxt.setText("" + cd);
      }
    }
  }

  // おまかせ：状況を見て自動でスキルを導く（1tickに最大1発）
  autoCastSkill() {
    const b = this.battle;
    if (!b || b.finished || this.mode !== "battle") return;
    const cd = this.skillCd || {};
    if ((cd.sadness || 0) <= 0 && b.hero.hp / b.hero.maxHp < 0.45) this.castEmotionSkill("sadness");
    else if ((cd.anger || 0) <= 0 && (b.enemy.boss || b.enemy.hp > b.hero.atk * 6)) this.castEmotionSkill("anger");
    else if ((cd.anger || 0) <= 0 && (cd.courage || 0) <= 0) this.castEmotionSkill("courage");
  }

  // 感情スキルの発動（手動タップ／おまかせ自動の両方から）
  // タップ攻撃（ログウィズ流）：見守り中の指先の参加感。攻撃×0.2の追撃＋火花。連打は300msで間引く。
  tapAssist(pointer) {
    if (this.mode !== "battle" || !this.battle || this.battle.finished) return;
    if (this.paused || this.upPanel || this._choice || this._coach || this._leaving || this.careBtn) return;
    const now = this.time.now;
    if (this._lastAssist && now - this._lastAssist < 300) return;
    this._lastAssist = now;
    const b = this.battle;
    let dmg = Math.max(1, Math.round(b.hero.atk * 0.2));
    if (b.enemy.boss) dmg = Math.min(dmg, Math.max(1, Math.ceil(b.enemy.maxHp * C.BOSS.maxHitFrac * 0.5)));
    b.enemy.hp -= dmg;
    this.popDamage(this.enemyX, this.enemyY - 30, dmg, "#cfd8ff", 0.8);
    // タップ位置に小さな火花（押した実感）
    const spark = this.add.circle(pointer.worldX, pointer.worldY, 4, 0xffffff, 0.9).setDepth(80);
    this.tweens.add({ targets: spark, scale: 2.2, alpha: 0, duration: 200, ease: "Quad.easeOut", onComplete: () => spark.destroy() });
    if (b.enemy.hp <= 0) {
      b.enemy.hp = 0;
      forceFinish(b); // 通常の感情判定・決着フローに乗せる
    }
    this.drawHpBars();
    this.checkBattleFinish();
  }

  // 長押し連続強化（ログウィズ流QoL）：買うたびパネルは作り直されるが、離せば止まる
  beginUpgradeHold(key) {
    this.stopUpgradeHold();
    this._holdDelay = window.setTimeout(() => {
      this._holdTimer = window.setInterval(() => {
        if (!this.upPanel || !this.buyUpgrade(key)) {
          this.stopUpgradeHold();
          return;
        }
        this.buildUpgradePanel();
      }, 200);
    }, 450);
  }
  stopUpgradeHold() {
    if (this._holdDelay) {
      window.clearTimeout(this._holdDelay);
      this._holdDelay = null;
    }
    if (this._holdTimer) {
      window.clearInterval(this._holdTimer);
      this._holdTimer = null;
    }
  }

  castEmotionSkill(key) {
    if (this.paused || this.upPanel || this._choice || this._coach || this._leaving) return; // パネル/チュートリアル中は撃てない
    if (this.mode !== "battle" || !this.battle || this.battle.finished) return;
    if (!this.skillCd || (this.skillCd[key] || 0) > 0) return;
    const def = C.ACTIVE_SKILLS.defs[key];
    const info = C.EMOTIONS[key];
    if (!def || !info) return;
    const b = this.battle;

    if (key === "anger") {
      // 焦熱：攻撃×3の一撃（ボスは即溶け防止の上限あり）
      let dmg = Math.max(1, Math.round(b.hero.atk * def.dmgMult));
      if (b.enemy.boss) dmg = Math.min(dmg, Math.max(1, Math.ceil(b.enemy.maxHp * C.BOSS.maxHitFrac)));
      b.enemy.hp -= dmg;
      this.popDamage(this.enemyX, this.enemyY - 40, dmg, "#ff8a4d", 1, { skillGlow: "#ff5a3c" });
      this.impactFlash(this.enemyX, this.enemyY, 0xff6a3c);
      this.knockback(this.enemySprite, this.enemyX, 1, 1);
      this.cameras.main.shake(110, 0.004);
      if (b.enemy.hp <= 0) {
        b.enemy.hp = 0;
        forceFinish(b); // HP比較で勝ち＝通常の感情判定・決着フローに乗る
      }
    } else if (key === "sadness") {
      // 鎮魂：最大HPの35%を癒す
      const heal = Math.round(b.hero.maxHp * def.healRatio);
      b.hero.hp = Math.min(b.hero.maxHp, b.hero.hp + heal);
      this.popDamage(this.heroX, this.heroY - 40, "+" + heal, "#7fdfff");
      this.impactFlash(this.heroX, this.heroY, info.color);
      this.flashEdge(key);
    } else if (key === "courage") {
      // 疾風：行動ゲージが一気に貯まる（次tickで連続行動）
      b.heroGauge += C.COMBAT.atbThreshold * def.gaugeBoost;
      for (let i = 0; i < 3; i++) {
        const streak = this.add.rectangle(this.heroX - 60, this.heroY - 20 + i * 16, 34, 2, 0xffffff, 0.85).setDepth(45);
        this.tweens.add({ targets: streak, x: this.heroX + 70, alpha: 0, duration: 240 + i * 60, ease: "Quad.easeOut", onComplete: () => streak.destroy() });
      }
    } else if (key === "hope") {
      // 祈り：次の3撃が必ず会心（combat.js の heroAct が消費）
      b.forcedCrits = (b.forcedCrits || 0) + def.critHits;
      this.impactFlash(this.heroX, this.heroY - 20, 0xfff0c0);
      this.flashEdge(key);
    }

    this.skillCd[key] = C.ACTIVE_SKILLS.cooldownTicks;
    sfx.skill();
    this.pushLog(`${def.icon} ${def.name}が ほとばしった`, colorToCss(info.color));
    this.drawHpBars();
    this.refreshSkillButtons();
    this.checkBattleFinish();
  }

  refreshBattleButtons() {
    if (!this.attackBtn || !this.battle || !this.manualMode || this.mode !== "battle") return;
    // ready の合図はボタン全体（地・金枠・文字）の明滅で（rectへの直strokeは金枠と喧嘩するため廃止）
    const ready = !!this.battle.heroReady && !this.battle.finished;
    const setDim = (b, on) => { b.rect.setAlpha(on ? 1 : 0.5); b.txt.setAlpha(on ? 1 : 0.6); if (b.gfx) b.gfx.setAlpha(on ? 1 : 0.45); };
    setDim(this.attackBtn, ready);
    setDim(this.skillBtn, heroSkillReady(this.battle));
  }

  toggleManual() {
    this.manualMode = !this.manualMode;
    setPref("manual", this.manualMode);
    if (this.battle) this.battle.manual = this.manualMode;
    if (this.modeBtn) this.modeBtn.txt.setText(this.manualMode ? "手動" : "おまかせ");
    this.setBattleActionsVisible(this.mode === "battle");
  }

  resolveBattle() {
    if (this._leaving) return; // 撤退中に遅延コールバックが漏れても二重処理しない
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
    if (this.enemyNamePlate) this.enemyNamePlate.setVisible(false);
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
        this.playEnemyDissolve(); // 撃破：白く灼けて、影の残滓を残しながら溶けて消える
      }

      let reward = Math.round((3 + Math.floor(this.distance / 10)) * (1 + this.coinBonus / 100));
      if (isBoss) {
        reward *= C.BOSS.rewardMult;
        this.bossKillCount = (this.bossKillCount || 0) + 1; // 旅のボス討伐数（帰還時の記録用）
        // ラスボス「空白の王」撃破 → 真章「本来の物語」解放
        if (this.currentEnemy.lastBoss && markTrueChapter()) {
          this.pushLog("🕳 空白の王が 崩れ落ちた ── 真章「本来の物語」が 解放された");
          for (const ln of C.LAST_BOSS.defeatLines) this.pushLog(ln);
        }
        // 倍速の解放をその場で反映（×2=第1ボス / ×3=第5ボス）＋解放時の告知
        const totalNow = this.effectiveBossKills();
        if (totalNow === this.speedBossReq(2)) this.pushLog("⚡ ×2倍速が 解放された！");
        if (totalNow === this.speedBossReq(3)) this.pushLog("⚡ ×3倍速が 解放された！");
        this.refreshSpeedBtns();
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
      if (this.abyss) reward = Math.round(reward * C.ABYSS.coinMult); // 深淵：コイン報酬が跳ねる
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
      this.pushLog(this.emotionLogLine(this.battle), colorToCss((C.EMOTIONS[firstKey] && C.EMOTIONS[firstKey].color) || 0xb8b8c8)); // 欠片ログはその感情の色で灯す

      // 素材＋装備ドロップ（ホームの制作・装備につながる）
      addMaterials(this.battle.emotions);
      let drop = rollEquipmentDrop(this.distance);
      if (this.abyss && !drop && Math.random() < C.ABYSS.dropBonus) drop = rollEquipmentDrop(this.distance); // 深淵：外れたらもう一度（+10%相当）
      if (drop) {
        const rar = C.EQUIPMENT.rarities.find((r) => r.key === drop.rarity);
        this.pushLog(`🎁 装備「${drop.name}〈${rar.label}〉」を拾った`);
      }

      this.advanceCompanionVoices(); // 同行で「声」が育つ（設計書§17-2）

      const evoOptions = this.computeEvolutionOptions(); // 進化できる姿の候補（自分で選ぶ）
      if (evoOptions.length) {
        if (this.autoInvest) {
          this.time.delayedCall(500, () => this.doEvolution(evoOptions[0])); // おまかせ：自動で進化（見守りでも育つ）
        } else {
          this.time.delayedCall(420, () => this.openEvolutionChoicePanel(evoOptions)); // 自分で すがたを えらぶ
        }
      } else {
        this.afterBattleResolved(); // 群れに控えが居れば次へ、居なければ終了
      }
    } else {
      this.onDeath();
    }
  }

  endBattle() {
    if (this._leaving) return; // 撤退中は戦闘終了処理（mode=walk化）を走らせない
    this.setBattleActionsVisible(false);
    this.clearQueueSilhouettes();
    this.enemyQueue = [];
    this.enemySprite.setVisible(false);
    this.enemyLabel.setVisible(false);
    if (this.enemyNamePlate) this.enemyNamePlate.setVisible(false);
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
    if (this.careBtn) return;
    const lead = leadingEmotion(this.emotions);
    if (!lead.key || lead.value <= 0) return;
    // 初回だけは確定で出し、意味を1度だけ説明する（30%抽選だと初見で理解されないため）。
    // 永続prefで一度きり：距離60m未満・初ケア機会でのみ発火。
    if (!getPref("careSeen") && this.distance < 60) {
      setPref("careSeen", true);
      this.pushLog("気持ちが あふれた…『受けとめる』を タップすると 心が 軽くなる");
      this.triggerCare(lead.key);
      return;
    }
    if (this.evolved && Math.random() < 0.5) return; // 進化後は控えめ
    if (Math.random() >= C.CARE.chance) return;
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

  // 拮抗が成立する 混合/三重 の候補（配列）。闇堕ちは出さない＝無害化（明るいゲームへ）。
  resolveMixOptions() {
    const ranked = C.EMOTION_ORDER.map((k) => ({ key: k, value: this.emotions[k] })).sort((a, b) => b.value - a.value);
    const lead = ranked[0].value;
    if (lead <= 0) return [];
    const ratio = C.MIXED_EVOLUTION.ratio;
    const out = [];
    if (ranked[2].value > 0 && ranked[2].value >= lead * ratio) {
      const missing = ranked[3].key;
      const form = C.TRIPLE_EVOLUTION.forms[missing];
      if (form && tripleUnlocked(missing)) out.push({ ...form, kind: "triple" }); // アンロックA：構成3系統を図鑑記録で解放
    }
    if (ranked[1].value > 0 && ranked[1].value >= lead * ratio) {
      const pair = [ranked[0].key, ranked[1].key].sort((a, b) => C.EMOTION_ORDER.indexOf(a) - C.EMOTION_ORDER.indexOf(b)).join("+");
      const form = C.MIXED_EVOLUTION.forms[pair];
      if (form && mixUnlocked(pair)) out.push({ ...form, kind: "double" }); // アンロックA：両系統の第1形態を記録で解放
    }
    return out;
  }

  // いま「えらべる」進化の候補リスト（単一の段階形態＋拮抗成立の混合/三重）。
  computeEvolutionOptions() {
    if (this.evoSpecial) return [];
    const nextStage = this.evoStage + 1;
    if (nextStage > 3) return [];
    const opts = [];
    if (nextStage === 1) {
      const lead = leadingEmotion(this.emotions);
      if (!lead.key || lead.value < this.evoThresholds[0]) return [];
      const f = C.EVOLUTION_STAGES.forms[lead.key][0];
      opts.push({ key: lead.key, name: f.name, label: f.label, icon: f.icon, color: C.EMOTIONS[lead.key].color, kind: "stage", stage: 1 });
      for (const m of this.resolveMixOptions()) opts.push({ ...m, key: lead.key, stage: 1 }); // 限定進化路線
    } else {
      const key = this.evolvedKey;
      if (!key) return [];
      if ((this.emotions[key] || 0) < this.evoThresholds[nextStage - 1]) return [];
      const f = C.EVOLUTION_STAGES.forms[key][nextStage - 1];
      opts.push({ key, name: f.name, label: f.label, icon: f.icon, color: C.EMOTIONS[key].color, kind: "stage", stage: nextStage });
    }
    return opts;
  }

  // 進化の姿を「自分で」えらぶカードパネル（感情の岐路UIを踏襲）。見送りも可。
  openEvolutionChoicePanel(options) {
    if (this._choice || this._leaving || this.mode !== "battle") {
      this.afterBattleResolved();
      return;
    }
    this.paused = true;
    if (this.battleTimer) this.battleTimer.paused = true;
    const cards = options.slice(0, 3);
    const c = this.add.container(0, 0).setDepth(215);
    c.add(this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x05050c, 0.82).setInteractive());
    c.add(this.add.text(this.W / 2, 150, "── 進化の刻 ──", { fontFamily: UI_FONT, fontSize: "20px", color: "#ffd24d", fontStyle: "bold" }).setOrigin(0.5));
    c.add(this.add.text(this.W / 2, 182, "どの姿を選ぶ？", { fontFamily: UI_FONT, fontSize: "14px", color: "#e8e8ef" }).setOrigin(0.5));
    const cardW = 130;
    const gap = 10;
    const total = cards.length * cardW + (cards.length - 1) * gap;
    let x = this.W / 2 - total / 2 + cardW / 2;
    const cardY = this.H / 2 + 12;
    for (const form of cards) {
      const seen = formSeen(form.name); // アンロックB：未記録の姿はシルエット＋？？？（選ぶと判明）
      const card = this.add.rectangle(x, cardY, cardW, 208, 0x14141f, 0.98).setStrokeStyle(2, seen ? form.color || 0xffffff : 0x55556a).setInteractive({ useHandCursor: true });
      const icon = this.add.text(x, cardY - 64, seen ? form.icon : "？", { fontFamily: EMOJI_FONT, fontSize: "44px", color: seen ? "#ffffff" : "#3a3a4a" }).setOrigin(0.5);
      if (!seen) icon.setAlpha(0.85); // シルエット感
      const title = this.add.text(x, cardY - 6, seen ? form.name : "？？？", { fontFamily: UI_FONT, fontSize: "15px", color: seen ? colorToCss(form.color || 0xffffff) : "#8a8aa0", align: "center", wordWrap: { width: cardW - 12 } }).setOrigin(0.5);
      const kindLabel = form.kind === "triple" ? "三重進化" : form.kind === "double" ? "混合進化" : "進化";
      const desc = this.add.text(x, cardY + 42, seen ? `〈${form.label}〉\n${kindLabel}` : `〈？？？〉\n${kindLabel}（未発見）`, { fontFamily: UI_FONT, fontSize: "12px", color: "#b8b8c8", align: "center", lineSpacing: 4, wordWrap: { width: cardW - 14 } }).setOrigin(0.5);
      // どの姿でも初進化はステータス強化される、を明示（何が起きるか分からない不安をなくす）
      const gainTxt = `攻撃・HP ×${C.EVOLUTION.statMultiplier}`;
      const gain = this.add.text(x, cardY + 84, gainTxt, { fontFamily: UI_FONT, fontSize: "11px", color: "#bfffbf", align: "center", wordWrap: { width: cardW - 14 } }).setOrigin(0.5);
      const picked = form;
      card.on("pointerover", () => card.setFillStyle(0x1e1e2c, 0.98));
      card.on("pointerout", () => card.setFillStyle(0x14141f, 0.98));
      card.on("pointerdown", () => this.chooseEvolution(c, picked));
      c.add([card, icon, title, desc, gain]);
      x += cardW + gap;
    }
    const skip = this.add.text(this.W / 2, this.H - 92, "まだ進化しない", { fontFamily: UI_FONT, fontSize: "14px", color: "#8a8aa0" }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    skip.on("pointerdown", () => this.chooseEvolution(c, null));
    c.add(skip);
    this._choice = c;
  }

  chooseEvolution(container, form) {
    if (this._choice !== container) return;
    container.destroy(true);
    this._choice = null;
    this.paused = false;
    if (form) this.doEvolution(form); // 選んだ姿へ（doEvolutionのonCompleteでafterBattleResolved）
    else this.afterBattleResolved(); // 進化を見送って次へ
  }

  // ============================ evolution（多段進化：スライム→獣→戦士→化身）============================
  doEvolution(form) {
    if (this._leaving) return; // 撤退中に進化コールバックが漏れても発火させない
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
                faceEnemy(this.heroSprite, tkey); // 進化後も向きを再判定
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

            // 覚醒の波紋：感情色のリングが広がり、12粒の光が弾ける
            const ring = this.add.circle(this.heroX, this.heroSprite.y, 30, color, 0).setStrokeStyle(3, color, 0.9).setDepth(62).setScale(0.01);
            this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 620, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
            for (let i = 0; i < 12; i++) {
              const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
              const p = this.add.circle(this.heroX, this.heroSprite.y, 3, color, 0.95).setDepth(62);
              this.tweens.add({
                targets: p,
                x: this.heroX + Math.cos(ang) * (60 + Math.random() * 40),
                y: this.heroSprite.y + Math.sin(ang) * (60 + Math.random() * 40),
                alpha: 0,
                scale: 0.3,
                duration: 520,
                ease: "Quad.easeOut",
                onComplete: () => p.destroy(),
              });
            }

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
              .text(this.W / 2, this.H / 2 - 110, `相棒は "${dispName}"\n〈${species}〉${named ? "へ 進化した" : "に 目覚めた"}`, {
                fontFamily: UI_FONT,
                fontSize: "23px",
                color: "#ffffff",
                align: "center",
                lineSpacing: 6,
                wordWrap: { width: this.W - 60 },
              })
              .setOrigin(0.5)
              .setDepth(62)
              .setAlpha(0)
              .setScale(0.6);
            this.tweens.add({ targets: nameTxt, alpha: 1, y: this.H / 2 - 124, duration: 700 });
            this.tweens.add({ targets: nameTxt, scale: 1, duration: 520, ease: "Back.easeOut" }); // 新しい名がスケールインで立ち上がる
            const evoTag =
              form.kind === "triple" ? "（三重混合）" : form.kind === "dark" ? "（闇堕ち）" : form.kind === "double" ? "（混合進化）" : form.stage === 3 ? "（化身）" : form.stage === 2 ? "（戦士）" : "";
            this.pushLog(`✨ 相棒は "${dispName}"〈${species}〉になった${evoTag}`);
            recordForm(dispName); // 感情図鑑に刻む
            this.refreshEvoHint(); // 段階が進んだので次の進化目標に更新

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
    if (this.upPanel || this._choice || this._coach || this._leaving) return; // パネル/カード/チュートリアル中はホットキー撤退も禁止（宙ぶらり防止）
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
    const run = { distance: this.distance, emotions: { ...this.emotions }, evolved: this.evolved, kills: this.kills, abyss: !!this.abyss, bossKills: this.bossKillCount || 0 };
    const summary = transmigrate(run);
    summary.emotions = run.emotions;
    summary.died = died;
    // 仲間の去就を確定（魂の絆で繋がる／光に還る）。設計書§17
    const fate = commitRunCompanions([...this.companions, ...(this.recruitedThisRun || [])], this.distance);
    summary.companionsBonded = fate.newlyBonded.map((c) => ({ name: c.name, icon: c.icon }));
    summary.companionsDispersed = fate.dispersed;
    summary.hatched = fate.hatched ? { name: fate.hatched.name, icon: fate.hatched.icon, roleLabel: fate.hatched.roleLabel } : null;
    summary.newEgg = fate.newEgg ? { emotion: fate.newEgg.emotion } : null;
    // 4つの感情をすべて理解した者には、一度だけ「統合」が訪れる（§17-4）
    if (empathyUnlocked()) {
      const ek = this.determineEndingKey(); // 生涯の主感情/均衡/絶望で分岐
      if (ek && !endingCollected(ek)) {
        if (ek === "balance") this.playEnding(summary); // 均衡=統合の真エンド
        else this.playEmotionEnding(summary, ek); // 主感情/闇堕ちの分岐エンド
        return;
      }
    }
    this.playEpilogue(summary);
  }

  // ── タイプライター表示（物語テキストを1文字ずつ出す）──
  //  tap で即時完了できるよう this._twActive で進行中を管理する。
  typewrite(t, full, opts = {}) {
    const speed = opts.speed ?? 30; // 1文字あたりms
    t.setText("");
    t.setAlpha(1);
    const rec = { t, full, ev: null, done: false };
    let i = 0;
    rec.ev = this.time.addEvent({
      delay: speed,
      loop: true,
      callback: () => {
        if (!t.scene || !t.active) { rec.done = true; rec.ev.remove(); return; } // 破棄済みテキストへの書き込み防止
        i++;
        t.setText(full.slice(0, i));
        if (i >= full.length) {
          rec.done = true;
          rec.ev.remove();
          if (this._twActive) this._twActive = this._twActive.filter((r) => !r.done);
          if (opts.onDone) opts.onDone();
        }
      },
    });
    (this._twActive = this._twActive || []).push(rec);
    return rec;
  }
  // 進行中のタイプを全部即完了。1つでも完了させたら true（＝この入力は"早送り"で消費、送りには使わない）。
  flushTypewriters() {
    if (!this._twActive || !this._twActive.length) return false;
    let flushed = false;
    for (const rec of this._twActive) {
      if (!rec.done) {
        if (rec.ev) rec.ev.remove();
        rec.t.setText(rec.full);
        rec.done = true;
        flushed = true;
      }
    }
    this._twActive = [];
    return flushed;
  }

  // 主感情/均衡/絶望で分岐するエンディングの種類を決める。
  //  この旅の感情(this.emotions)で判定＝岐路カードや戦い方で結末を操縦できる（プレイヤーの主体性）。
  determineEndingKey() {
    // 闇堕ちエンドは廃止（明るいゲームへ）。dark は返さない。
    const em = this.emotions || {};
    const vals = C.EMOTION_ORDER.map((k) => em[k] || 0);
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const max = Math.max(...vals);
    if (max <= 0) return null; // 感情ゼロの旅（即撤退など）はエンディング判定なし＝真エンドの誤付与防止
    if (max / total <= 0.34) return "balance"; // どの感情も突出しない＝統合(true)
    return C.EMOTION_ORDER[vals.indexOf(max)];
  }

  endingDef(key) {
    const D = {
      anger: { icon: "🔥", color: C.EMOTIONS.anger.color, dexForm: "焔の精霊", close: "怒りは、愛のかたち。",
        beats: [
          [{ text: "君が 拾い集めた 感情の中で、" },{ text: "いちばん熱かったのは ── 怒り。", color: "#ffbfae" }],
          [{ text: "それは 弱さではなかった。" }, { text: "大切なものを 守る、焔だった。", color: "#ffbfae" }],
          [{ text: "怒りは ── 大切なものを" }, { text: "守るための、力になった。", color: "#ffbfae" }],
        ] },
      sadness: { icon: "💧", color: C.EMOTIONS.sadness.color, dexForm: "雫の精霊", close: "悲しみは、優しさの器。",
        beats: [
          [{ text: "君が 拾い集めた 感情の中で、" },{ text: "いちばん深かったのは ── 悲しみ。", color: "#bfe0ff" }],
          [{ text: "涙は 弱さではなかった。" }, { text: "誰かの痛みを 知る、深さだった。", color: "#bfe0ff" }],
          [{ text: "涙は ── 誰かの痛みを" }, { text: "分かち合う、優しさになった。", color: "#bfe0ff" }],
        ] },
      courage: { icon: "⚡", color: C.EMOTIONS.courage.color, dexForm: "雷の精霊", close: "勇気は、優しさの脚。",
        beats: [
          [{ text: "君が 拾い集めた 感情の中で、" },{ text: "いちばん速かったのは ── 勇気。", color: "#ffe9a0" }],
          [{ text: "前へ出る力は 弱さではなかった。" }, { text: "怖さを 知って なお、進む光。", color: "#ffe9a0" }],
          [{ text: "怖さを 知って なお ──" }, { text: "前へ進む、力になった。", color: "#ffe9a0" }],
        ] },
      hope: { icon: "✨", color: 0xfff0c0, dexForm: "灯の精霊", close: "希望は、消えない灯。",
        beats: [
          [{ text: "君が 拾い集めた 感情の中で、" },{ text: "いちばん静かだったのは ── 希望。", color: "#fff4e6" }],
          [{ text: "それは 弱さではなかった。" }, { text: "どんな闇でも 消えなかった、灯。", color: "#fff4e6" }],
          [{ text: "希望は ── どんな夜も" }, { text: "消えない、灯になった。", color: "#fff4e6" }],
        ] },
      dark: { icon: "🌑", color: 0x5a3a6a, dexForm: "澱の精霊", close: "闇を抱いて なお、心は 心。",
        beats: [
          [{ text: "幾度も 瀕死を 越えた。" }, { text: "感情は 澱み、影を 帯びた。", color: "#c9a0e0" }],
          [{ text: "だが 闇もまた ── キミだった。" }, { text: "堕ちることすら、生きた証。", color: "#c9a0e0" }],
          [{ text: "ふしぎな ちからも、" }, { text: "ぜんぶ キミの いちぶ。", color: "#c9a0e0" }],
        ] },
    };
    return D[key] || D.hope;
  }

  // 主感情/闇堕ちのエンディング（統合=真エンドは playEnding）。図鑑に精霊として刻み、収集＝再訪動機に。
  playEmotionEnding(summary, key) {
    this.mode = "epilogue";
    this.dismissCare();
    if (this.battleTimer) this.battleTimer.remove();
    const def = this.endingDef(key);
    recordEnding(key);
    if (!getSave().endingSeen) markEndingSeen();
    recordForm(def.dexForm);
    sfx.ending();

    const cx = this.W / 2;
    const c = this.add.container(0, 0).setDepth(320);
    const veil = this.add.rectangle(cx, this.H / 2, this.W, this.H, 0x06060c, 0).setInteractive();
    const tintR = this.add.rectangle(cx, this.H / 2, this.W, this.H, def.color, 0);
    c.add([veil, tintR]);
    this.tweens.add({ targets: veil, fillAlpha: 0.95, duration: 900 });
    this.tweens.add({ targets: tintR, fillAlpha: 0.12, duration: 1500 });

    const hero = this.add.text(cx, this.H / 2 - 200, def.icon, { fontFamily: EMOJI_FONT, fontSize: "56px" }).setOrigin(0.5).setAlpha(0);
    c.add(hero);
    this.tweens.add({ targets: hero, alpha: 1, duration: 1200, delay: 500 });
    this.tweens.add({ targets: hero, scale: 1.08, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    const hint = this.add.text(cx, this.H - 52, "タップしてつづける", { fontFamily: UI_FONT, fontSize: "13px", color: "#6a6a80" }).setOrigin(0.5).setAlpha(0);
    c.add(hint);
    this.tweens.add({ targets: hint, alpha: 1, duration: 900, delay: 900 });

    const dyn = this.add.container(0, 0);
    c.add(dyn);
    const my = this.H / 2 + 20;
    const T = (y, str, opts = {}) => {
      const t = this.add.text(cx, y, "", { fontFamily: UI_FONT, fontSize: opts.size || "19px", color: opts.color || "#efeae2", align: "center", lineSpacing: 9, wordWrap: { width: this.W - 64 } }).setOrigin(0.5);
      dyn.add(t);
      this.typewrite(t, str, { speed: 42 }); // 1文字ずつ（物語の"間"を作る）
      return t;
    };
    const beats = def.beats.map((lines) => () => lines.forEach((ln, i) => T(my - 22 + i * 42, ln.text, ln)));
    beats.push(() => {
      T(my - 12, `── "${def.dexForm}" ──`, { size: "24px", color: "#fff4e6" });
      T(my + 34, def.close, { size: "15px", color: "#cfc6ba" });
    });
    let idx = -1;
    const next = () => {
      if (this.flushTypewriters()) return; // タイプ中のタップは"早送り"に消費（送らない）
      idx += 1;
      if (idx >= beats.length) {
        this.input.off("pointerdown", next);
        this.tweens.add({ targets: c, alpha: 0, duration: 700, onComplete: () => this.scene.start("HomeScene", { summary }) });
        return;
      }
      dyn.removeAll(true);
      beats[idx]();
    };
    this.time.delayedCall(1100, () => {
      next();
      this.input.on("pointerdown", next);
    });
  }

  // ============================ 感情統合エンディング（§17-4：二層構造の真実）============================
  playEnding(summary) {
    this.mode = "epilogue";
    this.dismissCare();
    if (this.battleTimer) this.battleTimer.remove();
    markEndingSeen();
    recordEnding("balance"); // 統合=均衡の真エンドを収集
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
      const t = this.add.text(cx, y, "", { fontFamily: UI_FONT, fontSize: opts.size || "20px", color: opts.color || "#efeae2", align: "center", lineSpacing: 9, wordWrap: { width: this.W - 64 } }).setOrigin(0.5);
      dyn.add(t);
      this.typewrite(t, str, { speed: 42 }); // 1文字ずつ
      return t;
    };

    const my = this.H / 2 + 30;
    const beats = [
      () => {
        T(my - 20, "── すべての感情を、識った ──", { size: "22px" });
        T(my + 28, "喜びも、悲しみも、恐れも、そして希望も。", { size: "14px", color: "#cfc6ba" });
      },
      () => {
        T(my - 8, "君と相棒は 数えきれない感情を拾い、\nここまで歩いてきた。", { size: "17px", color: "#efeae2" });
      },
      () => {
        T(my - 16, "涙に暮れた夜も、\n恐れに足がすくんだ日もあった。", { size: "16px", color: "#cfc6ba" });
        T(my + 48, "けれど ── その すべてが、力になった。", { size: "16px", color: "#ffd9a0" });
      },
      () => {
        // 色が あかるく もどる
        this.tweens.add({ targets: warm, fillAlpha: 0.22, duration: 1400 });
        sfx.ending();
        T(my - 8, "感情は、弱さではなかった。", { size: "23px", color: "#fff4e6" });
        T(my + 36, "そのすべてが、君を大きくする力だった。", { size: "15px", color: "#e6dccf" });
      },
      () => {
        // 育った相棒に、プレイヤーが名をつける
        let nm = getSave().spiritName;
        if (!nm) {
          const input = typeof window !== "undefined" && window.prompt ? window.prompt("育った相棒に、名を授けよう", "") : "";
          nm = (input || "").trim().slice(0, 12);
          if (!nm) nm = "ヒカリ";
          setSpiritName(nm);
        }
        T(my - 12, `── "${nm}" ──`, { size: "26px", color: "#fff4e6" });
        T(my + 34, "君と相棒が 分かち合った、記憶の名。", { size: "14px", color: "#cfc6ba" });
      },
      () => {
        T(my - 30, "「ありがとう」", { size: "30px", color: "#ffffff" });
        T(my + 24, "たくさんの感情を、ありがとう。\nさあ ── 次の旅へ。", { size: "14px", color: "#e6dccf" });
      },
    ];

    let idx = -1;
    const next = () => {
      if (this.flushTypewriters()) return; // タイプ中のタップは早送りに消費
      idx += 1;
      if (idx >= beats.length) {
        this.input.off("pointerdown", next);
        this.tweens.add({ targets: c, alpha: 0, duration: 800, onComplete: () => this.scene.start("HomeScene", { summary }) });
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
        this.tweens.add({ targets: c, alpha: 0, duration: 500, onComplete: () => this.scene.start("HomeScene", { summary }) });
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
      // 節目の跳ね（ローグウィズ流）：10/100の大台を跨いだら金色で強調
      if (summary.soulMilestone) {
        const mega = summary.soulMilestone === "mega";
        const mt = T(dyn, y, mega ? `★★ 超激強化！ 魂が大きく跳ねた` : `★ 超強化！ 節目を越えた`, { size: mega ? "19px" : "17px", color: mega ? "#ffd24d" : "#ffe08a" });
        if (mt) { mt.setScale(0.6); this.tweens.add({ targets: mt, scale: 1, duration: 460, ease: "Back.easeOut" }); } // 跳ねる演出
        y += 34;
      }
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

    // ※ テーマ（「感情は、弱さではない」等の核心）は死亡サマリーでは出さない。
    //   エンディング（playEnding / playEmotionEnding）まで伏せて、真の見せ場で回収する。

    return beats;
  }

  onDeath() {
    if (this.reviveItems > 0) {
      this.reviveFromItem();
      return;
    }
    this.setBattleActionsVisible(false); // 手動ボタンを隠す
    this.mode = "dead";
    this.battle = null;
    this.enemyLabel.setVisible(false);
    if (this.enemyNamePlate) this.enemyNamePlate.setVisible(false);
    this.tweens.killTweensOf(this.enemySprite);
    sfx.death();
    this.pushLog("相棒は 力尽きた ── 今日はここまで。（集めた感情は、消えない）");
    this.tweens.add({ targets: this.heroSprite, alpha: 0.55, duration: 400 });
    this.popDamage(this.heroX, this.heroY - 40, "💫", "#ffe08a");
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
    if (this.enemyNamePlate) this.enemyNamePlate.setVisible(false);
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
    // 主人公のHP数値（現在/最大）
    if (this.heroHpT) this.heroHpT.setText(`${fmtShort(this.heroStats.hp)}/${fmtShort(this.heroStats.maxHp)}`);
    const inBattle = this.mode === "battle" && this.currentEnemy;
    const boss = inBattle && this.currentEnemy.boss;
    if (inBattle && !boss) {
      this.drawBar(this.enemyHpG, this.enemyX - 35, this.enemyY + 46, 70, 8, Math.max(0, this.currentEnemy.hp) / this.currentEnemy.maxHp);
      if (this.enemyHpT) this.enemyHpT.setVisible(true).setText(`${fmtShort(Math.max(0, this.currentEnemy.hp))}/${fmtShort(this.currentEnemy.maxHp)}`);
      if (this.enemyHpPlate) this.enemyHpPlate.setVisible(true);
    } else {
      this.enemyHpG.clear();
      if (this.enemyHpT) this.enemyHpT.setVisible(false);
      if (this.enemyHpPlate) this.enemyHpPlate.setVisible(false);
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
      if (this.bossHpT) this.bossHpT.setVisible(true).setText(`${fmtShort(Math.max(0, this.currentEnemy.hp))} / ${fmtShort(this.currentEnemy.maxHp)}`);
    } else {
      this.bossHpG.clear();
      this.bossNameT.setVisible(false);
      if (this.bossHpT) this.bossHpT.setVisible(false);
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
        this.impactFlash(this.enemyX, this.enemyY, color);
        this.hitTintFlash(this.enemyVictimSprite(), this.currentEnemy ? this.currentEnemy.tint : null);
        this.popDamage(this.enemyX, this.enemyY - 40, dmg, colorToCss(color), 1, { skillGlow: colorToCss(color) });
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

  // ダメージ数字。opts.crit=会心（大きく金色でポップ）、opts.skillGlow=技（感情色の残光を背負う）
  popDamage(x, y, dmg, color, ratio = 0, opts = {}) {
    const big = Phaser.Math.Clamp(ratio, 0, 1);
    let size = Math.round(18 + big * 22); // 大ダメージほど大きく
    let jitter = 10;
    if (opts.crit) {
      size = Math.round(size * 1.6);
      color = "#ffd24d";
      jitter = 14; // 会心は着弾がブレる
    } else if (!opts.skillGlow) {
      size = Math.round(size * (1 + big * 0.15)); // 通常ヒットもダメージ量で最大+15%の揺らぎ
    }
    const px = x + Phaser.Math.Between(-jitter, jitter);
    // 技：ひと回り大きい半透明の残光を背後に（感情色のにじみ）
    if (opts.skillGlow) {
      const g = this.add
        .text(px, y, "" + dmg, { fontFamily: UI_FONT, fontSize: Math.round(size * 1.2) + "px", color: opts.skillGlow, fontStyle: "bold" })
        .setOrigin(0.5)
        .setAlpha(0.35)
        .setDepth(39);
      this.tweens.add({ targets: g, y: y - 42, alpha: 0, scale: 1.15, duration: 600, onComplete: () => g.destroy() });
    }
    const pop = opts.crit ? 1.4 : 1 + big * 0.4;
    const t = this.add
      .text(px, y, "" + dmg, { fontFamily: UI_FONT, fontSize: size + "px", color, fontStyle: "bold" })
      .setOrigin(0.5)
      .setScale(pop)
      .setDepth(40);
    if (opts.crit) this.tweens.add({ targets: t, scale: 1.0, duration: 120, ease: "Back.easeOut" }); // 1.4→1.0のスケールポップ
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, duration: 600, delay: opts.crit ? 100 : 0, onComplete: () => t.destroy() });
  }

  // 踏み込み（攻撃側が相手へ素早く突っ込んでクラッシュ→戻る）。"戦ってる感"の核。
  lunge(sprite, homeX, dir, dist = 78) {
    this._impulse(sprite, homeX, dir * dist, Math.max(45, 100 / Math.max(1, this.speed)));
  }

  // ノックバック（溜め→吹き飛び）。homeX に必ず戻す。
  knockback(sprite, homeX, dir, power = 0.4) {
    this._impulse(sprite, homeX, dir * (6 + 12 * power), Math.max(35, 70 / Math.max(1, this.speed)));
  }

  // 突進/ノックバックの共通処理：スプライトごとに最新の衝撃だけを効かせる。
  //  同一tickで相反する2つのx tween（被弾ノックバック＋反撃突進）が衝突するカクつき、
  //  倍速時に攻撃モーションが途中で素に戻る問題を解消。durationは倍速に連動。
  _impulse(sprite, homeX, offset, duration) {
    if (sprite._impulseTween) {
      sprite._impulseTween.stop(); // onCompleteを発火させず停止（古い x=homeX スナップを防ぐ）
      sprite._impulseTween = null;
      sprite.x = homeX;
    }
    const tw = this.tweens.add({
      targets: sprite,
      x: homeX + offset,
      duration,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => {
        if (sprite._impulseTween === tw) {
          sprite.x = homeX;
          sprite._impulseTween = null;
        }
      },
    });
    sprite._impulseTween = tw;
  }

  // ============================ ジュース（打撃感）ヘルパー ============================
  // ヒットストップ：一瞬だけ世界が止まる（会心・とどめ用）。実時間の setTimeout で必ず復帰。
  //  すでに停止中なら重ねない（timeScaleが戻らない事故の防止）。3倍速は速度優先で無効。
  hitStop(ms = 70) {
    if (this._hitStopTid || this.speed >= 3) return;
    this.time.timeScale = 0.25;
    this.tweens.timeScale = 0.25;
    this._hitStopTid = window.setTimeout(() => {
      this._hitStopTid = null;
      if (this.time) this.time.timeScale = 1;
      if (this.tweens) this.tweens.timeScale = 1;
    }, ms);
  }

  // 被弾地点の放射フラッシュ（小さな円が弾けて消える）
  impactFlash(x, y, color = 0xffffff) {
    if (this.speed >= 3) return; // 3倍速は軽量化
    const c = this.add.circle(x, y, 20, color, 0.7).setDepth(44).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: c, scale: 1.6, alpha: 0, duration: 140, ease: "Quad.easeOut", onComplete: () => c.destroy() });
  }

  // 会心の火花：小さな欠片が放射状に飛び散り、重力で落ちながら消える
  critSparks(x, y, color = 0xffd24d) {
    if (this.speed >= 3) return;
    for (let i = 0; i < 6; i++) {
      const p = this.add.rectangle(x, y, 2, 2, color).setDepth(44);
      const ang = Math.random() * Math.PI * 2;
      const sp = 26 + Math.random() * 34;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * sp,
        y: y + Math.sin(ang) * sp * 0.7 + 22, // 落下ぶんを足す＝重力っぽく
        alpha: 0,
        duration: 300,
        ease: "Quad.easeOut",
        onComplete: () => p.destroy(),
      });
    }
  }

  // 被弾の白フラッシュ。バイオーム等の setTint を使うスプライトは元の色に戻す（clearTintで色が飛ばないように）
  hitTintFlash(spr, restoreTint) {
    if (!spr || !spr.scene || typeof spr.setTintFill !== "function") return;
    spr.setTintFill(0xffffff);
    this.time.delayedCall(60, () => {
      if (!spr || !spr.scene) return;
      if (restoreTint != null && restoreTint !== 0xffffff) spr.setTint(restoreTint);
      else spr.clearTint();
    });
  }

  // いま見えている敵の本体（アート表示中は enemyImg、絵文字なら enemySprite）
  enemyVictimSprite() {
    return this.enemyImgActive && this.enemyImg ? this.enemyImg : this.enemySprite;
  }

  // 敵の死亡ディゾルブ：白く灼ける→浮き上がりつつ溶けて消える＋影の残滓が立ちのぼる。
  //  engageEnemy 側が enemySprite の tween を kill して状態を再設定するため、群れの次戦とは競合しない。
  playEnemyDissolve() {
    const enemy = this.currentEnemy;
    const spr = this.enemySprite;
    if (!spr || !spr.scene) return;
    this.hitTintFlash(this.enemyVictimSprite(), enemy ? enemy.tint : null);
    // 影の残滓（敵の感情色を帯びた暗い粒）がゆらり と立ちのぼる
    if (this.speed < 3) {
      const base = (enemy && C.EMOTIONS[enemy.lean] && C.EMOTIONS[enemy.lean].color) || 0x8888aa;
      for (let i = 0; i < 8; i++) {
        const w = this.add.circle(this.enemyX + Phaser.Math.Between(-22, 22), this.enemyY + Phaser.Math.Between(-18, 14), 3 + Math.random() * 3, base, 0.5).setDepth(44);
        this.tweens.add({
          targets: w,
          y: w.y - 34 - Math.random() * 26,
          x: w.x + Phaser.Math.Between(-10, 10),
          alpha: 0,
          scale: 0.4,
          duration: 380 + Math.random() * 240,
          ease: "Sine.easeOut",
          onComplete: () => w.destroy(),
        });
      }
    }
    // 本体：ふわりと浮きながら少し膨らみ、溶けるように消える（enemyImg は alpha/位置をミラーして追従）
    const prevScale = spr.scale;
    if (this._dissolveFitTween) this._dissolveFitTween.stop();
    if (this.enemyImgActive) {
      this._dissolveFitTween = this.tweens.add({ targets: this, enemyImgFit: this.enemyImgFit * 1.15, duration: 260, ease: "Sine.easeOut" });
    }
    this.tweens.add({
      targets: spr,
      alpha: 0,
      scale: prevScale * 1.15,
      y: this.enemyY - 10,
      duration: 260,
      ease: "Sine.easeOut",
      onComplete: () => {
        if (!spr || !spr.scene) return;
        spr.setVisible(false).setScale(1).setAlpha(1).setPosition(this.enemyX, this.enemyY);
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

  // 決定的瞬間のスローモー（ボス撃破など）。見守り型ゲームは"間"が見せ場。3倍速は速度優先で無効。
  //  time/tweens の timeScale を落とすと自前の遅延では戻せないため、実時間の setTimeout で復帰。
  finisherSlowmo(scale = 0.4, ms = 260) {
    if (this.speed >= 3) return;
    this.time.timeScale = scale;
    this.tweens.timeScale = scale;
    window.setTimeout(() => {
      if (this.time) this.time.timeScale = 1;
      if (this.tweens) this.tweens.timeScale = 1;
    }, ms);
  }

  // ボス登場のカメラ・パンチ（軽くズームして戻る＝"大きな気配"の迫力）。3倍速は無効。
  bossRevealPunch() {
    if (this.speed >= 3 || !this.cameras || !this.cameras.main) return;
    this.cameras.main.zoomTo(1.06, 240, "Sine.easeOut");
    this.time.delayedCall(320, () => {
      if (this.cameras && this.cameras.main) this.cameras.main.zoomTo(1, 520, "Sine.easeInOut");
    });
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
      const g = this.gauges[key];
      const emphasis = key === lead.key && lead.value > 0 ? 1.22 : 1;
      g.icon.setScale((g.iconBase || 1) * emphasis); // 基準スケール×強調（巨大化を防ぐ）
    }
    this.updateHeroAura(lead);
    this.refreshEvoHint();
  }

  // 次の進化までの対象感情と残り量（stage0=主感情／以降=最初に進化した感情の道）
  evolutionHintInfo() {
    if (this.evoSpecial || this.evoStage >= 3) return null;
    let key;
    let cur;
    let target;
    if (this.evoStage === 0) {
      const lead = leadingEmotion(this.emotions);
      if (!lead.key) return null;
      key = lead.key;
      cur = lead.value;
      target = this.evoThresholds[0];
    } else {
      key = this.evolvedKey;
      if (!key) return null;
      cur = this.emotions[key] || 0;
      target = this.evoThresholds[this.evoStage];
    }
    if (cur <= 0) return null; // まだ何も宿していない
    return { key, remaining: Math.max(0, Math.ceil(target - cur)), ratio: Phaser.Math.Clamp(cur / target, 0, 1) };
  }

  // 「あと N で進化」予告を更新（感情獲得時・進化直後に呼ぶ）
  refreshEvoHint() {
    if (!this.evoHint) return;
    const info = this.evolutionHintInfo();
    if (!info) {
      this._evoHintShow = false;
      return;
    }
    const em = C.EMOTIONS[info.key];
    const near = info.ratio >= 0.75; // 目前は強調
    this.evoHint.setText(near ? `${em.icon} 進化まで あと ${info.remaining}！` : `${em.icon} あと ${info.remaining} で進化`).setColor(near ? colorToCss(em.color) : "#ffe0a0");
    this._evoHintShow = true;
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

  // line=本文、color=行の色（感情の欠片ログはその感情色で灯る）
  pushLog(line, color = "#b8b8c8") {
    this.logLines.push({ text: line, color });
    if (this.logLines.length > 2) this.logLines.shift(); // 帯を狭めたので2行に
    // 1行=1テキストで作り直し、下端から積み上げる（折り返しても重ならない）
    if (this.logTextObjs) for (const t of this.logTextObjs) t.destroy();
    this.logTextObjs = [];
    let y = 650; // 手動ボタンの上でクリップ（被り解消）
    for (let i = this.logLines.length - 1; i >= 0; i--) {
      const ln = this.logLines[i];
      const t = this.add
        .text(this.W / 2, y, ln.text, { fontFamily: UI_FONT, fontSize: "14px", color: ln.color, align: "center", lineSpacing: 5, wordWrap: { width: this.W - 40 } })
        .setOrigin(0.5, 1);
      if (this._logMask) t.setMask(this._logMask);
      this.logTextObjs.push(t);
      y -= t.height + 5;
    }
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
        // きらめきのオーラ／✨は本体に追従
        if (o.aura) o.aura.setPosition(o.spr.x, o.spr.y);
        if (o.spark) o.spark.setPosition(o.spr.x, o.spr.y - 22);
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
    if (!light && !comp.shopId && o.spr.type === "Image" && this.textures.exists("char_" + comp.emotion + "_atk")) {
      o.spr.setTexture("char_" + comp.emotion + "_atk");
      faceEnemy(o.spr, "char_" + comp.emotion + "_atk"); // 攻撃フレームも実測の向きで判定（FACE_LEFT参照）
      const ctok = (o._atkToken = (o._atkToken || 0) + 1);
      this.time.delayedCall(220, () => {
        if (ctok !== o._atkToken) return; // 連撃中は古いタイマーで素の絵に戻さない
        if (o.spr && o.spr.scene && o.spr.type === "Image" && this.textures.exists("char_" + comp.emotion)) { o.spr.setTexture("char_" + comp.emotion); faceEnemy(o.spr, "char_" + comp.emotion); }
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
    faceEnemy(this.heroSprite, atk); // 攻撃フレームも実測の向きで判定（左向きの絵は反転して敵へ向ける）
    const fit = this.heroFit || 1;
    if (this.speed < 3) {
      this._heroSquash = true; // スクワッシュ中は呼吸スケールを止める（tweenとの取り合い防止）
      this.tweens.add({
        targets: this.heroSprite,
        scaleX: fit * 1.12,
        scaleY: fit * 0.92,
        duration: 90,
        yoyo: true,
        onComplete: () => {
          if (this.heroSprite && this.heroSprite.scene) this.heroSprite.setScale(fit);
          this._heroSquash = false;
        },
      });
    }
    const htok = (this._heroAtkToken = (this._heroAtkToken || 0) + 1);
    this.time.delayedCall(Math.max(80, 240 / Math.max(1, this.speed)), () => {
      if (htok !== this._heroAtkToken) return; // 連撃中は古いタイマーで素の絵に戻さない
      if (this.heroSprite && this.heroSprite.scene && this.heroIsImage && this.textures.exists(this.heroFormKey)) { this.heroSprite.setTexture(this.heroFormKey); faceEnemy(this.heroSprite, this.heroFormKey); }
    });
  }

  // 敵の攻撃モーション：攻撃フレームへ差替（拡大は updatePresence が維持）。
  // ボス=boss_ / 雑魚=enemy_ を正しく参照（取り違え防止）。最新の攻撃だけが素の絵に戻す＝技が途切れない。
  enemyAttackAnim() {
    if (!this.enemyImg || !this.enemyImgActive || !this.currentEnemy) return;
    const base = (this.currentEnemy.boss ? "boss_" : "enemy_") + this.currentEnemy.lean;
    const atk = base + "_atk";
    if (!this.textures.exists(atk)) return; // 攻撃フレームが無い敵は差替えず素の絵のまま（取り違え・消失を防ぐ）
    const token = (this._enemyAtkToken = (this._enemyAtkToken || 0) + 1);
    this.enemyImg.setTexture(atk);
    faceHero(this.enemyImg, atk); // 攻撃フレームも主人公向きに（boss_hope/sadness_atk は元絵が右向き）
    const hold = Math.max(90, 260 / Math.max(1, this.speed)); // 倍速でも間延びしない
    this.time.delayedCall(hold, () => {
      if (token !== this._enemyAtkToken) return; // 後続の攻撃が来ていれば古いタイマーは戻さない
      if (this.enemyImg && this.enemyImgActive && this.currentEnemy && this.textures.exists(base)) {
        this.enemyImg.setTexture(base);
        faceHero(this.enemyImg, base); // 素の絵に戻すときも向きを追従
      }
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
    if (!this.recruitedThisRun) this.recruitedThisRun = [];
    this.recruitedThisRun.push(comp); // ロスターに迎える（バトル隊列には並べない＝ごちゃつき解消）
    recordBond(emotion);
    const info = C.EMOTIONS[emotion];
    const rar = C.COMPANION.rarities.find((r) => r.key === comp.rarity) || C.COMPANION.rarities[0];

    // 光になって主人公へ降りる（"迎えた"演出。隊列には加えない）
    const r0 = opts.big ? 30 : 22;
    const glow = this.add.circle(this.enemyX, this.enemyY, r0, rar.color, 0.95).setDepth(46);
    const ring = this.add.circle(this.enemyX, this.enemyY, r0, info.color, 0).setStrokeStyle(2, rar.color, 0.8).setDepth(46);
    this.tweens.add({ targets: ring, scale: opts.big ? 2.4 : 1.8, alpha: 0, duration: 620, onComplete: () => ring.destroy() });
    this.tweens.add({ targets: glow, x: this.heroX, y: this.heroY - 4, scale: 0.3, alpha: 0, duration: 650, ease: "Sine.easeInOut", onComplete: () => glow.destroy() });

    const verb = opts.big ? "が 心を開いて 仲間になった" : "が 光となって ついてきた";
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
    const body = this.add.circle(bx, by, 26, bodyColor, 0).setDepth(1); // ピクセルではオーラ無し（影のみ）
    // 相棒アート（課金の特別な子は専用アート）。無ければ絵文字。fitScale＝settled時の拡大率。
    const cKey = comp.shopId && this.textures.exists("shop_" + comp.shopId) ? "shop_" + comp.shopId : "char_" + comp.emotion;
    let spr, fitScale;
    if (this.textures.exists(cKey)) {
      spr = this.add.image(bx, by, cKey).setDepth(2);
      faceEnemy(spr, cKey); // 仲間も元絵の向きに応じて敵(右)を向く
      fitScale = (comp.shopId ? 58 : 54) / spr.width; // 特別な子は少し大きく
    } else {
      spr = this.add.text(bx, by, comp.icon, { fontFamily: EMOJI_FONT, fontSize: "32px" }).setOrigin(0.5).setDepth(2);
      fitScale = 0.85;
    }
    spr.setScale(0);
    const nm = this.add.text(bx, by, comp.name, { fontFamily: UI_FONT, fontSize: "11px", color: "#9a9aac" }).setOrigin(0.5).setDepth(2).setVisible(false);
    // きらめき個体（色違い）：金色の加算オーラ＋✨で「特別な子」に見せる（収集A）
    let aura = null;
    let spark = null;
    if (comp.shiny) {
      aura = this.add.circle(bx, by, 22, 0xfff0a0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(1);
      this.tweens.add({ targets: aura, scale: 1.28, alpha: 0.22, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); // ゆっくり脈打つ
      spark = this.add.text(bx, by - 22, "✨", { fontFamily: EMOJI_FONT, fontSize: "16px" }).setOrigin(0.5).setDepth(3);
    }
    this.companionSprites[comp.id] = { spr, nm, body, shadow, aura, spark, baseX: bx, baseY: by, fitScale };
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
