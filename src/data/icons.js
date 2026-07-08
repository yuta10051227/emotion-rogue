// =====================================================================
//  icons.js ── 絵文字 → 自作SVGアイコンの対応・読込・生成ヘルパー
//  SVGは public/chars/icons/<key>.svg（Viteが "chars/icons/…" で配信）。
//  load.svg で少し大きめ(128px)にラスタライズし、表示時に縮小＝くっきり。
//  対応が無いグリフは絵文字テキストにフォールバックするので、段階導入できる。
// =====================================================================

// 絵文字グリフ → アセットキー。異体字（U+FE0F 付き）も同じ先へ寄せる。
export const EMOJI_TO_ICON = {
  "🔥": "emotion_anger",
  "💧": "emotion_sadness",
  "⚡": "emotion_courage",
  "✨": "emotion_hope",
  "💰": "currency_gold",
  "🪙": "currency_gold",
  "💎": "artifact_crystal",
  "🥚": "item_egg",
  "❤": "stat_hp_heart",
  "❤️": "stat_hp_heart",
  "⚔": "stat_attack",
  "⚔️": "stat_attack",
  "✚": "stat_healing",
  "🛡": "stat_defense",
  "🛡️": "stat_defense",
  "🍀": "stat_luck",
  "🏠": "ui_home",
  "🌳": "ui_tree_skill",
  "🤝": "ui_companion",
  "🏅": "ui_achievement",
  "🕳": "ui_abyss",
  "🕳️": "ui_abyss",
  "📖": "ui_dex",
  "⭐": "upgrade_high",
  "🌟": "upgrade_super_high",
};

// 重複を除いた実アセットキー一覧（読込用）
export const ICON_KEYS = Array.from(new Set(Object.values(EMOJI_TO_ICON)));

const RASTER = 128; // ラスタライズ解像度（表示は縮小されるのでくっきり）
const TEX = (key) => "icon_" + key; // テクスチャキー衝突回避のプレフィックス

// シーンの preload() から呼ぶ：全アイコンSVGを読み込む
export function preloadIcons(scene) {
  for (const key of ICON_KEYS) {
    if (scene.textures.exists(TEX(key))) continue;
    scene.load.svg(TEX(key), "chars/icons/" + key + ".svg", { width: RASTER, height: RASTER });
  }
}

// グリフ or アセットキー → 使えるテクスチャキー（無ければ null）
export function iconTexFor(glyphOrKey) {
  let key = EMOJI_TO_ICON[glyphOrKey] || (ICON_KEYS.includes(glyphOrKey) ? glyphOrKey : null);
  return key ? TEX(key) : null;
}

// アイコン画像を作る。対応が無ければ絵文字テキストにフォールバック。
//  size = 表示ピクセル（正方）。emojiFont = フォールバック時の絵文字フォント。
export function makeIcon(scene, x, y, glyphOrKey, size, emojiFont) {
  const tex = iconTexFor(glyphOrKey);
  if (tex && scene.textures.exists(tex)) {
    const img = scene.add.image(x, y, tex).setOrigin(0.5);
    img.setDisplaySize(size, size);
    img.isIcon = true; // 呼び出し側が画像/テキストを見分けられるように
    return img;
  }
  return scene.add.text(x, y, glyphOrKey, { fontFamily: emojiFont || "sans-serif", fontSize: Math.round(size) + "px" }).setOrigin(0.5);
}
