// =====================================================================
//  HomeScene.js  ── ホーム（拠点）。ゲームはここから始まる。
//  設計書§13（拠点画面）準拠。出発／装備変更／制作／アイテム／お知らせ。
//  倒れると（転生して）ここに戻る。
// =====================================================================

import Phaser from "phaser";
import * as C from "../data/config.js";
import { onFirstGesture, setMuted, isMuted, sfx, setMusicMood } from "../logic/audio.js";
import {
  getSave,
  resetSave,
  computeHeroStats,
  toggleEquip,
  isEquipped,
  craftEquipment,
  craftItem,
  itemCount,
  markIntroSeen,
  getPlayer,
  setPlayer,
  markPlayerChosen,
  markNoticesRead,
  getPref,
  setPref,
  effectiveEquipSlots,
  empathyUnlocked,
  unlockNode,
  carryoverSlots,
  rosterSlotInfo,
  buyRosterSlot,
  toggleCompanionActive,
  releaseCompanion,
  getArtifactBonuses,
  nodeLevel,
  nodeMax,
  nodeCost,
  collectIdleProduction,
  townLevel,
  isShopOwned,
  buyShopCompanion,
  companionUpgradeCost,
  upgradeCompanion,
  isSaveFailing,
  exportSave,
  importSave,
  formSeen,
  achievementList,
  claimAchievement,
  unclaimedAchievementCount,
  masteryInfo,
  abyssUnlocked,
  abyssActive,
  setAbyss,
  canUnlockAnyNode,
} from "../data/save.js";
import { cloudConfigured, getUser } from "../data/cloud.js";
import { openAccountOverlay } from "../ui/authOverlay.js";
import { preloadIcons, makeIcon, iconTexFor } from "../data/icons.js";

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';
const DISPLAY_FONT = '"Shippori Mincho", "Hiragino Mincho ProN", serif'; // 見出し用の明朝（文芸的な空気）

function colorToCss(n) {
  return "#" + n.toString(16).padStart(6, "0");
}

// お知らせ（運営／物語）。物語タブはテーマと地続きの掲示板。
const NOTICES = {
  ops: [
    { id: "op1", title: "v0.2 ホーム＆転生 実装", body: "倒れても記憶は残り、魂が育つようになりました。ホームから何度でも旅立てます。" },
    { id: "op2", title: "装備ドロップ開始", body: "冒険中、まれに「感情の残響」を拾えます。ここで装備しましょう。" },
    { id: "op3", title: "v0.3 制作 実装", body: "集めた素材から装備『感情の残響』を作れるようになりました。奥へ進むほど強い装備が作れます。" },
    { id: "op4", title: "v0.4 導く心のツリー 実装", body: "旅から「悟り」を得て、キミ自身（導く心）が育つようになりました。ツリーの強化は転生してもリセットされません。4つの感情を理解すると、中央に「共感」の枝が芽吹きます。" },
    { id: "op5", title: "v0.5 仲間 実装", body: "倒した感情が ごく稀に浄化され、ついてくるようになりました。仲間は旅であなたを助け、少しずつ言葉を取り戻します。けれど転生では連れて行けません ── 仲間は光に還ります。出会った数だけが、残ります。" },
    { id: "op6", title: "統合の境地", body: "導く心のツリーで「怒り・悲しみ・勇気・希望」の4枝をすべて開くと（共感の境地）、次の旅の終わりに ── 一度だけ、何かが訪れます。" },
  ],
  story: [
    { id: "st1", title: "どこかの声", body: "……わかってほしかった。ただ、それだけだったんだ。" },
    { id: "st2", title: "忘れられた灯", body: "だれも見ていなくても、その子は歩き続けていた。" },
  ],
};

export default class HomeScene extends Phaser.Scene {
  constructor() {
    super("HomeScene");
  }

  preload() {
    preloadIcons(this); // 絵文字→自作SVGアイコンを読込
    // 仲間の相棒アート＋主人公スライム＋pixel遠景（Gemini生成）。無ければ絵文字にフォールバック。
    for (const k of C.EMOTION_ORDER) {
      if (!this.textures.exists("char_" + k)) this.load.image("char_" + k, "chars/comp_" + k + ".png");
    }
    if (!this.textures.exists("hero_slime")) this.load.image("hero_slime", "chars/hero_slime.png");
    if (!this.textures.exists("bg_far")) this.load.image("bg_far", "chars/bg_far.png");
    if (!this.textures.exists("bg_home")) this.load.image("bg_home", "chars/bg_home.jpg"); // 生成アートの動く背景（軽量JPEG）
    if (!this.textures.exists("bg_home_fg")) this.load.image("bg_home_fg", "chars/bg_home_fg.png"); // 手前の草花（透過）
    if (!this.textures.exists("town_nest")) this.load.image("town_nest", "chars/town_nest.png"); // 卵の巣
    for (const k of ["kid_boy", "kid_boy_walk", "kid_girl", "kid_girl_walk", "egg"]) if (!this.textures.exists(k)) this.load.image(k, "chars/" + k + ".png"); // 主人公(男/女)＋たまご
    for (const k of C.EMOTION_ORDER) {
      if (!this.textures.exists("town_" + k)) this.load.image("town_" + k, "chars/town_" + k + ".png"); // 街の場所
    }
    for (const sc of C.SHOP_COMPANIONS) if (!this.textures.exists("shop_" + sc.id)) this.load.image("shop_" + sc.id, "chars/shop_" + sc.id + ".png"); // 課金の特別な子
    // 図鑑用：主人公の進化形態
    for (const k of C.EMOTION_ORDER) {
      for (let s = 1; s <= 3; s++) {
        const key = "hero_" + k + "_" + s;
        if (!this.textures.exists(key)) this.load.image(key, "chars/" + key + ".png");
      }
    }
  }

  // 仲間ポートレート（課金の特別な子は専用アート／画像／絵文字）。float=浮遊。b=bonded記録(任意)
  charPortrait(x, y, emotion, size, emojiFallback, float, b) {
    const shopKey = b && b.shopId && this.textures.exists("shop_" + b.shopId) ? "shop_" + b.shopId : null;
    const key = shopKey || (this.textures.exists("char_" + emotion) ? "char_" + emotion : null);
    let obj;
    if (key) {
      obj = this.add.image(x, y, key).setDisplaySize(size, size);
    } else {
      obj = this.add.text(x, y, emojiFallback, { fontFamily: EMOJI_FONT, fontSize: Math.round(size * 0.6) + "px" }).setOrigin(0.5);
    }
    if (float) {
      this.tweens.add({ targets: obj, y: y - 6, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    return obj;
  }

  init(data) {
    this.fromRun = data && data.summary ? data.summary : null;
  }

  create() {
    this.W = C.GAME_WIDTH;
    this.H = C.GAME_HEIGHT;
    this.panel = null;
    // 背景：生成アートの「動く風景」＝パララックス。奥(遠景)はゆっくり、手前(草花)は速めに流れて奥行きを出す。
    const skyG = this.add.graphics().setDepth(-21); // 万一ロード前でも空色の下地
    skyG.fillGradientStyle(0x8fc8f0, 0x9fd0ee, 0xc4e8e0, 0xeef0d6, 1, 1, 1, 1);
    skyG.fillRect(0, 0, this.W, this.H);
    // ゆっくりした「カメラの横パン」を再現：奥も手前も"同じ向き・同じ周期"で漂わせ、
    //  手前ほど大きく動かす＝視差。向きや周期がバラバラだと不自然に滑って見えるため揃える。
    const PAN = 22; // 奥の振れ幅（px）。手前はこの約2.4倍。
    const PERIOD = 20000; // 共通周期（位相ロック）
    if (this.textures.exists("bg_home")) {
      const bg = this.add.image(this.W / 2 - PAN, this.H / 2, "bg_home").setDepth(-20); // 左寄りから開始＝±PANで中心対称
      const cover = Math.max(this.W / bg.width, this.H / bg.height) * 1.16; // 画面を覆い、パン用の余白を持たせる
      bg.setScale(cover);
      this.tweens.add({ targets: bg, x: this.W / 2 + PAN, duration: PERIOD, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    if (this.textures.exists("bg_home_fg")) {
      const fg = this.add.image(this.W / 2 - PAN * 2.4, this.H + 8, "bg_home_fg").setOrigin(0.5, 1).setDepth(-14); // 手前は大きく振る
      fg.setScale(Math.max((this.W + 200) / fg.width, 0.34)); // 画面幅＋パン余白を覆う
      this.tweens.add({ targets: fg, x: this.W / 2 + PAN * 2.4, duration: PERIOD, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); // 奥と同じ向き・同周期＝自然なパン
    }
    // ごく薄いビネット（四辺をほんのり締める・暗くしすぎない）
    this.add.rectangle(this.W / 2, 20, this.W, 40, 0x2a4a6a, 0.1).setDepth(-12);
    this.add.rectangle(14, this.H / 2, 28, this.H, 0x2a4a6a, 0.06).setDepth(-12);
    this.add.rectangle(this.W - 14, this.H / 2, 28, this.H, 0x2a4a6a, 0.06).setDepth(-12);

    // 音：設定反映＋初回操作で解錠
    setMuted(getPref("muted"));
    this.input.once("pointerdown", onFirstGesture);
    setMusicMood("home"); // 夜のピアノ（安らぎ）

    const s = getSave();
    if (!s.player || !s.player.chosen) {
      this.runOnboarding();
      return;
    }
    this.buildHome();
    if (this.fromRun) this.time.delayedCall(150, () => this.showReturnSummary(this.fromRun));
  }

  // ---- intro（初回のみ）----
  playIntro() {
    const lines = [
      "かつて、人は感情を捨てた。",
      "捨てられた想いは 世界の裏側で\n小さなモンスターになった。",
      'キミは それを見守る "心"。',
      "ここは、旅の灯がともる場所。\n［ タップして ホームへ ］",
    ];
    const overlay = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x18233c, 1).setDepth(100);
    const txt = this.add
      .text(this.W / 2, this.H / 2, "", {
        fontFamily: UI_FONT,
        fontSize: "22px",
        color: "#e8e8ef",
        align: "center",
        lineSpacing: 12,
        wordWrap: { width: this.W - 60 },
      })
      .setOrigin(0.5)
      .setDepth(101);
    let idx = 0;
    const show = () => {
      txt.setText(lines[idx]);
      txt.setAlpha(0);
      this.tweens.add({ targets: txt, alpha: 1, duration: 500 });
    };
    show();
    this.input.on("pointerdown", () => {
      idx += 1;
      if (idx >= lines.length) {
        this.input.removeAllListeners("pointerdown");
        markIntroSeen();
        this.tweens.add({
          targets: [overlay, txt],
          alpha: 0,
          duration: 400,
          onComplete: () => {
            overlay.destroy();
            txt.destroy();
            this.buildHome();
          },
        });
        return;
      }
      show();
    });
  }

  // ---- 初回オンボーディング（主人公えらび＋なまえ＋たまご孵化）明るい導入 ----
  runOnboarding() {
    const cx = this.W / 2;
    const overlay = this.add.rectangle(cx, this.H / 2, this.W, this.H, 0x18233c, 1).setDepth(100).setInteractive();
    const layer = this.add.container(0, 0).setDepth(101);
    const draw = (build) => { layer.removeAll(true); build(); };
    const emoji = (e, x, y, sz) => this.add.text(x, y, e, { fontFamily: EMOJI_FONT, fontSize: sz }).setOrigin(0.5);
    let gender = "boy";
    let name = "";
    const defaultName = () => (gender === "boy" ? "ソラ" : "ヒカリ");

    const step1 = () =>
      draw(() => {
        layer.add(this.add.text(cx, 118, "ようこそ、感情の世界へ", { fontFamily: DISPLAY_FONT, fontSize: "24px", color: "#f0f0f0" }).setOrigin(0.5));
        layer.add(this.add.text(cx, 156, "あなたは、どちら？", { fontFamily: UI_FONT, fontSize: "15px", color: "#9a9aac" }).setOrigin(0.5));
        // 選べるカード。背景(0x0a0a14)と同化しないよう、明確に明るい面＋太い発光縁で「押せる」と分かる形に。
        const CW = 158;
        const CH = 224;
        const CY = 314;
        const makeCard = (x, fill, stroke, glow, onPick) => {
          const g = this.add.graphics();
          const draw = (hover) => {
            g.clear();
            g.fillStyle(glow, hover ? 0.22 : 0.12); // 外周のやわらかい光
            g.fillRoundedRect(x - CW / 2 - 5, CY - CH / 2 - 5, CW + 10, CH + 10, 20);
            g.fillStyle(fill, 1); // 面：背景よりはっきり明るい
            g.fillRoundedRect(x - CW / 2, CY - CH / 2, CW, CH, 16);
            g.lineStyle(hover ? 3.5 : 2.5, stroke, 1); // 感情色の太い縁
            g.strokeRoundedRect(x - CW / 2, CY - CH / 2, CW, CH, 16);
          };
          draw(false);
          const zone = this.add.rectangle(x, CY, CW, CH, 0x000000, 0.001).setInteractive({ useHandCursor: true });
          zone.on("pointerover", () => draw(true));
          zone.on("pointerout", () => draw(false));
          zone.on("pointerdown", onPick);
          return [g, zone];
        };
        // 面はそれぞれの感情色にほんのり寄せる（青み/赤みの濃紺）。背景の黒藍と十分コントラストを付ける。
        const boy = makeCard(cx - 92, 0x18223a, 0x6ab4ff, 0x4d9fff, () => { gender = "boy"; name = ""; sfx.tap(); step2(); });
        const boyImg = this.textures.exists("kid_boy") ? this.add.image(cx - 92, 296, "kid_boy").setScale(0.9) : emoji("👦", cx - 92, 296, "72px");
        const boyT = this.add.text(cx - 92, 400, "男の子", { fontFamily: UI_FONT, fontSize: "17px", color: "#bfe0ff" }).setOrigin(0.5);
        const girl = makeCard(cx + 92, 0x36192a, 0xff7ab0, 0xff4d8d, () => { gender = "girl"; name = ""; sfx.tap(); step2(); });
        const girlImg = this.textures.exists("kid_girl") ? this.add.image(cx + 92, 296, "kid_girl").setScale(0.9) : emoji("👧", cx + 92, 296, "72px");
        const girlT = this.add.text(cx + 92, 400, "女の子", { fontFamily: UI_FONT, fontSize: "17px", color: "#ffc2dc" }).setOrigin(0.5);
        // カード → 画像 → ラベルの順で重ねる（クリックは透明ゾーンが拾う）
        layer.add([boy[0], girl[0], boyImg, boyT, girlImg, girlT, boy[1], girl[1]]);
      });

    const step2 = () =>
      draw(() => {
        if (!name) name = defaultName();
        const img = this.textures.exists("kid_" + gender) ? this.add.image(cx, 220, "kid_" + gender).setScale(1.15) : emoji(gender === "boy" ? "👦" : "👧", cx, 220, "80px");
        layer.add(img);
        layer.add(this.add.text(cx, 322, "名前を教えて", { fontFamily: UI_FONT, fontSize: "16px", color: "#9a9aac" }).setOrigin(0.5));
        const nameT = this.add.text(cx, 362, name, { fontFamily: DISPLAY_FONT, fontSize: "30px", color: "#f0f0f0" }).setOrigin(0.5);
        layer.add(nameT);
        const rename = this.makeButton(cx, 434, 236, 48, "名前を変える", () => {
          const inp = typeof window !== "undefined" && window.prompt ? window.prompt("名前を入力（8文字まで）", name) : "";
          const v = (inp || "").trim().slice(0, 8);
          if (v) { name = v; nameT.setText(name); }
        }, { color: 0xeef4fc, stroke: 0x5a7aa0, textColor: "#1f6aa8", fontSize: "15px" }); // 明るいオンボ背景で読めるよう濃色文字
        const ok = this.makeButton(cx, 500, 236, 56, "この名前で始める", () => { sfx.tap(); step3(); }, { color: 0x4caf50, stroke: 0x2e7d32, textColor: "#ffffff", fontSize: "19px" }); // 主要CTA=緑＋白文字
        // gfx(塗り)を先頭＝最背面に。txtを後＝前面に（順序を誤ると塗りが文字を覆い隠す）
        layer.add([rename.gfx, rename.rect, rename.txt, rename.badge, ok.gfx, ok.rect, ok.txt, ok.badge]);
      });

    const step3 = () =>
      draw(() => {
        layer.add(this.add.text(cx, 128, `${name}の旅が、はじまる`, { fontFamily: DISPLAY_FONT, fontSize: "21px", color: "#f0f0f0" }).setOrigin(0.5));
        layer.add(this.add.text(cx, 166, "タマゴから、相棒が生まれる…", { fontFamily: UI_FONT, fontSize: "13px", color: "#9a9aac" }).setOrigin(0.5));
        const egg = this.textures.exists("egg") ? this.add.image(cx, 300, "egg").setScale(1.25) : emoji("🥚", cx, 300, "84px");
        layer.add(egg);
        const wob = this.tweens.add({ targets: egg, angle: -8, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        const hatch = this.makeButton(cx, 470, 244, 60, "🥚 タマゴに触れる", () => {
          hatch.rect.disableInteractive();
          wob.stop();
          this.tweens.add({
            targets: egg,
            scale: 0.08,
            alpha: 0,
            duration: 320,
            onComplete: () => {
              egg.destroy();
              // 前のボタンを片付けてから次を出す（重なり防止）
              hatch.rect.destroy();
              hatch.txt.destroy();
              hatch.badge.destroy();
              hatch.gfx.destroy();
              if (hatch.icon) hatch.icon.destroy(); // 🥚アイコン画像も片付ける
              const hasSlime = this.textures.exists("hero_slime");
              const slime = hasSlime ? this.add.image(cx, 296, "hero_slime").setScale(0.1) : emoji("🟢", cx, 296, "12px");
              layer.add(slime);
              this.tweens.add({ targets: slime, scale: hasSlime ? 1.25 : 7, duration: 520, ease: "Back.easeOut" });
              layer.add(this.add.text(cx, 402, "相棒が生まれた", { fontFamily: DISPLAY_FONT, fontSize: "21px", color: "#f0f0f0" }).setOrigin(0.5));
              const go = this.makeButton(cx, 500, 244, 60, "▶ ともに旅へ", () => {
                setPlayer({ gender, name });
                markPlayerChosen();
                this.tweens.add({ targets: [overlay, layer], alpha: 0, duration: 420, onComplete: () => { overlay.destroy(); layer.destroy(true); this.buildHome(); } });
              }, { color: 0x4caf50, stroke: 0x2e7d32, textColor: "#ffffff", fontSize: "20px" }); // 主要CTA=緑＋白文字
              layer.add([go.gfx, go.rect, go.txt, go.badge]); // gfxを最背面に
            },
          });
        }, { color: 0xffc94d, stroke: 0xd4a017, textColor: "#5a3d00", fontSize: "19px" }); // 主要CTA=金＋濃茶文字
        layer.add([hatch.gfx, hatch.rect, hatch.txt, hatch.badge]); // gfxを最背面に
        if (hatch.icon) layer.add(hatch.icon); // 🥚アイコンもレイヤーへ（片付け対象に）
      });

    step1();
  }

  // ---- home ----
  buildHome() {
    const s = getSave();

    // 留守番仲間の放置生産を回収（戻ってくるたび、働いてくれていた）
    //  ログウィズ流：明細つき「おかえり」ダイアログで受け取る（帰ってきた実感を作る）
    const idle = collectIdleProduction();
    if (Object.keys(idle.produced).length) {
      this.time.delayedCall(380, () => this.showWelcomeBack(idle));
    }

    this.add.text(this.W / 2, 52, "─ HOME ─", { fontFamily: DISPLAY_FONT, fontSize: "13px", color: "#4a6a86" }).setOrigin(0.5);
    // タイトル：明朝。明るい空の上で読めるよう深い藍緑に（うしろに白のにじみで浮かせる）
    const titleStyle = { fontFamily: DISPLAY_FONT, fontSize: "28px", color: "#1c5a6e", letterSpacing: 6 };
    const titleGlow = this.add.text(this.W / 2, 80, "やすらぎの灯", { ...titleStyle, color: "#ffffff" }).setOrigin(0.5).setAlpha(0.55).setScale(1.08);
    this.add.text(this.W / 2, 80, "やすらぎの灯", titleStyle).setOrigin(0.5);
    this.tweens.add({ targets: titleGlow, alpha: 0.3, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    if (s.spiritName) {
      this.add.text(this.W / 2, 102, `〈感情の精霊〉 ${s.spiritName}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#b0742a" }).setOrigin(0.5);
    }

    // 主人公プレビュー（転生後はまたスライムから）
    if (this.textures.exists("hero_slime")) {
      const hero = this.add.image(this.W / 2, 158, "hero_slime").setDisplaySize(84, 84);
      this.tweens.add({ targets: hero, y: 152, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    } else {
      this.add.text(this.W / 2, 158, "🟢", { fontFamily: EMOJI_FONT, fontSize: "62px" }).setOrigin(0.5);
    }
    // ステータス行：自作アイコン＋数値（❤HP / ⚔攻撃 / ⚡素早さ）
    const statY = 208;
    const glyphs = ["❤", "⚔", "⚡"];
    const gw = 74; // グループ間隔
    let sx = this.W / 2 - ((glyphs.length - 1) * gw) / 2;
    this.homeStatNums = [];
    for (const glyph of glyphs) {
      makeIcon(this, sx - 12, statY, glyph, 20, EMOJI_FONT);
      const t = this.add.text(sx + 4, statY, "", { fontFamily: UI_FONT, fontSize: "16px", color: "#33465c" }).setOrigin(0, 0.5);
      this.homeStatNums.push(t);
      sx += gw;
    }
    this.refreshHomeStats();

    // 魂パネル
    const px = this.W / 2;
    const py = 286;
    this.add.rectangle(px, py, this.W - 40, 112, 0xf3f8ff, 0.98).setStrokeStyle(1, 0xaecbe8);
    let domKey = null;
    let domVal = 0;
    for (const k of C.EMOTION_ORDER) {
      if (s.soul.memory[k] > domVal) {
        domVal = s.soul.memory[k];
        domKey = k;
      }
    }
    const domStr = domKey ? `${C.EMOTIONS[domKey].icon}${C.EMOTIONS[domKey].label}（共鳴）` : "まだ、無い";
    this.add.text(px, py - 38, `魂レベル ${s.soul.level}　／　転生 ${s.soul.rebirths} 回`, { fontFamily: UI_FONT, fontSize: "16px", color: "#22344a" }).setOrigin(0.5);
    this.add.text(px, py - 14, `最高到達 ${s.soul.bestDistance}m`, { fontFamily: UI_FONT, fontSize: "14px", color: "#4c5e76" }).setOrigin(0.5);
    this.add.text(px, py + 10, `記憶の傾向： ${domStr}`, { fontFamily: UI_FONT, fontSize: "14px", color: "#4c5e76" }).setOrigin(0.5);
    const bondStr = s.bonds.met > 0 ? `これまでに出会った仲間　${s.bonds.met}　（みんな、光に還った）` : "まだ、誰とも出会っていない";
    this.add.text(px, py + 34, bondStr, { fontFamily: UI_FONT, fontSize: "13px", color: "#9a5aa8" }).setOrigin(0.5);

    // 導く心のツリー（左）と 仲間の編成（右）
    this.treeBtn = this.makeButton(this.W / 2 - 96, 374, 186, 46, "", () => this.openTreePanel(), {
      color: 0xe9f1fb,
      stroke: 0x5a9ad0,
      hover: 0xdbe8f7,
      textColor: "#1f6aa8",
      fontSize: "16px",
    });
    this.partyBtn = this.makeButton(this.W / 2 + 96, 374, 186, 46, "", () => this.openPartyPanel(), {
      color: 0xf1e9fb,
      stroke: 0xa06ac0,
      hover: 0xe7dbf7,
      textColor: "#7a3ba8",
      fontSize: "16px",
    });
    // 導く心=🌳／仲間=🤝 のアイコンをボタン左に固定配置し、文字は右へ左寄せに（ラベルは動的更新）
    this.treeBtn.txt.setOrigin(0, 0.5).setX(this.W / 2 - 96 - 186 / 2 + 34);
    this.treeBtn.icon = makeIcon(this, this.W / 2 - 96 - 186 / 2 + 16, 374, "🌳", 20, EMOJI_FONT);
    this.partyBtn.txt.setOrigin(0, 0.5).setX(this.W / 2 + 96 - 186 / 2 + 34);
    this.partyBtn.icon = makeIcon(this, this.W / 2 + 96 - 186 / 2 + 16, 374, "🤝", 20, EMOJI_FONT);
    this.refreshTreeBtn();
    this.refreshPartyBtn();

    // メニュー 2x2＋あかし（実績）の横長ボタン。高さを少し詰めて3段に収める
    const bw = 184;
    const bh = 46;
    const lx = this.W / 2 - 96;
    const rx = this.W / 2 + 96;
    const ty = 426;
    const by = 478;
    // 感情色のネオンを縁に一滴ずつ（勇気=装備／怒り=制作／悲しみ=結晶／希望=お知らせ）
    this.makeButton(lx, ty, bw, bh, "🛡 装備変更", () => this.openEquipPanel(), { stroke: 0xd4a017, textColor: "#b8860b" });
    this.makeButton(rx, ty, bw, bh, "🔨 制作", () => this.openCraftPanel(), { stroke: 0xff4d4d, textColor: "#c23b3b" });
    this.makeButton(lx, by, bw, bh, "💎 結晶", () => this.openItemPanel(), { stroke: 0x4d9fff, textColor: "#1f6aa8" });
    this.noticeBtn = this.makeButton(rx, by, bw, bh, "📜 お知らせ", () => this.openNoticePanel("ops"), { stroke: 0x9fb4cc, textColor: "#4c5e76" });
    this.refreshNoticeBadge();
    // あかし（実績）：横長で1段追加
    this.achieveBtn = this.makeButton(this.W / 2, 524, bw * 2 + 8, 36, "🏅 あかし", () => this.openAchievementsPanel(), { stroke: 0xd0a840, textColor: "#b8860b", fontSize: "15px" });
    this.refreshAchieveBadge();
    this.refreshTreeBadge(); // 上げられるツリーがあれば赤ドット

    // 深淵トグル（初回エンディング後に解禁されるハードモード）
    const abyss = abyssUnlocked();
    this.buildAbyssToggle(abyss);

    // 出発（深淵トグルがある時は少し下げてスペースを作る）
    const departY = abyss ? 604 : 576;
    this.departBtn = this.makeButton(this.W / 2, departY, 300, abyss ? 52 : 64, "▶ 出発する", () => this.openLoadoutPanel(), {
      color: 0x4caf50,
      stroke: 0x2e7d32,
      hover: 0x43a047,
      textColor: "#ffffff",
      fontSize: "22px",
    });
    this.departY = departY;
    this.departH = abyss ? 52 : 64;
    this.refreshDepartGlow();
    if (!abyss) this.add.text(this.W / 2, 620, "倒れても記憶は残る。何度でも、旅立とう。", { fontFamily: UI_FONT, fontSize: "13px", color: "#6a6a80" }).setOrigin(0.5);

    // 受け取れる実績があれば一度だけ知らせる
    if (unclaimedAchievementCount() > 0) this.time.delayedCall(600, () => this.toast("受け取れる あかし があります"));

    this.drawBaseStrip(); // やすらぎの街：留守番の仲間が働いている様子

    // リセット（テスト用）※誤タップでの全消去を防ぐため確認を挟む
    this.add
      .text(16, this.H - 14, "記録を消す", { fontFamily: UI_FONT, fontSize: "12px", color: "#55556a" })
      .setOrigin(0, 1)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.confirmReset());

    // 💾 セーブ（バックアップ／復元）
    this.add
      .text(this.W / 2, this.H - 14, "💾 セーブ", { fontFamily: UI_FONT, fontSize: "12px", color: isSaveFailing() ? "#ff8a8a" : "#7a7a90" })
      .setOrigin(0.5, 1)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.openSavePanel());
    // 保存無効ならホームで警告
    if (isSaveFailing()) {
      this.time.delayedCall(400, () => this.toast("⚠ このブラウザは保存が無効。『💾セーブ』でバックアップコードを保管して"));
    }

    // 音 ON/OFF
    const muteT = this.add
      .text(this.W - 16, this.H - 14, isMuted() ? "🔇 音 OFF" : "🔊 音 ON", { fontFamily: UI_FONT, fontSize: "12px", color: "#7a7a90" })
      .setOrigin(1, 1)
      .setInteractive({ useHandCursor: true });
    muteT.on("pointerdown", () => {
      onFirstGesture();
      const m = !isMuted();
      setMuted(m);
      setPref("muted", m);
      muteT.setText(m ? "🔇 音 OFF" : "🔊 音 ON");
    });

    this.drawAccountChip(); // ☁ ログイン／アカウント（別端末同期）
  }

  // 右上のアカウント表示。タップで ログイン／ログアウト。状態は非同期で反映。
  drawAccountChip() {
    const chip = this.add
      .text(this.W - 14, 44, "☁ アカウント", { fontFamily: UI_FONT, fontSize: "12px", color: "#7a9ac0" })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    chip.on("pointerdown", () => {
      openAccountOverlay((r) => {
        if (r && (r.signedIn || r.signedOut)) this.scene.restart(); // 取り込んだセーブを反映
      });
    });
    if (!cloudConfigured()) {
      chip.setText("☁ 未設定").setColor("#55556a");
      return;
    }
    getUser().then((u) => {
      if (!chip.scene) return; // シーン再構築で破棄済みなら何もしない
      if (u) chip.setText("☁ " + (u.email ? u.email.split("@")[0] : "ログイン中")).setColor("#9fff9f");
      else chip.setText("☁ ログイン").setColor("#7a9ac0");
    });
  }

  refreshHomeStats() {
    const st = computeHeroStats();
    if (this.homeStatNums && this.homeStatNums.length === 3) {
      this.homeStatNums[0].setText(String(st.maxHp));
      this.homeStatNums[1].setText(String(st.atk));
      this.homeStatNums[2].setText(String(st.spd));
    }
  }

  // やすらぎの街：留守番（同行してない）仲間が、感情の素材を集めて働いている様子（Palworld由来）
  drawBaseStrip() {
    const stay = getSave().party.bonded.filter((b) => !b.active);
    const y = 668;
    // 「やすらぎの街」へ入れる看板ボタン（道の上に立つ標識のように）。タップで街の詳細へ。
    const townBtn = this.makeButton(this.W / 2, y - 24, 208, 38, `🏠 やすらぎの街 Lv${townLevel()}　▸`, () => this.openTownPanel(), {
      color: 0xfff2d6, // あたたかいクリーム
      stroke: 0xe0a848, // 金の縁＝標識らしさ
      textColor: "#8a5a1a",
      fontSize: "14px",
    });
    // 「押せる看板」だと分かるよう、ふわりと呼吸させる
    const parts = [townBtn.gfx, townBtn.rect, townBtn.txt, townBtn.badge, townBtn.icon].filter(Boolean);
    this.tweens.add({ targets: parts, y: "-=2", duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    if (!stay.length) {
      this.add.text(this.W / 2, y + 4, "仲間を「留守番」にすると、ここで素材を集めてくれる", { fontFamily: UI_FONT, fontSize: "11px", color: "#4a4a5e" }).setOrigin(0.5);
      return;
    }
    const list = stay.slice(0, 6);
    const step = Math.min(56, (this.W - 60) / list.length);
    const startX = this.W / 2 - (step * (list.length - 1)) / 2;
    list.forEach((b, i) => {
      const x = startX + step * i;
      const matIcon = C.EMOTIONS[b.emotion] ? C.EMOTIONS[b.emotion].icon : "·";
      const spr = this.charPortrait(x, y, b.emotion, 40, b.icon, false, b); // pixel仲間（課金は専用）
      this.tweens.add({ targets: spr, y: y - 4, duration: 500 + i * 60, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.add.text(x, y + 22, matIcon, { fontFamily: EMOJI_FONT, fontSize: "12px" }).setOrigin(0.5);
    });
  }

  // 街の詳細：感情ごとの「場所」で留守番仲間が働く。街は転生で育つ。
  openTownPanel() {
    this.openPanel("やすらぎの街", (c) => {
      const s = getSave();
      const lv = townLevel();
      const bonus = Math.round(C.COMPANION.idle.townBonusPerLevel * (lv - 1) * 100);
      const stay = s.party.bonded.filter((b) => !b.active);
      c.add(this.add.text(this.W / 2, 116, `街レベル ${lv}　（生産 +${bonus}%）`, { fontFamily: UI_FONT, fontSize: "17px", color: "#1f6aa8" }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 140, `留守番 ${stay.length} 体　／　次のLvまで 転生 ${C.COMPANION.idle.townRebirthsPerLevel - (s.soul.rebirths % C.COMPANION.idle.townRebirthsPerLevel)} 回`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0.5));

      // 街の空気（pixel遠景を薄く敷く）
      if (this.textures.exists("bg_far")) c.add(this.add.image(this.W / 2, 250, "bg_far").setDisplaySize(this.W - 24, 130).setAlpha(0.25));

      // 4感情の「場所」を 2x2 で（pixelの建物）。属性の合う留守番仲間がそこで働く。
      const positions = [
        [this.W / 2 - 96, 240],
        [this.W / 2 + 96, 240],
        [this.W / 2 - 96, 408],
        [this.W / 2 + 96, 408],
      ];
      C.EMOTION_ORDER.forEach((k, i) => {
        const [cx, cy] = positions[i];
        const info = C.EMOTIONS[k];
        const here = stay.filter((b) => b.emotion === k);
        if (this.textures.exists("town_" + k)) c.add(this.add.image(cx, cy - 42, "town_" + k).setDisplaySize(82, 82));
        else c.add(this.add.text(cx, cy - 42, info.icon, { fontFamily: EMOJI_FONT, fontSize: "40px" }).setOrigin(0.5));
        c.add(this.add.text(cx, cy + 8, C.COMPANION.spots[k], { fontFamily: UI_FONT, fontSize: "13px", color: colorToCss(info.color) }).setOrigin(0.5));
        if (!here.length) {
          c.add(this.add.text(cx, cy + 34, "（誰もいない）", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
        } else {
          here.slice(0, 3).forEach((b, j) => {
            const x = cx - 30 + j * 30;
            const yy = cy + 36;
            const spr = this.charPortrait(x, yy, b.emotion, 28, b.icon, false, b);
            this.tweens.add({ targets: spr, y: yy - 3, duration: 480 + j * 70, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
            c.add(spr);
          });
          c.add(this.add.text(cx, cy + 58, `${here.length}体が採取中`, { fontFamily: UI_FONT, fontSize: "10px", color: "#4c5e76" }).setOrigin(0.5));
        }
      });

      // 卵の巣（共鳴孵化の可視化＝卵の在り処）
      const eggs = s.party.eggs.length;
      const ny = 512;
      if (this.textures.exists("town_nest")) c.add(this.add.image(this.W / 2 - 70, ny, "town_nest").setDisplaySize(66, 66));
      else c.add(this.add.text(this.W / 2 - 70, ny, "🥚", { fontFamily: EMOJI_FONT, fontSize: "34px" }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2 - 28, ny - 10, eggs > 0 ? `感情の卵 ×${eggs}` : "卵はまだない", { fontFamily: UI_FONT, fontSize: "14px", color: eggs > 0 ? "#b8860b" : "#74839a" }).setOrigin(0, 0.5));
      c.add(this.add.text(this.W / 2 - 28, ny + 12, eggs > 0 ? "次の旅で孵る" : "2体以上を同行させると生まれる", { fontFamily: UI_FONT, fontSize: "10px", color: "#74839a" }).setOrigin(0, 0.5));

      c.add(this.add.text(this.W / 2, 566, "留守番の仲間が、合う場所で素材を集める。街は転生で育つ。", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a", align: "center", wordWrap: { width: this.W - 60 } }).setOrigin(0.5));
    });
  }

  // ---- おかえりダイアログ（ログウィズ流：放置成果を明細で受け取る）----
  showWelcomeBack(idle) {
    if (this.panel) {
      // 何かのパネルを開いていたら邪魔しない（トーストに落とす）
      const str = Object.entries(idle.produced).map(([k, v]) => `${C.EMOTIONS[k].icon}+${v}`).join("　");
      this.toast(`🏠 留守番の ${idle.workers}体が 素材を集めてくれた　${str}`);
      return;
    }
    const entries = Object.entries(idle.produced);
    const cardW = this.W - 90;
    const cardH = 168 + entries.length * 30;
    const cy = this.H / 2 - 40;
    const c = this.add.container(0, 0).setDepth(300).setAlpha(0);
    const bg = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x1a2a3e, 0.55).setInteractive();
    const card = this.add.graphics();
    card.fillStyle(0xf3f8ff, 0.98);
    card.fillRoundedRect(this.W / 2 - cardW / 2, cy - cardH / 2, cardW, cardH, 14);
    card.lineStyle(1, 0xaecbe8, 1);
    card.strokeRoundedRect(this.W / 2 - cardW / 2, cy - cardH / 2, cardW, cardH, 14);
    let y = cy - cardH / 2 + 34;
    const title = this.add.text(this.W / 2, y, "─ おかえりなさい ─", { fontFamily: DISPLAY_FONT, fontSize: "20px", color: "#1c3a5a" }).setOrigin(0.5);
    y += 28;
    const hoursDisp = Math.round((idle.hours || 0) * 10) / 10;
    const sub = this.add.text(this.W / 2, y, `留守番の ${idle.workers}体が ${hoursDisp}時間 働いてくれた`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0.5);
    y += 30;
    c.add([bg, card, title, sub]);
    for (const [k, v] of entries) {
      const info = C.EMOTIONS[k];
      c.add(this.add.text(this.W / 2, y, `${info.icon} ${info.label}の素材　+${v}`, { fontFamily: UI_FONT, fontSize: "14px", color: colorToCss(info.color) }).setOrigin(0.5));
      y += 30;
    }
    const ok = this.makeButton(this.W / 2, cy + cardH / 2 - 40, 180, 44, "受け取る", () => {
      sfx.coin();
      this.tweens.add({ targets: c, alpha: 0, duration: 180, onComplete: () => c.destroy(true) });
    }, { color: 0x4caf50, stroke: 0x2e7d32, textColor: "#ffffff" });
    c.add([ok.gfx, ok.rect, ok.txt, ok.badge]);
    this.tweens.add({ targets: c, alpha: 1, duration: 240 });
  }

  refreshTreeBtn() {
    // アイコンは別配置（🌳）。文字は絵文字を省いて左寄せ。
    if (this.treeBtn) this.treeBtn.txt.setText(`導く心 悟り${getSave().enlightenment}`);
    this.refreshTreeBadge(); // 悟りが動いたらバッジも更新
  }

  // ツリーに「いま上げられるノード」があれば赤ドット（ログウィズ流：やることはバッジで示す）
  refreshTreeBadge() {
    if (this.treeBtn) this.treeBtn.badge.setText(canUnlockAnyNode() ? "●" : "");
  }

  refreshPartyBtn() {
    // アイコンは別配置（🤝）。文字は絵文字を省いて左寄せ。
    if (this.partyBtn) this.partyBtn.txt.setText(`仲間 ${getSave().party.bonded.length}/${carryoverSlots()}`);
  }

  unreadNotices() {
    const read = getSave().noticesRead;
    return [...NOTICES.ops, ...NOTICES.story].filter((n) => !read.includes(n.id)).length;
  }

  refreshNoticeBadge() {
    if (this.noticeBtn) this.noticeBtn.badge.setText(this.unreadNotices() > 0 ? "●" : "");
  }

  refreshAchieveBadge() {
    if (this.achieveBtn) {
      const n = unclaimedAchievementCount();
      this.achieveBtn.badge.setText(n > 0 ? String(n) : "");
    }
  }

  // ---- 深淵トグル（敵×3・報酬跳ね上げのハードモード）----
  buildAbyssToggle(unlocked) {
    if (!unlocked) return;
    const y = 552;
    this.add.text(this.W / 2 - 60, y, "🕳 深淵に挑む", { fontFamily: UI_FONT, fontSize: "13px", color: "#7a3ba8" }).setOrigin(0.5);
    const pill = this.add.graphics();
    const px = this.W / 2 + 78;
    const pw = 92;
    const ph = 26;
    const drawPill = () => {
      const on = abyssActive();
      pill.clear();
      pill.fillStyle(on ? 0x7a3ba8 : 0xe9f1fb, on ? 1 : 0.98);
      pill.fillRoundedRect(px - pw / 2, y - ph / 2, pw, ph, 13);
      pill.lineStyle(1, on ? 0x5a1a88 : 0xaecbe8, 1);
      pill.strokeRoundedRect(px - pw / 2, y - ph / 2, pw, ph, 13);
      pillT.setText(on ? "深淵ON" : "OFF").setColor(on ? "#ffffff" : "#74839a");
    };
    const pillT = this.add.text(px, y, "", { fontFamily: UI_FONT, fontSize: "13px", color: "#74839a" }).setOrigin(0.5);
    const hit = this.add.rectangle(px, y, pw, ph, 0x000000, 0.001).setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => {
      setAbyss(!abyssActive());
      drawPill();
      this.refreshDepartGlow();
      this.toast(abyssActive() ? "🕳 深淵に踏み込む。心して" : "深淵から離れた");
    });
    drawPill();
    this.add.text(this.W / 2, y + 17, "敵×3の苛烈な旅。報酬も跳ねる（コイン×3・欠片×2）", { fontFamily: UI_FONT, fontSize: "10px", color: "#74839a" }).setOrigin(0.5);
  }

  // 深淵ONのとき、出発ボタンの縁を紫に灯して思い出させる
  refreshDepartGlow() {
    if (!this.departGlow) this.departGlow = this.add.graphics();
    this.departGlow.clear();
    if (this.departBtn && abyssUnlocked() && abyssActive()) {
      this.departGlow.lineStyle(2, 0x8a5adf, 0.9);
      this.departGlow.strokeRoundedRect(this.W / 2 - 150, this.departY - this.departH / 2, 300, this.departH, 10);
    }
  }

  // ---- あかし（実績）：達成の報酬を受け取る ----
  openAchievementsPanel() {
    this.openPanel("あかし", (c) => {
      const list = this.add.container(0, 0);
      c.add(list);
      const items = achievementList();
      const unclaimed = items.filter((a) => a.done && !a.claimed).length;
      c.add(this.add.text(unclaimed >= 2 ? 30 : this.W / 2, 118, unclaimed > 0 ? `受け取れる あかし　${unclaimed} 件` : "歩んだ道のりが、ここに残る", { fontFamily: UI_FONT, fontSize: "13px", color: unclaimed > 0 ? "#b8860b" : "#4c5e76" }).setOrigin(unclaimed >= 2 ? 0 : 0.5, 0.5));
      // ログウィズ流：まとめてワンタップ受け取り
      if (unclaimed >= 2) {
        const all = this.add.rectangle(this.W - 84, 118, 118, 30, 0xfbf3d8).setStrokeStyle(1, 0xd0a840).setInteractive({ useHandCursor: true });
        const allT = this.add.text(this.W - 84, 118, "まとめて受取", { fontFamily: UI_FONT, fontSize: "12px", color: "#b8860b" }).setOrigin(0.5);
        all.on("pointerdown", () => {
          let satori = 0;
          let gold = 0;
          for (const a of items) {
            if (!a.done || a.claimed) continue;
            const r = claimAchievement(a.def.id);
            if (r.ok && r.reward) {
              satori += r.reward.satori || 0;
              gold += r.reward.gold || 0;
            }
          }
          const parts = [];
          if (satori) parts.push(`🧠悟り+${satori}`);
          if (gold) parts.push(`💰+${gold}`);
          this.toast(`あかし ${unclaimed}件 の報酬を受け取った　${parts.join(" ")}`);
          sfx.coin();
          this.refreshTreeBtn();
          this.refreshAchieveBadge();
          this.openAchievementsPanel();
        });
        c.add([all, allT]);
      }

      const rows = [];
      const rowH = 56;
      let y = 168;
      items.forEach((a) => {
        const d = a.def;
        const shown = Math.min(a.value, d.gte);
        const row = this.add.rectangle(this.W / 2, y, this.W - 50, rowH, a.claimed ? 0xe6ebf2 : a.done ? 0xeef7e4 : 0xffffff).setStrokeStyle(1, a.claimed ? 0xc2ccd8 : a.done ? 0xb5c96a : 0xd6e2f0);
        const ic = this.add.text(36, y, d.icon, { fontFamily: EMOJI_FONT, fontSize: "22px" }).setOrigin(0.5);
        const nm = this.add.text(58, y - 16, d.name, { fontFamily: UI_FONT, fontSize: "14px", color: a.done ? "#b8860b" : "#22344a" }).setOrigin(0, 0.5);
        const ds = this.add.text(58, y + 1, d.desc, { fontFamily: UI_FONT, fontSize: "10px", color: "#74839a" }).setOrigin(0, 0.5);
        const rw = [];
        if (d.reward && d.reward.satori) rw.push(`🧠悟り+${d.reward.satori}`);
        if (d.reward && d.reward.gold) rw.push(`💰+${d.reward.gold}`);
        const pr = this.add.text(58, y + 17, `${shown}/${d.gte}　${rw.join(" ")}`, { fontFamily: UI_FONT, fontSize: "10px", color: a.done ? "#2e7d32" : "#74839a" }).setOrigin(0, 0.5);
        list.add([row, ic, nm, ds, pr]);
        // 右側：受領状態
        if (a.claimed) {
          list.add(this.add.text(this.W - 40, y, "受領✓", { fontFamily: UI_FONT, fontSize: "13px", color: "#8a97a8" }).setOrigin(1, 0.5));
        } else if (a.done) {
          const btn = this.add.rectangle(this.W - 66, y, 74, 32, 0xfbf3d8).setStrokeStyle(1, 0xd0a840);
          const bt = this.add.text(this.W - 66, y, "受け取る", { fontFamily: UI_FONT, fontSize: "12px", color: "#b8860b" }).setOrigin(0.5);
          list.add([btn, bt]);
          rows.push({ id: d.id, y });
        } else {
          list.add(this.add.text(this.W - 40, y, `${Math.floor((shown / d.gte) * 100)}%`, { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a" }).setOrigin(1, 0.5));
        }
        y += rowH + 8;
      });
      this.attachScroll(c, list, 140, this.H - 60, y + 6, (id) => {
        const r = claimAchievement(id);
        if (r.ok) {
          this.toast(`あかし『${r.def.name}』 報酬を受け取った`);
          this.refreshTreeBtn();
          this.refreshAchieveBadge();
          this.openAchievementsPanel();
        }
      }, rows);
    });
  }

  makeButton(x, y, w, h, label, onClick, opts = {}) {
    // 角丸のカード風ボタン（明るい面に感情色の縁が灯る・ポケモン/デジモン級の快活さ）
    const fill = opts.color ?? 0xf3f8ff;
    const border = opts.stroke ?? 0xaecbe8;
    const hover = opts.hover ?? Phaser.Display.Color.IntegerToColor(fill).darken(6).color;
    const gfx = this.add.graphics();
    const drawBg = (col) => {
      gfx.clear();
      gfx.fillStyle(col, 0.98);
      gfx.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
      gfx.lineStyle(1, border, 1);
      gfx.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    };
    drawBg(fill);
    // rect は当たり判定専用（ほぼ透明）。呼び出し側の互換のため残す。
    const rect = this.add
      .rectangle(x, y, w, h, fill, 0.001)
      .setInteractive({ useHandCursor: true });
    // 先頭が既知の絵文字なら、その字だけ自作アイコン画像に置き換え、残りの文字を右へ寄せる
    const lead = label ? label.split(" ")[0] : "";
    const iconTex = lead ? iconTexFor(lead) : null;
    let icon = null;
    let txt;
    if (iconTex) {
      const ix = x - w / 2 + 22; // ボタン左端の少し内側
      icon = makeIcon(this, ix, y, lead, 22, EMOJI_FONT);
      const rest = label.slice(lead.length).replace(/^\s+/, ""); // 先頭絵文字と続く空白を除去
      txt = this.add
        .text(ix + 16, y, rest, { fontFamily: opts.font ?? UI_FONT, fontSize: opts.fontSize ?? "18px", color: opts.textColor ?? "#22344a" })
        .setOrigin(0, 0.5); // アイコンの右に左寄せ
    } else {
      txt = this.add
        .text(x, y, label, { fontFamily: opts.font ?? UI_FONT, fontSize: opts.fontSize ?? "18px", color: opts.textColor ?? "#22344a" })
        .setOrigin(0.5);
    }
    const badge = this.add
      .text(x + w / 2 - 14, y - h / 2 + 14, "", { fontFamily: UI_FONT, fontSize: "16px", color: "#ff5a5a" })
      .setOrigin(0.5);
    rect.on("pointerover", () => drawBg(hover));
    rect.on("pointerout", () => drawBg(fill));
    rect.on("pointerdown", () => {
      this.tweens.add({ targets: [rect, txt], scale: 0.96, duration: 60, yoyo: true });
      onClick();
    });
    return { rect, txt, badge, gfx, icon };
  }

  // ---- パネル枠 ----
  openPanel(title, builder) {
    if (this.panel) this.panel.destroy(true);
    const c = this.add.container(0, 0).setDepth(200);
    const bg = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x1a2a3e, 0.55).setInteractive();
    // 角丸カード（明るい紙に細い罫線 ── 図鑑の扉のように）
    const card = this.add.graphics();
    const cw = this.W - 24;
    const ch = this.H - 110;
    card.fillStyle(0xf3f8ff, 0.98);
    card.fillRoundedRect(this.W / 2 - cw / 2, this.H / 2 - ch / 2, cw, ch, 14);
    card.lineStyle(1, 0xaecbe8, 1);
    card.strokeRoundedRect(this.W / 2 - cw / 2, this.H / 2 - ch / 2, cw, ch, 14);
    const titleT = this.add.text(this.W / 2, 80, title, { fontFamily: DISPLAY_FONT, fontSize: "24px", color: "#1c3a5a" }).setOrigin(0.5);
    // 題字の下に細い罫線
    const rule = this.add.rectangle(this.W / 2, 100, cw - 60, 1, 0xaecbe8);
    const close = this.add
      .text(this.W - 30, 66, "✕", { fontFamily: UI_FONT, fontSize: "26px", color: "#74839a" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => {
      c.destroy(true);
      this.panel = null;
    });
    c.add([bg, card, titleT, rule, close]);
    builder(c);
    this.panel = c;
    return c;
  }

  closeActivePanel() {
    if (this.panel) {
      this.panel.destroy(true);
      this.panel = null;
    }
  }

  // 記録の全消去は取り返しがつかないので、必ず確認を挟む
  confirmReset() {
    this.openPanel("本当に記録を消しますか？", (c) => {
      c.add(
        this.add
          .text(this.W / 2, 220, "魂・仲間・図鑑・悟り・装備など\nすべての進行が完全に消え、元に戻せません。", {
            fontFamily: UI_FONT,
            fontSize: "15px",
            color: "#b03030",
            align: "center",
            lineSpacing: 8,
          })
          .setOrigin(0.5),
      );
      const yes = this.makeButton(this.W / 2, 340, 280, 54, "すべて消す", () => { resetSave(); this.scene.restart(); }, { color: 0xfbe6e6, stroke: 0xc23b3b, textColor: "#c23b3b" });
      const no = this.makeButton(this.W / 2, 410, 280, 54, "やめる", () => this.closeActivePanel(), { color: 0x4caf50, stroke: 0x2e7d32, textColor: "#ffffff" });
      c.add([yes.gfx, yes.rect, yes.txt, yes.badge, no.gfx, no.rect, no.txt, no.badge]); // gfx(塗り)を最背面に
    });
  }

  // ---- 出発前ロードアウト確認（見守り前の唯一の主体的判断＝旅立ちに重み）----
  openLoadoutPanel() {
    this.openPanel("旅立ちの支度", (c) => {
      const s = getSave();
      const st = computeHeroStats();
      const active = s.party.bonded.filter((b) => b.active).slice(0, C.COMPANION.maxParty);
      const rar = C.EQUIPMENT.rarities;
      let y = 132;
      c.add(this.add.text(this.W / 2, y, "この編成で旅立ちますか？", { fontFamily: UI_FONT, fontSize: "16px", color: "#22344a" }).setOrigin(0.5));
      y += 34;
      c.add(this.add.text(this.W / 2, y, `キミ　❤${st.maxHp}　⚔${st.atk}　⚡${st.spd}　🛡${st.def}　🍀${st.luk}`, { fontFamily: UI_FONT, fontSize: "14px", color: "#4c5e76" }).setOrigin(0.5));
      y += 30;
      const eq = s.equipment.equipped.map((id) => s.equipment.owned.find((o) => o.id === id)).filter(Boolean);
      const eqTxt = eq.length ? eq.map((it) => it.name).join("・") : "装備なし";
      c.add(this.add.text(this.W / 2, y, `🛡 ${eqTxt}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76", align: "center", wordWrap: { width: this.W - 70 } }).setOrigin(0.5));
      y += 32;
      c.add(this.add.text(this.W / 2, y, `― 同行する仲間 (${active.length}/${C.COMPANION.maxParty}) ―`, { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a" }).setOrigin(0.5));
      y += 26;
      if (!active.length) {
        c.add(this.add.text(this.W / 2, y, "（まだ仲間がいません。旅で出会えます）", { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a" }).setOrigin(0.5));
        y += 26;
      } else {
        active.forEach((b) => {
          const icon = b.icon || (C.EMOTIONS[b.emotion] && C.EMOTIONS[b.emotion].icon) || "❔";
          const r = rar.find((x) => x.key === b.rarity) || rar[0];
          c.add(this.add.text(this.W / 2, y, `${icon} ${b.name}〈${b.roleLabel || ""}〉 Lv.${b.level || 1}　${r.label}`, { fontFamily: UI_FONT, fontSize: "13px", color: colorToCss(r.color) }).setOrigin(0.5));
          y += 26;
        });
      }
      let departing = false; // 連打で scene.start が二重発火しないように（パネル生成ごとにリセットされる closure フラグ）
      const go = this.makeButton(this.W / 2, this.H - 116, 320, 60, "▶ この編成で旅立つ", () => {
        if (departing) return;
        departing = true;
        this.scene.start("GameScene");
      }, { color: 0x4caf50, stroke: 0x2e7d32, hover: 0x43a047, textColor: "#ffffff", fontSize: "20px", font: DISPLAY_FONT });
      // 灯がゆっくり脈打つ（旅立ちの重み）
      this.tweens.add({ targets: [go.gfx, go.txt], alpha: 0.75, duration: 1000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      c.add([go.gfx, go.rect, go.txt, go.badge]); // gfx(塗り)を最背面に
    });
  }

  // ---- 装備変更（実機能）----
  openEquipPanel() {
    this.openPanel("装備変更", (c) => {
      const s = getSave();
      const st = computeHeroStats();
      c.add(this.add.text(this.W / 2, 122, `❤ ${st.maxHp}　⚔ ${st.atk}　⚡ ${st.spd}　🛡 ${st.def}　🍀 ${st.luk}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#22344a" }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 146, `装備スロット ${s.equipment.equipped.length} / ${effectiveEquipSlots()}`, { fontFamily: UI_FONT, fontSize: "13px", color: "#4c5e76" }).setOrigin(0.5));

      const owned = s.equipment.owned;
      if (!owned.length) {
        c.add(this.add.text(this.W / 2, 260, "装備がありません。\n冒険で拾うか、制作で作りましょう。", { fontFamily: UI_FONT, fontSize: "16px", color: "#4c5e76", align: "center", lineSpacing: 8 }).setOrigin(0.5));
        return;
      }
      // 装備中を上に、その次に新しい順（作った装備・拾った装備が必ず見える）
      const sorted = owned.slice().sort((a, b) => {
        const ea = isEquipped(a.id) ? 1 : 0;
        const eb = isEquipped(b.id) ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return b.id - a.id;
      });
      c.add(this.add.text(this.W / 2, 168, `所持 ${owned.length} 件（装備中・新しい順／スクロール可）`, { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
      // 全件をスクロールリストに（11個目以降が装備できないバグ修正）
      const list = this.add.container(0, 0);
      const rows = [];
      let y = 210;
      sorted.forEach((it) => {
        const equipped = isEquipped(it.id);
        const rar = C.EQUIPMENT.rarities.find((r) => r.key === it.rarity) || C.EQUIPMENT.rarities[0];
        const row = this.add
          .rectangle(this.W / 2, y, this.W - 50, 42, equipped ? 0xeef7e4 : 0xffffff)
          .setStrokeStyle(1, equipped ? 0x4caf50 : 0xd6e2f0);
        const nm = this.add.text(40, y - 10, `${it.name}〈${rar.label}〉`, { fontFamily: UI_FONT, fontSize: "15px", color: colorToCss(rar.color) }).setOrigin(0, 0.5);
        const stt = this.add.text(40, y + 9, `❤${it.hp}  ⚔${it.atk}  ⚡${it.spd}${it.def ? `  🛡${it.def}` : ""}${it.luk ? `  🍀${it.luk}` : ""}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0, 0.5);
        const tag = this.add.text(this.W - 42, y, equipped ? "装備中" : "装備する", { fontFamily: UI_FONT, fontSize: "13px", color: equipped ? "#2e7d32" : "#1f6aa8" }).setOrigin(1, 0.5);
        list.add([row, nm, stt, tag]);
        rows.push({ id: it.id, y });
        y += 48;
      });
      c.add(list);
      this.attachScroll(c, list, 186, this.H - 60, y + 6, (id) => {
        toggleEquip(id);
        this.refreshHomeStats();
        this.openEquipPanel();
      }, rows);
    });
  }

  // ---- 制作（素材→装備／アイテム：実機能）----
  openCraftPanel(tab = "equip", emotion = "anger") {
    this.openPanel("制作", (c) => {
      const s = getSave();

      // 上段タブ：装備 / アイテム
      const topTab = (x, key, label) => {
        const active = tab === key;
        const r = this.add.rectangle(x, 104, 96, 32, active ? 0xdbe8f7 : 0xffffff).setStrokeStyle(1, active ? 0x5a9ad0 : 0xd6e2f0).setInteractive({ useHandCursor: true });
        const t = this.add.text(x, 104, label, { fontFamily: UI_FONT, fontSize: "14px", color: active ? "#1f6aa8" : "#74839a" }).setOrigin(0.5);
        r.on("pointerdown", () => this.openCraftPanel(key, emotion));
        c.add([r, t]);
      };
      topTab(this.W / 2 - 52, "equip", "装備");
      topTab(this.W / 2 + 52, "item", "アイテム");

      // ── アイテム制作 ──
      if (tab === "item") {
        const matStr = C.EMOTION_ORDER.map((k) => `${C.EMOTIONS[k].icon}${s.materials[k] || 0}`).join("　");
        c.add(this.add.text(this.W / 2, 142, matStr, { fontFamily: UI_FONT, fontSize: "13px", color: "#4c5e76" }).setOrigin(0.5));
        let y = 188;
        C.ITEM_ORDER.forEach((key) => {
          const def = C.ITEMS[key];
          const have = itemCount(key);
          const can = Object.entries(def.cost).every(([emo, n]) => (s.materials[emo] || 0) >= n);
          const costStr = Object.entries(def.cost).map(([emo, n]) => `${C.EMOTIONS[emo].icon}${n}`).join(" ");
          const row = this.add.rectangle(this.W / 2, y, this.W - 50, 58, 0xffffff).setStrokeStyle(1, 0xd6e2f0);
          c.add(row);
          c.add(this.add.text(36, y - 14, `${def.icon} ${def.label}　×${have}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#22344a" }).setOrigin(0, 0.5));
          c.add(this.add.text(36, y + 5, def.desc, { fontFamily: UI_FONT, fontSize: "11px", color: "#4c5e76" }).setOrigin(0, 0.5));
          c.add(this.add.text(36, y + 21, `素材 ${costStr}`, { fontFamily: UI_FONT, fontSize: "11px", color: can ? "#74839a" : "#c07a7a" }).setOrigin(0, 0.5));
          const btn = this.add.rectangle(this.W - 68, y, 80, 36, can ? 0x4caf50 : 0xe6ebf2).setStrokeStyle(1, can ? 0x2e7d32 : 0xc2ccd8).setInteractive({ useHandCursor: can });
          const btnT = this.add.text(this.W - 68, y, can ? "作る" : "不足", { fontFamily: UI_FONT, fontSize: "13px", color: can ? "#ffffff" : "#9aa5b3" }).setOrigin(0.5);
          if (can) {
            btn.on("pointerdown", () => {
              const res = craftItem(key);
              if (res.ok) {
                this.toast(`「${def.label}」を作った！`);
                this.openCraftPanel("item", emotion);
              }
            });
          }
          c.add([btn, btnT]);
          y += 68;
        });
        c.add(this.add.text(this.W / 2, y + 2, "アイテムは出撃時に自動で使われる", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
        return;
      }

      // ── 装備制作（感情タブ＋レアリティ）──
      const tabW = 62;
      const startX = this.W / 2 - tabW * 1.5;
      C.EMOTION_ORDER.forEach((k, i) => {
        const x = startX + tabW * i;
        const active = k === emotion;
        const r = this.add
          .rectangle(x, 142, 54, 38, active ? 0xe9f1fb : 0xffffff)
          .setStrokeStyle(1, active ? C.EMOTIONS[k].color : 0xd6e2f0)
          .setInteractive({ useHandCursor: true });
        const t = this.add.text(x, 142, C.EMOTIONS[k].icon, { fontFamily: EMOJI_FONT, fontSize: "22px" }).setOrigin(0.5);
        r.on("pointerdown", () => this.openCraftPanel("equip", k));
        c.add([r, t]);
      });

      const emo = C.EMOTIONS[emotion];
      const have = s.materials[emotion] || 0;
      c.add(this.add.text(this.W / 2, 188, `${emo.icon}${emo.label}の素材： ${have}`, { fontFamily: UI_FONT, fontSize: "16px", color: "#22344a" }).setOrigin(0.5));

      let y = 230;
      C.EQUIPMENT.rarities.forEach((rar) => {
        const cost = C.CRAFT.costs[rar.key];
        const can = have >= cost;
        const row = this.add.rectangle(this.W / 2, y, this.W - 50, 50, 0xffffff).setStrokeStyle(1, 0xd6e2f0);
        const label = this.add.text(38, y - 9, `${emo.label}の残響〈${rar.label}〉`, { fontFamily: UI_FONT, fontSize: "15px", color: colorToCss(rar.color) }).setOrigin(0, 0.5);
        const costT = this.add.text(38, y + 12, `素材 ${cost}`, { fontFamily: UI_FONT, fontSize: "12px", color: can ? "#4c5e76" : "#c07a7a" }).setOrigin(0, 0.5);
        const btn = this.add
          .rectangle(this.W - 72, y, 84, 34, can ? 0x4caf50 : 0xe6ebf2)
          .setStrokeStyle(1, can ? 0x2e7d32 : 0xc2ccd8)
          .setInteractive({ useHandCursor: can });
        const btnT = this.add.text(this.W - 72, y, can ? "作る" : "素材不足", { fontFamily: UI_FONT, fontSize: "13px", color: can ? "#ffffff" : "#9aa5b3" }).setOrigin(0.5);
        if (can) {
          btn.on("pointerdown", () => {
            const res = craftEquipment(emotion, rar.key);
            if (res.ok) {
              this.toast(`「${res.item.name}〈${rar.label}〉」を作った！`);
              this.openCraftPanel("equip", emotion);
            }
          });
        }
        c.add([row, label, costT, btn, btnT]);
        y += 60;
      });

      c.add(this.add.text(this.W / 2, y + 8, "作った装備は「装備変更」から装備できます", { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a" }).setOrigin(0.5));
    });
  }

  // ---- 仲間プロフィール（愛着の核：出自・成長・お金で個体強化）----
  openCompanionPanel(bondedId) {
    const b = getSave().party.bonded.find((x) => x.id === bondedId);
    if (!b) {
      this.openPartyPanel();
      return;
    }
    this.openPanel(b.name, (c) => {
      const info = C.EMOTIONS[b.emotion] || { color: 0xb0b0c0, label: "" };
      const col = colorToCss(info.color);
      const rar = C.COMPANION.rarities.find((r) => r.key === b.rarity) || C.COMPANION.rarities[0];
      c.add(this.charPortrait(this.W / 2, 124, b.emotion, 96, b.icon, true, b));
      c.add(this.add.text(this.W / 2, 176, `${rar.star}【${rar.label}】`, { fontFamily: UI_FONT, fontSize: "13px", color: colorToCss(rar.color) }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 197, `〈${info.label}・${b.roleLabel}〉${b.evo ? "  ✦進化" : ""}　Lv${b.level || 1}`, { fontFamily: UI_FONT, fontSize: "13px", color: col }).setOrigin(0.5));
      const statStr = b.role === "healer" ? `✚ 癒し ${b.heal}　⚡ 速さ ${b.spd}` : `⚔ 攻撃 ${b.atk}　⚡ 速さ ${b.spd}`;
      c.add(this.add.text(this.W / 2, 212, statStr, { fontFamily: UI_FONT, fontSize: "16px", color: "#22344a" }).setOrigin(0.5));
      const voice = "●".repeat(b.stage) + "○".repeat(4 - b.stage);
      c.add(this.add.text(this.W / 2, 238, `声 ${voice}　／　ともに歩んだ旅 ${b.runs || 0} 回`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0.5));

      // 出自の一言（この子は、誰かが捨てた感情）
      const origins = C.COMPANION.origins[b.emotion] || [""];
      const origin = origins[(b.originIdx || 0) % origins.length] || "";
      c.add(this.add.rectangle(this.W / 2, 298, this.W - 60, 56, 0xe9f1fb, 0.98).setStrokeStyle(1, 0xaecbe8));
      c.add(this.add.text(this.W / 2, 282, "── 出自 ──", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 303, origin, { fontFamily: UI_FONT, fontSize: "13px", color: "#6a5e4c", align: "center", wordWrap: { width: this.W - 84 } }).setOrigin(0.5));

      // お金で個体強化
      const cost = companionUpgradeCost(b);
      const gold = getSave().gold;
      const can = gold >= cost;
      c.add(this.add.text(this.W / 2, 356, `🪙 ${gold}`, { fontFamily: UI_FONT, fontSize: "14px", color: "#b8860b" }).setOrigin(0.5));
      const up = this.add.rectangle(this.W / 2, 394, 250, 46, can ? 0x4caf50 : 0xe6ebf2).setStrokeStyle(1, can ? 0x2e7d32 : 0xc2ccd8).setInteractive({ useHandCursor: can });
      const upT = this.add.text(this.W / 2, 394, can ? `育てる（🪙 ${cost}）` : `お金不足（🪙 ${cost}）`, { fontFamily: UI_FONT, fontSize: "16px", color: can ? "#ffffff" : "#9aa5b3" }).setOrigin(0.5);
      if (can) {
        // ログウィズ流QoL：長押しで連続強化（トントン連打しなくていい）。離した時に画面を更新。
        let holdDelay = null;
        let holdTimer = null;
        let upgradedInHold = false;
        const doUp = () => {
          const r = upgradeCompanion(b.id);
          if (!r.ok) return false;
          upgradedInHold = true;
          if (r.milestone === "hyper") {
            // Lv10の倍数：超激強化（強い金フラッシュ）
            this.toast("🌟 超激強化！！ ステータス ×2.0");
            const fl = this.add.rectangle(this.W / 2, 394, 260, 54, 0xffe08a, 0.85).setDepth(250);
            this.tweens.add({ targets: fl, alpha: 0, scaleX: 1.35, scaleY: 1.6, duration: 620, ease: "Cubic.easeOut", onComplete: () => fl.destroy() });
          } else if (r.milestone === "super") {
            // Lv5の倍数：超強化（金フラッシュ）
            this.toast("⭐ 超強化！ ステータス ×1.5");
            const fl = this.add.rectangle(this.W / 2, 394, 254, 50, 0xffd24d, 0.6).setDepth(250);
            this.tweens.add({ targets: fl, alpha: 0, duration: 400, ease: "Cubic.easeOut", onComplete: () => fl.destroy() });
          } else {
            this.toast(`${b.name} が Lv${r.level} に育った`);
          }
          return true;
        };
        const stopHold = () => {
          if (holdDelay) {
            clearTimeout(holdDelay);
            holdDelay = null;
          }
          if (holdTimer) {
            clearInterval(holdTimer);
            holdTimer = null;
          }
          if (upgradedInHold) {
            upgradedInHold = false;
            this.openCompanionPanel(b.id); // まとめて反映（パネル再構築）
          }
        };
        up.on("pointerdown", () => {
          doUp();
          holdDelay = window.setTimeout(() => {
            holdTimer = window.setInterval(() => {
              if (!doUp()) stopHold(); // お金が尽きたら止める
            }, 200);
          }, 450);
        });
        up.on("pointerup", stopHold);
        up.on("pointerout", stopHold);
      }
      c.add([up, upT]);

      // 編成・見送る
      const tog = this.add.rectangle(this.W / 2 - 70, 456, 124, 40, b.active ? 0xeef7e4 : 0xffffff).setStrokeStyle(1, b.active ? 0x4caf50 : 0xd6e2f0).setInteractive({ useHandCursor: true });
      const togT = this.add.text(this.W / 2 - 70, 456, b.active ? "同行中" : "留守番", { fontFamily: UI_FONT, fontSize: "14px", color: b.active ? "#2e7d32" : "#4c5e76" }).setOrigin(0.5);
      tog.on("pointerdown", () => {
        const r = toggleCompanionActive(b.id);
        if (!r.ok && r.reason) this.toast(r.reason);
        this.refreshPartyBtn();
        this.openCompanionPanel(b.id);
      });
      const rel = this.add.rectangle(this.W / 2 + 70, 456, 124, 40, 0xf7ecf3).setStrokeStyle(1, 0xc79ad0).setInteractive({ useHandCursor: true });
      const relT = this.add.text(this.W / 2 + 70, 456, "見送る", { fontFamily: UI_FONT, fontSize: "14px", color: "#9a5aa8" }).setOrigin(0.5);
      rel.on("pointerdown", () => {
        releaseCompanion(b.id);
        this.toast(`${b.name}を 見送った（光に還した）`);
        this.refreshPartyBtn();
        this.openPartyPanel();
      });
      c.add([tog, togT, rel, relT]);

      c.add(this.add.text(this.W / 2, 500, "お金は旅の終わりに貯まる。この子に注げば、ずっと強くなる。", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a", align: "center", wordWrap: { width: this.W - 80 } }).setOrigin(0.5));
    });
  }

  // ---- 特別な仲間（直接購入：ガチャでなく"見て選んで迎える"）----
  openShopPanel() {
    this.openPanel("特別な仲間", (c) => {
      c.add(this.add.text(this.W / 2, 116, "見て、選んで迎える（ガチャではありません）", { fontFamily: UI_FONT, fontSize: "13px", color: "#4c5e76" }).setOrigin(0.5));
      let y = 164;
      C.SHOP_COMPANIONS.forEach((def) => {
        const owned = isShopOwned(def.id);
        const info = C.EMOTIONS[def.emotion];
        c.add(this.add.rectangle(this.W / 2, y, this.W - 50, 88, owned ? 0xeef7e4 : 0xffffff).setStrokeStyle(1, owned ? 0x4caf50 : info.color));
        if (this.textures.exists("shop_" + def.id)) c.add(this.add.image(46, y, "shop_" + def.id).setDisplaySize(58, 58));
        else c.add(this.add.text(46, y, def.icon, { fontFamily: EMOJI_FONT, fontSize: "34px" }).setOrigin(0.5));
        c.add(this.add.text(74, y - 26, `${def.name}　〈${def.label}〉`, { fontFamily: UI_FONT, fontSize: "15px", color: colorToCss(info.color) }).setOrigin(0, 0.5));
        c.add(this.add.text(74, y - 6, def.desc, { fontFamily: UI_FONT, fontSize: "11px", color: "#4c5e76", wordWrap: { width: this.W - 150 } }).setOrigin(0, 0.5));
        const statStr = def.role === "healer" ? `✚${def.heal}  ⚡${def.spd}` : `⚔${def.atk}  ⚡${def.spd}`;
        c.add(this.add.text(74, y + 24, `${statStr}　永続（散らない）`, { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0, 0.5));

        if (owned) {
          c.add(this.add.text(this.W - 40, y, "入手済 ✓", { fontFamily: UI_FONT, fontSize: "13px", color: "#2e7d32" }).setOrigin(1, 0.5));
        } else {
          const btn = this.add.rectangle(this.W - 64, y, 84, 40, 0xf1e9fb).setStrokeStyle(1, 0xa06ac0).setInteractive({ useHandCursor: true });
          const bt = this.add.text(this.W - 64, y - 8, `¥${def.price}`, { fontFamily: UI_FONT, fontSize: "13px", color: "#7a3ba8" }).setOrigin(0.5);
          const bt2 = this.add.text(this.W - 64, y + 10, "迎える", { fontFamily: UI_FONT, fontSize: "12px", color: "#7a3ba8" }).setOrigin(0.5);
          btn.on("pointerdown", () => {
            const res = buyShopCompanion(def.id);
            if (res.ok) {
              this.toast(`${def.name} を迎えた（「仲間」で編成・留守番に）`);
              this.refreshPartyBtn();
              this.openShopPanel();
            } else if (res.reason) {
              this.toast(res.reason); // 器がいっぱい等、迎えられない理由を伝える
            }
          });
          c.add([btn, bt, bt2]);
        }
        y += 100;
      });
      c.add(this.add.text(this.W / 2, y + 6, "※試作では確認用に入手できます（実際は直接購入）", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
    });
  }

  // ---- 導く心のツリー（設計書§8 ④：プレイヤー成長・実機能）----
  openTreePanel(branchKey = "vessel") {
    this.openPanel("導く心のツリー", (c) => {
      const s = getSave();
      const empUnlocked = empathyUnlocked();

      c.add(this.add.text(this.W / 2, 116, `悟り ${s.enlightenment}`, { fontFamily: UI_FONT, fontSize: "18px", color: "#1f6aa8" }).setOrigin(0.5));

      // 感情の熟練度（欠片の累計で育つ恒久ボーナス）を4列で
      c.add(this.add.text(this.W / 2, 140, "― 感情の熟練度（欠片の累計で育つ） ―", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
      const mi = masteryInfo();
      const colW = 92;
      const mStartX = this.W / 2 - (colW * (C.EMOTION_ORDER.length - 1)) / 2;
      C.EMOTION_ORDER.forEach((k, i) => {
        const x = mStartX + colW * i;
        const m = mi[k];
        const info = C.EMOTIONS[k];
        c.add(this.add.text(x - 26, 162, info.icon, { fontFamily: EMOJI_FONT, fontSize: "16px" }).setOrigin(0.5));
        c.add(this.add.text(x + 8, 162, `Lv.${m.level}`, { fontFamily: UI_FONT, fontSize: "13px", color: colorToCss(info.color) }).setOrigin(0.5));
        c.add(this.add.text(x, 180, `+${Math.round(m.bonus * 100)}%`, { fontFamily: UI_FONT, fontSize: "10px", color: "#74839a" }).setOrigin(0.5));
        // 進捗バー：現Lvの床→次Lvまで。next==null（MAX）は満タン
        const base = C.MASTERY.levelCurve * m.level * m.level;
        const frac = m.next == null ? 1 : Phaser.Math.Clamp((m.total - base) / (m.next - base), 0, 1);
        const bw2 = colW - 22;
        c.add(this.add.rectangle(x, 194, bw2, 4, 0xd0dceb).setOrigin(0.5));
        if (frac > 0) c.add(this.add.rectangle(x - bw2 / 2, 194, bw2 * frac, 4, info.color).setOrigin(0, 0.5));
      });

      // 枝タブ（器＋感情4＋共感）
      const branches = C.TREE.branches;
      const step = 56;
      const startX = this.W / 2 - (step * (branches.length - 1)) / 2;
      branches.forEach((br, i) => {
        const x = startX + step * i;
        const locked = br.hidden && !empUnlocked;
        const active = br.key === branchKey && !locked;
        const r = this.add
          .rectangle(x, 226, 48, 44, active ? 0xe9f1fb : 0xffffff)
          .setStrokeStyle(1, active ? br.color : locked ? 0xc7d2de : 0xd6e2f0)
          .setInteractive({ useHandCursor: true });
        const t = this.add.text(x, 224, locked ? "🔒" : br.icon, { fontFamily: EMOJI_FONT, fontSize: "22px" }).setOrigin(0.5).setAlpha(locked ? 0.5 : 1);
        r.on("pointerdown", () => {
          if (locked) {
            this.toast(`4つの感情を 各${C.TREE.empathyRequirePerEmotion}つ理解すると、中央に芽吹く`);
            return;
          }
          this.openTreePanel(br.key);
        });
        c.add([r, t]);
      });

      // 選択中の枝
      let br = branches.find((b) => b.key === branchKey);
      if (br.hidden && !empUnlocked) br = branches[0];
      c.add(this.add.text(this.W / 2, 264, `${br.icon} ${br.label}`, { fontFamily: UI_FONT, fontSize: "19px", color: colorToCss(br.color) }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 288, br.desc, { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a", align: "center", wordWrap: { width: this.W - 80 } }).setOrigin(0.5));

      // ノード一覧（線形：前ノードを1Lv以上が前提。繰り返しレベルアップできる）
      let y = 322;
      br.nodes.forEach((node, idx) => {
        const lv = nodeLevel(br.key, node.id);
        const max = nodeMax(node);
        const prevOk = idx === 0 || nodeLevel(br.key, br.nodes[idx - 1].id) >= 1;
        const atMax = lv >= max;
        const cost = nodeCost(node, lv);
        const canAfford = s.enlightenment >= cost;
        const purchasable = !atMax && prevOk && canAfford;
        const owned = lv > 0;

        const row = this.add
          .rectangle(this.W / 2, y, this.W - 50, 50, owned ? 0xeef7e4 : prevOk ? 0xffffff : 0xeef2f7)
          .setStrokeStyle(1, owned ? 0x4caf50 : prevOk ? 0xd6e2f0 : 0xdbe2ea);
        const dim = !owned && !prevOk ? 0.55 : 1;
        const nm = this.add.text(36, y - 12, `${node.label}　Lv${lv}/${max}`, { fontFamily: UI_FONT, fontSize: "15px", color: owned ? "#2e7d32" : "#22344a" }).setOrigin(0, 0.5).setAlpha(dim);
        const ds = this.add.text(36, y + 9, node.desc, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0, 0.5).setAlpha(dim);
        c.add([row, nm, ds]);

        if (atMax) {
          c.add(this.add.text(this.W - 40, y, "MAX", { fontFamily: UI_FONT, fontSize: "13px", color: "#2e7d32" }).setOrigin(1, 0.5));
        } else if (!prevOk) {
          c.add(this.add.text(this.W - 40, y, "前提が必要", { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a" }).setOrigin(1, 0.5));
        } else {
          const btn = this.add
            .rectangle(this.W - 72, y, 92, 38, purchasable ? 0xdbe8f7 : 0xe6ebf2)
            .setStrokeStyle(1, purchasable ? 0x5a9ad0 : 0xc2ccd8)
            .setInteractive({ useHandCursor: purchasable });
          const btnT = this.add.text(this.W - 72, y, `悟り ${cost}`, { fontFamily: UI_FONT, fontSize: "13px", color: purchasable ? "#1f6aa8" : "#9aa5b3" }).setOrigin(0.5);
          if (purchasable) {
            btn.on("pointerdown", () => {
              const res = unlockNode(br.key, node.id);
              if (res.ok) {
                this.toast(`「${res.node.label}」を Lv${res.level} に上げた`);
                this.refreshHomeStats();
                this.refreshTreeBtn();
                this.openTreePanel(br.key);
              }
            });
          }
          c.add([btn, btnT]);
        }
        y += 56;
      });
    });
  }

  // ---- 仲間（編成：同行/留守番・見送る）設計書§17 ----
  openPartyPanel() {
    this.openPanel("仲間", (c) => {
      const s = getSave();
      const cap = carryoverSlots();
      const bonded = s.party.bonded;
      const activeCount = bonded.filter((b) => b.active).length;

      c.add(this.add.text(36, 116, `🪙 ${s.gold}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#b8860b" }).setOrigin(0, 0.5));
      c.add(this.add.text(this.W / 2 - 6, 116, `魂の器　${bonded.length} / ${cap}`, { fontFamily: UI_FONT, fontSize: "16px", color: "#7a3ba8" }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 138, `同行 ${activeCount} / ${C.COMPANION.maxParty}（出撃に連れて行く）`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0.5));
      // 共鳴孵化（卵）の状況
      const eggs = s.party.eggs.length;
      const reson = Math.floor((s.party.resonance / C.COMPANION.resonance.threshold) * 100);
      const resStr = eggs > 0 ? `🥚 卵 ×${eggs}（次の旅で孵る）` : activeCount >= 2 ? `共鳴 ${reson}%（2体以上の同行で 卵が生まれる）` : "2体以上を同行させると、共鳴で卵が生まれる";
      c.add(this.add.text(this.W / 2, 158, resStr, { fontFamily: UI_FONT, fontSize: "11px", color: "#9a5aa8" }).setOrigin(0.5));
      // 特別な仲間（直接購入）への入口
      const shopBtn = this.add.rectangle(this.W - 58, 116, 96, 28, 0xf1e9fb).setStrokeStyle(1, 0xa06ac0).setInteractive({ useHandCursor: true });
      const shopT = this.add.text(this.W - 58, 116, "✦ 迎える", { fontFamily: UI_FONT, fontSize: "12px", color: "#7a3ba8" }).setOrigin(0.5);
      shopBtn.on("pointerdown", () => this.openShopPanel());
      c.add([shopBtn, shopT]);

      if (!bonded.length) {
        c.add(this.add.text(this.W / 2, 280, "まだ、誰も連れ越していない。\n\n旅で出会い、倒れて還る時に\n空きがあれば 魂の絆で繋がる。", { fontFamily: UI_FONT, fontSize: "16px", color: "#4c5e76", align: "center", lineSpacing: 8 }).setOrigin(0.5));
        return;
      }

      // ---- スクロールできるリスト（マスク＋ドラッグ/ホイール）----
      const viewTop = 176;
      const viewBottom = this.H - 70;
      const viewH = viewBottom - viewTop;
      const firstY = 190;
      const rowStep = 72;
      const rowH = 62;
      const list = this.add.container(0, 0);
      c.add(list);

      bonded.forEach((b, idx) => {
        const y = firstY + idx * rowStep;
        const emoColor = C.EMOTIONS[b.emotion] ? C.EMOTIONS[b.emotion].color : 0xb0b0c0;
        const rar = C.COMPANION.rarities.find((r) => r.key === b.rarity) || C.COMPANION.rarities[0];
        const row = this.add.rectangle(this.W / 2, y, this.W - 50, rowH, b.active ? 0xf3eefa : 0xffffff).setStrokeStyle(1, b.active ? emoColor : 0xd6e2f0);
        const icon = this.charPortrait(40, y, b.emotion, 50, b.icon, false, b);
        const nm = this.add.text(72, y - 15, `${b.name}〈${b.roleLabel}〉 Lv${b.level || 1}`, { fontFamily: UI_FONT, fontSize: "15px", color: colorToCss(emoColor) }).setOrigin(0, 0.5);
        const statStr = b.role === "healer" ? `✚${b.heal}  ⚡${b.spd}` : `⚔${b.atk}  ⚡${b.spd}`;
        const voice = "●".repeat(b.stage) + "○".repeat(4 - b.stage);
        const st = this.add.text(72, y + 8, `${rar.star}【${rar.label}】${statStr}　声 ${voice}`, { fontFamily: UI_FONT, fontSize: "12px", color: colorToCss(rar.color) }).setOrigin(0, 0.5);
        // 状態バッジ（表示のみ。切替は行タップ→詳細で）
        const badge = this.add.text(this.W - 40, y, b.active ? "同行" : "留守番", { fontFamily: UI_FONT, fontSize: "12px", color: b.active ? "#2e7d32" : "#74839a" }).setOrigin(1, 0.5);
        list.add([row, icon, nm, st, badge]);
      });

      let y = firstY + bonded.length * rowStep - rowStep / 2 + 8;
      // 魂の器の拡張（無料10 → 課金で最大20）。リスト内に置き、タップはゾーンで拾う。
      const info = rosterSlotInfo();
      let buyTop = null;
      let buyBottom = null;
      if (info.canBuyMore) {
        const by = y + 30;
        const br = this.add.rectangle(this.W / 2, by, 300, 48, 0xf1e9fb).setStrokeStyle(1, 0xa06ac0);
        const bl = this.add.text(this.W / 2, by, `魂の器を広げる  🪙${info.cost}  (+1枠 / 最大${info.max})`, { fontFamily: UI_FONT, fontSize: "14px", color: "#7a3ba8" }).setOrigin(0.5);
        const note = this.add.text(this.W / 2, by + 34, `無料 ${info.free}枠＋拡張 ${info.paid + info.tree}枠。同行は最大${C.COMPANION.maxParty}、残りは街で働く。`, { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a", align: "center" }).setOrigin(0.5);
        list.add([br, bl, note]);
        buyTop = by - 24;
        buyBottom = by + 24;
        y = by + 44;
      } else {
        const note = this.add.text(this.W / 2, y + 26, `魂の器は最大（${info.max}）に達している。\n同行は最大${C.COMPANION.maxParty}、残りは街で働いてもらおう。`, { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a", align: "center", lineSpacing: 5 }).setOrigin(0.5);
        list.add(note);
        y += 50;
      }
      const contentBottom = y + 10;

      // マスク（ビューポートの外は隠す）
      const mg = this.make.graphics();
      mg.fillStyle(0xffffff);
      mg.fillRect(12, viewTop, this.W - 24, viewH);
      mg.setVisible(false);
      c.add(mg);
      list.setMask(mg.createGeometryMask());

      const maxScroll = Math.max(0, contentBottom - viewBottom);
      const minY = -maxScroll;

      // スクロールバー
      let thumb = null;
      const updateBar = () => {
        if (!thumb) return;
        const t = maxScroll > 0 ? -list.y / maxScroll : 0;
        thumb.y = viewTop + 4 + t * (viewH - 8 - thumb.height);
      };
      if (maxScroll > 0) {
        c.add(this.add.rectangle(this.W - 16, (viewTop + viewBottom) / 2, 4, viewH, 0x1c3a5a, 0.1));
        const thumbH = Math.max(28, (viewH * viewH) / (contentBottom - viewTop));
        thumb = this.add.rectangle(this.W - 16, viewTop + 4 + thumbH / 2, 4, thumbH, 0x7a3ba8, 0.55);
        thumb.height = thumbH;
        c.add(thumb);
        c.add(this.add.text(this.W / 2, this.H - 50, "▲▼ ドラッグ／ホイールでスクロール", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a" }).setOrigin(0.5));
      }

      // 入力ゾーン：ドラッグでスクロール、軽いタップで行/ボタンを選択
      const zone = this.add.zone(this.W / 2, (viewTop + viewBottom) / 2, this.W - 24, viewH).setInteractive();
      c.add(zone);
      if (maxScroll > 0) this.input.setDraggable(zone);
      let downY = 0;
      let downListY = 0;
      zone.on("pointerdown", (p) => {
        downY = p.y;
        downListY = list.y;
      });
      zone.on("drag", (p) => {
        list.y = Phaser.Math.Clamp(downListY + (p.y - downY), minY, 0);
        updateBar();
      });
      zone.on("wheel", (p, dx, dy) => {
        list.y = Phaser.Math.Clamp(list.y - dy * 0.5, minY, 0);
        updateBar();
      });
      zone.on("pointerup", (p) => {
        if (Math.abs(p.y - downY) > 8) return; // ドラッグ＝スクロール操作
        const localY = p.y - list.y;
        const i = Math.round((localY - firstY) / rowStep);
        if (i >= 0 && i < bonded.length && Math.abs(localY - (firstY + i * rowStep)) <= rowH / 2) {
          this.openCompanionPanel(bonded[i].id);
          return;
        }
        if (buyTop != null && localY >= buyTop && localY <= buyBottom) {
          const r = buyRosterSlot();
          if (r.ok) {
            this.toast(`器が広がった（${r.cap}枠に）`);
            this.refreshPartyBtn();
            this.openPartyPanel();
          } else {
            this.toast(r.reason || "拡張できない");
          }
        }
      });
    });
  }

  // ---- セーブ（バックアップ／復元）：保存が効かない環境でもデータを守る ----
  openSavePanel() {
    this.openPanel("セーブ", (c) => {
      const failing = isSaveFailing();
      c.add(this.add.text(this.W / 2, 124, failing ? "⚠ このブラウザは保存が無効です" : "✓ 自動保存は有効です", { fontFamily: UI_FONT, fontSize: "16px", color: failing ? "#c23b3b" : "#2e7d32" }).setOrigin(0.5));
      c.add(this.add.text(this.W / 2, 158, failing ? "プライベートモードや制限が原因かも。\n下の「バックアップを表示」でコードを保管し、\n別の端末/ブラウザで「復元」できます。" : "念のため、ときどきバックアップを取ると安心です。", { fontFamily: UI_FONT, fontSize: "13px", color: "#4c5e76", align: "center", lineSpacing: 6, wordWrap: { width: this.W - 70 } }).setOrigin(0.5));

      const b1 = this.makeButton(this.W / 2, 250, 280, 52, "📋 バックアップを表示", () => {
        const code = exportSave();
        if (typeof window !== "undefined" && window.prompt) window.prompt("このコードを長押しでコピーして保管してください", code);
      }, { color: 0xe9f1fb, stroke: 0x5a9ad0, textColor: "#1f6aa8", fontSize: "16px" });
      c.add([b1.gfx, b1.rect, b1.txt, b1.badge]); // gfx(塗り)を最背面に

      const b2 = this.makeButton(this.W / 2, 318, 280, 52, "♻ 復元する（コードを貼り付け）", () => {
        const code = typeof window !== "undefined" && window.prompt ? window.prompt("バックアップコードを貼り付けてください", "") : "";
        if (!code) return;
        const r = importSave(code);
        if (r.ok) {
          this.toast("復元しました");
          this.time.delayedCall(400, () => this.scene.restart());
        } else {
          this.toast("コードが正しくありません");
        }
      }, { color: 0xf1e9fb, stroke: 0xa06ac0, textColor: "#7a3ba8", fontSize: "15px" });
      c.add([b2.gfx, b2.rect, b2.txt, b2.badge]); // gfx(塗り)を最背面に

      c.add(this.add.text(this.W / 2, 400, "※スマホで保存が消える時は、ブラウザの『プライベート/シークレット』を解除するか、\nこのコードを保管してください。", { fontFamily: UI_FONT, fontSize: "11px", color: "#74839a", align: "center", lineSpacing: 5, wordWrap: { width: this.W - 70 } }).setOrigin(0.5));
    });
  }

  toast(msg) {
    const t = this.add
      .text(this.W / 2, this.H - 80, msg, {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: "#ffd24d",
        backgroundColor: "rgba(0,0,0,0.7)",
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(300);
    this.tweens.add({ targets: t, alpha: 0, y: this.H - 110, duration: 1300, delay: 500, onComplete: () => t.destroy() });
  }

  // ---- 感情の結晶（アーティファクト図鑑：持つだけで恒久%強化 DR④）----
  openItemPanel() {
    this.openPanel("感情の結晶", (c) => {
      const arts = getSave().artifacts;
      const b = getArtifactBonuses();
      c.add(this.add.text(this.W / 2, 116, `集めた結晶　${arts.length} 個`, { fontFamily: UI_FONT, fontSize: "17px", color: "#b8860b" }).setOrigin(0.5));

      if (!arts.length) {
        c.add(this.add.text(this.W / 2, 270, "まだ、結晶はない。\n\n旅を終えるたびに ときどき宿る。\n持っているだけで、力になる。", { fontFamily: UI_FONT, fontSize: "16px", color: "#4c5e76", align: "center", lineSpacing: 8 }).setOrigin(0.5));
        return;
      }

      c.add(this.add.text(this.W / 2, 150, "── いま積み上げた力 ──", { fontFamily: UI_FONT, fontSize: "13px", color: "#74839a" }).setOrigin(0.5));
      let y = 184;
      C.ARTIFACT.stats.forEach((st) => {
        const v = b[st.key] || 0;
        const has = v > 0;
        c.add(this.add.text(this.W / 2 - 120, y, `${st.icon} ${st.label}`, { fontFamily: UI_FONT, fontSize: "16px", color: has ? "#22344a" : "#9aa5b3" }).setOrigin(0, 0.5));
        c.add(this.add.text(this.W / 2 + 120, y, has ? `+${v}%` : "—", { fontFamily: UI_FONT, fontSize: "16px", color: has ? "#b8860b" : "#9aa5b3" }).setOrigin(1, 0.5));
        y += 34;
      });
      c.add(this.add.text(this.W / 2, y + 16, "結晶は転生でも消えない。集めるほど、強くなる。", { fontFamily: UI_FONT, fontSize: "12px", color: "#74839a" }).setOrigin(0.5));
    });
  }

  // ---- お知らせ（運営／物語 タブ）----
  // 感情図鑑：到達した進化形態のコレクション（未到達は❓）
  renderDex(c) {
    // 基本進化は主人公のpixelアート、混合/三重/闇堕ち/精霊は絵文字。
    const single = [];
    C.EMOTION_ORDER.forEach((k) => C.EVOLUTION_STAGES.forms[k].forEach((f, s) => single.push({ tex: "hero_" + k + "_" + (s + 1), name: f.name })));
    const mixed = Object.values(C.MIXED_EVOLUTION.forms).map((f) => ({ icon: f.icon, name: f.name }));
    const triple = Object.values(C.TRIPLE_EVOLUTION.forms).map((f) => ({ icon: f.icon, name: f.name }));
    // 闇堕ちは明るい方針で封印中（到達不可）→ 図鑑からは非表示。永遠に埋まらない❓枠を見せない。
    const spirit = [{ icon: "🌈", name: "感情の精霊" }];
    const cats = [
      { label: "はじまり", forms: [{ tex: "hero_slime", name: "スライム", always: true }] },
      { label: "基本進化", forms: single },
      { label: "混合進化", forms: mixed },
      { label: "三重混合", forms: triple },
      { label: "頂点", forms: spirit },
    ];
    const flat = [...single, ...mixed, ...triple, ...spirit];
    const seenAll = flat.filter((f) => formSeen(f.name)).length;
    c.add(this.add.text(this.W / 2, 150, `感情図鑑　${seenAll} / ${flat.length}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#22344a" }).setOrigin(0.5));

    const list = this.add.container(0, 0);
    c.add(list);
    const cols = 4;
    const cellW = (this.W - 40) / cols;
    const cellH = 66;
    let y = 180;
    cats.forEach((cat) => {
      const got = cat.forms.filter((f) => f.always || formSeen(f.name)).length;
      list.add(this.add.text(24, y, `${cat.label}  ${got}/${cat.forms.length}`, { fontFamily: UI_FONT, fontSize: "12px", color: "#4c5e76" }).setOrigin(0, 0.5));
      y += 22;
      cat.forms.forEach((f, i) => {
        const cx = 24 + cellW * (i % cols) + cellW / 2;
        const cy = y + Math.floor(i / cols) * cellH + 20;
        const seen = f.always || formSeen(f.name);
        if (seen && f.tex && this.textures.exists(f.tex)) {
          list.add(this.add.image(cx, cy, f.tex).setDisplaySize(42, 42));
        } else if (seen && f.icon) {
          list.add(this.add.text(cx, cy, f.icon, { fontFamily: EMOJI_FONT, fontSize: "26px" }).setOrigin(0.5));
        } else {
          list.add(this.add.text(cx, cy, "❓", { fontFamily: UI_FONT, fontSize: "22px", color: "#9aa5b3" }).setOrigin(0.5));
        }
        list.add(this.add.text(cx, cy + 24, seen ? f.name : "？？？", { fontFamily: UI_FONT, fontSize: "9px", color: seen ? "#4c5e76" : "#9aa5b3", align: "center", wordWrap: { width: cellW - 4 } }).setOrigin(0.5, 0));
      });
      y += Math.ceil(cat.forms.length / cols) * cellH + 10;
    });
    // 図鑑用に主人公進化アートを読み込む（未ロードなら）
    this.attachScroll(c, list, 168, this.H - 56, y + 10);
  }

  openNoticePanel(tab) {
    markNoticesRead([...NOTICES.ops.map((n) => n.id), ...NOTICES.story.map((n) => n.id)]);
    this.refreshNoticeBadge();
    this.openPanel("お知らせ", (c) => {
      const mkTab = (x, key, label) => {
        const active = tab === key;
        const r = this.add
          .rectangle(x, 128, 84, 34, active ? 0xdbe8f7 : 0xffffff)
          .setStrokeStyle(1, active ? 0x5a9ad0 : 0xd6e2f0)
          .setInteractive({ useHandCursor: true });
        const t = this.add.text(x, 128, label, { fontFamily: UI_FONT, fontSize: "14px", color: active ? "#1f6aa8" : "#74839a" }).setOrigin(0.5);
        r.on("pointerdown", () => this.openNoticePanel(key));
        c.add([r, t]);
      };
      mkTab(this.W / 2 - 138, "ops", "運営");
      mkTab(this.W / 2 - 46, "story", "物語");
      mkTab(this.W / 2 + 46, "diary", "日記");
      mkTab(this.W / 2 + 138, "dex", "図鑑");

      if (tab === "dex") {
        this.renderDex(c);
        return;
      }

      // スクロールできるリスト（枠はみ出し防止）
      const list = this.add.container(0, 0);
      c.add(list);
      let y = 168;

      if (tab === "diary") {
        const diary = getSave().diary;
        if (!diary.length) {
          list.add(this.add.text(this.W / 2, 240, "まだ、日記はない。\n旅を終えるたびに、一行ずつ綴られる。", { fontFamily: UI_FONT, fontSize: "15px", color: "#4c5e76", align: "center", lineSpacing: 8 }).setOrigin(0.5));
        } else {
          diary.slice(0, 30).forEach((e) => {
            const icon = e.emotion ? C.EMOTIONS[e.emotion].icon : "·";
            list.add(this.add.text(30, y, `${icon}`, { fontFamily: EMOJI_FONT, fontSize: "16px" }).setOrigin(0, 0));
            const body = this.add.text(56, y, e.text, { fontFamily: UI_FONT, fontSize: "14px", color: "#4c5e76", wordWrap: { width: this.W - 92 }, lineSpacing: 4 });
            list.add(body);
            y += Math.max(26, body.height) + 14;
          });
        }
      } else {
        NOTICES[tab].forEach((n) => {
          list.add(this.add.text(34, y, "▸ " + n.title, { fontFamily: UI_FONT, fontSize: "16px", color: "#22344a" }));
          const body = this.add.text(34, y + 26, n.body, { fontFamily: UI_FONT, fontSize: "14px", color: "#4c5e76", wordWrap: { width: this.W - 70 }, lineSpacing: 4 });
          list.add(body);
          y += 30 + body.height + 18;
        });
      }
      this.attachScroll(c, list, 156, this.H - 56, y + 10);
    });
  }

  // パネル内リストをマスク＋ドラッグ/ホイールでスクロール可能にする（枠はみ出し防止）
  attachScroll(c, list, viewTop, viewBottom, contentBottom, onTap, rows) {
    const viewH = viewBottom - viewTop;
    const mg = this.make.graphics();
    mg.fillStyle(0xffffff);
    mg.fillRect(12, viewTop, this.W - 24, viewH);
    mg.setVisible(false);
    c.add(mg);
    list.setMask(mg.createGeometryMask());
    const maxScroll = Math.max(0, contentBottom - viewBottom);
    const minY = -maxScroll;
    let thumb = null;
    const updateBar = () => {
      if (thumb) {
        const t = maxScroll > 0 ? -list.y / maxScroll : 0;
        thumb.y = viewTop + 4 + t * (viewH - 8 - thumb.height);
      }
    };
    if (maxScroll > 0) {
      c.add(this.add.rectangle(this.W - 16, (viewTop + viewBottom) / 2, 4, viewH, 0x1c3a5a, 0.1));
      const th = Math.max(28, (viewH * viewH) / (contentBottom - viewTop));
      thumb = this.add.rectangle(this.W - 16, viewTop + 4 + th / 2, 4, th, 0x7a3ba8, 0.55);
      thumb.height = th;
      c.add(thumb);
    }
    const zone = this.add.zone(this.W / 2, (viewTop + viewBottom) / 2, this.W - 24, viewH).setInteractive();
    c.add(zone);
    if (maxScroll > 0) this.input.setDraggable(zone);
    let downY = 0;
    let downListY = 0;
    let moved = 0;
    zone.on("pointerdown", (p) => {
      downY = p.y;
      downListY = list.y;
      moved = 0;
    });
    zone.on("drag", (p) => {
      moved = Math.max(moved, Math.abs(p.y - downY));
      list.y = Phaser.Math.Clamp(downListY + (p.y - downY), minY, 0);
      updateBar();
    });
    zone.on("wheel", (p, dx, dy) => {
      list.y = Phaser.Math.Clamp(list.y - dy * 0.5, minY, 0);
      updateBar();
    });
    // タップで項目を選ぶ（操作可能なスクロールリスト用）。ドラッグはタップ扱いしない。
    if (onTap && rows && rows.length) {
      zone.on("pointerup", (p) => {
        if (moved > 8 || Math.abs(p.y - downY) > 8) return; // ドラッグ/スワイプはタップ扱いしない（非スクロール時も）
        const localY = p.y - list.y;
        let best = null;
        let bestD = 26;
        for (const r of rows) {
          const d = Math.abs(r.y - localY);
          if (d < bestD) {
            bestD = d;
            best = r;
          }
        }
        if (best) onTap(best.id);
      });
    }
  }

  // 帰宅後の「次の一手」を1つだけ提示（迷子防止）。即戦力→恒久成長→旅の順で薦める。
  recommendNextAction() {
    const s = getSave();
    if (s.equipment.equipped.length < effectiveEquipSlots() && s.equipment.owned.length > s.equipment.equipped.length)
      return "「🛡 装備変更」で 拾った残響を 装備できます";
    if ((s.enlightenment || 0) >= 3) return "「導く心のツリー」で 悟りを 力に変えられます";
    if ((s.gold || 0) >= 100) return "「仲間」の強化や「特別な仲間」に お金を使えます";
    if (s.party.bonded.some((b) => !b.active)) return "「仲間」から 同行メンバーを 見直せます";
    return "支度を整えて、また 旅立ちましょう";
  }

  // ---- おかえり（帰還サマリー）----
  showReturnSummary(sum) {
    const c = this.add.container(0, 0).setDepth(240);
    const bg = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x1a2a3e, 0.6).setInteractive();
    const card = this.add.rectangle(this.W / 2, this.H / 2, this.W - 50, 460, 0xf3f8ff, 0.98).setStrokeStyle(1, 0xaecbe8);
    c.add([bg, card]);

    const cx = this.W / 2;
    let y = this.H / 2 - 150;
    c.add(this.add.text(cx, y, sum.died ? "── 今日の旅は、ここまで ──" : "── 帰ってきた ──", { fontFamily: DISPLAY_FONT, fontSize: "20px", color: "#1c3a5a" }).setOrigin(0.5));
    y += 46;
    c.add(this.add.text(cx, y, `今回の旅　${sum.distance}m${sum.newBest ? "　★最高更新!" : ""}`, { fontFamily: UI_FONT, fontSize: "17px", color: sum.newBest ? "#b8860b" : "#22344a" }).setOrigin(0.5));
    y += 40;
    c.add(this.add.text(cx, y, "集めた想いは、ちゃんと残っている。\n次は、もう少し遠くへ。", { fontFamily: UI_FONT, fontSize: "15px", color: "#2e7d6a", align: "center", lineSpacing: 6 }).setOrigin(0.5));
    y += 62;
    c.add(this.add.text(cx, y, `魂レベル +${sum.levelGain}　→　Lv.${sum.newLevel}`, { fontFamily: UI_FONT, fontSize: "18px", color: "#2e7d32" }).setOrigin(0.5));
    y += 30;
    if (sum.satoriGain > 0) {
      c.add(this.add.text(cx, y, `導く心は 旅から学んだ　悟り +${sum.satoriGain}`, { fontFamily: UI_FONT, fontSize: "16px", color: "#1f6aa8" }).setOrigin(0.5));
    }
    y += 28;
    if (sum.resonanceKey) {
      c.add(this.add.text(cx, y, `記憶の傾向　${C.EMOTIONS[sum.resonanceKey].icon}${C.EMOTIONS[sum.resonanceKey].label}`, { fontFamily: UI_FONT, fontSize: "15px", color: "#4c5e76" }).setOrigin(0.5));
    }
    // 仲間の去就（魂の絆で繋がる／光に還る ── §17の核）
    if (sum.companionsBonded && sum.companionsBonded.length) {
      y += 28;
      const names = sum.companionsBonded.map((cp) => `${cp.icon}${cp.name}`).join("　");
      c.add(this.add.text(cx, y, names, { fontFamily: UI_FONT, fontSize: "15px", color: "#7a3ba8", align: "center", wordWrap: { width: this.W - 110 } }).setOrigin(0.5));
      y += 22;
      c.add(this.add.text(cx, y, "魂の絆で 繋がった（連れて還った）", { fontFamily: UI_FONT, fontSize: "13px", color: "#9a5aa8" }).setOrigin(0.5));
    }
    if (sum.companionsDispersed && sum.companionsDispersed.length) {
      y += 28;
      const names = sum.companionsDispersed.map((cp) => `${cp.icon}${cp.name}`).join("　");
      c.add(this.add.text(cx, y, names, { fontFamily: UI_FONT, fontSize: "15px", color: "#4c5e76", align: "center", wordWrap: { width: this.W - 110 } }).setOrigin(0.5));
      y += 22;
      c.add(this.add.text(cx, y, "光になって還っていった", { fontFamily: UI_FONT, fontSize: "13px", color: "#7a6a80" }).setOrigin(0.5));
    }

    // 次の一手（帰宅後に迷子にさせない＝方向を1つ提示）
    const rec = this.recommendNextAction();
    if (rec) c.add(this.add.text(cx, this.H / 2 + 146, "▸ " + rec, { fontFamily: UI_FONT, fontSize: "15px", color: "#b8860b", align: "center", wordWrap: { width: this.W - 100 } }).setOrigin(0.5));

    const btnY = this.H / 2 + 190;
    const r = this.add.rectangle(cx, btnY, 200, 50, 0x4caf50).setStrokeStyle(1, 0x2e7d32).setInteractive({ useHandCursor: true });
    const t = this.add.text(cx, btnY, "ホームへ", { fontFamily: UI_FONT, fontSize: "18px", color: "#ffffff" }).setOrigin(0.5);
    r.on("pointerdown", () => {
      c.destroy(true);
      this.refreshHomeStats();
    });
    c.add([r, t]);
  }
}
