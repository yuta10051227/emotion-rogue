// =====================================================================
//  facing.js ── スプライトの向きの「唯一の真実」。向きのバグは必ずここだけ直す。
//
//  ラクリマの戦闘は 味方=左／敵=右 に立つ。
//   ・味方(主人公・相棒・仲間) は 右(敵) を向くべき。
//   ・敵(雑魚・ボス) は 左(味方) を向くべき。
//  だが元絵(AI生成)の向きはキーごとにバラバラ。そこで「元絵がどっちを向いているか」を
//  カテゴリごとの既定＋例外リストで1箇所に宣言する。
//
//  【既定】味方の元絵＝右向き / 敵の元絵＝左向き（各カテゴリの多数派）。
//  【例外】下の Set にキーを列挙するだけ。新アートを足したら ここで1回タグ付けする。
//  ── これで「歩き/攻撃だけ後ろを向く」等の取りこぼしを、この表の追加漏れとして一元管理できる。
// =====================================================================

// 味方で「元絵が左向き」＝右(敵)を向かせるのに反転が要るキー。
export const ALLY_FACE_LEFT = new Set([
  // 主人公スライム
  "hero_slime", "hero_slime_walk", "hero_slime_atk",
  // 怒り系
  "hero_anger_1", "hero_anger_1_walk", "hero_anger_2_atk", "hero_anger_3_atk",
  // 勇気系
  "hero_courage_1", "hero_courage_1_walk", "hero_courage_1_atk",
  "hero_courage_2", "hero_courage_2_walk", "hero_courage_2_atk", "hero_courage_3_atk",
  // 悲しみ系
  "hero_sadness_1_walk", "hero_sadness_1_atk", "hero_sadness_2_atk",
  // 希望系
  "hero_hope_1_atk", "hero_hope_3_atk",
  // 仲間(char_*)
  "char_anger", "char_sadness", "char_courage", "char_sadness_atk", "char_hope_atk",
  // 主人公の子供(kid_*)は 素の絵が全て右向き ＝ ここには入れない
  //  （kid_boy_walk を誤って入れて「歩くと後ろ向き」になっていたのを 2026-07-12 に修正）
]);

// 敵で「元絵が右向き」＝左(味方)を向かせるのに反転が要るキー。
export const ENEMY_FACE_RIGHT = new Set([
  "enemy_ruins_anger", // 右向きの剣士
  "boss_hope_atk", // 右へ突撃
  "boss_sadness_atk", // 頭が右向き
]);

// 味方スプライトを 右(敵) に向ける。テクスチャ差し替えのたびに呼ぶ。
export function faceEnemy(sprite, key) {
  if (!sprite || !sprite.setFlipX) return;
  sprite.setFlipX(ALLY_FACE_LEFT.has(key)); // 左向きの元絵だけ反転
}
// 敵スプライトを 左(味方) に向ける。テクスチャ差し替えのたびに呼ぶ。
export function faceHero(sprite, key) {
  if (!sprite || !sprite.setFlipX) return;
  sprite.setFlipX(ENEMY_FACE_RIGHT.has(key)); // 右向きの元絵だけ反転
}
