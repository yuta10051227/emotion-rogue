// =====================================================================
//  companion.js  ── 仲間（救った感情）の生成と「声」（設計書§17）
//  仲間は旅の中だけの存在（転生で散る）。戦闘では被弾しない助太刀。
//  感情 → 役割：怒り=前衛火力／悲しみ=癒し／勇気=先制／希望=逆転の一手。
// =====================================================================

import { COMPANION, ENEMY_BASE } from "../data/config.js";

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 距離で高レア寄りに重みをずらして抽選。minKey があればそのレアを下限に。
export function rollCompanionRarity(distance, minKey) {
  const rs = COMPANION.rarities;
  const shift = Math.max(0, distance) * COMPANION.rarityDepthBias; // 深いほど上位が重くなる
  const weights = rs.map((r, i) => Math.max(0.05, r.weight * Math.pow(1 + shift, i)));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  let idx = 0;
  for (let i = 0; i < rs.length; i++) {
    x -= weights[i];
    if (x <= 0) {
      idx = i;
      break;
    }
  }
  if (minKey) {
    const minIdx = rs.findIndex((r) => r.key === minKey);
    if (minIdx > idx) idx = minIdx;
  }
  return rs[idx];
}

export function rarityInfo(key) {
  return COMPANION.rarities.find((r) => r.key === key) || COMPANION.rarities[0];
}

// 浄化された感情から仲間を1体つくる。強さは「出会った距離」×「レア度」でスケール（脇役係数つき）。
//  opts.minRarity … 下限レア（ボス撃破など）。opts.rarity … レア固定。
export function makeCompanion(emotion, distance, id, opts = {}) {
  const factor = Math.pow(ENEMY_BASE.growth, distance / 10);
  const r = COMPANION.roles[emotion];
  const scale = COMPANION.statScale;
  const rar = opts.rarity ? rarityInfo(opts.rarity) : rollCompanionRarity(distance, opts.minRarity);
  const m = rar.statMult;
  return {
    id,
    emotion,
    role: r.role,
    icon: r.icon,
    roleLabel: r.label,
    name: pick(COMPANION.names[emotion]),
    rarity: rar.key, // レア度（並/希/極/神話）
    atk: Math.max(1, Math.round(COMPANION.base.atk * factor * scale * m)),
    heal: Math.max(1, Math.round(COMPANION.base.heal * factor * scale * m)),
    spd: COMPANION.base.spd + Math.floor(Math.random() * 3) + (m >= 2 ? 1 : 0),
    joinedAt: Math.floor(distance),
    gauge: 0, // 戦闘ごとに reset される行動ゲージ
    stage: 1, // 声の段階（同行で上がる）
    evo: 0, // 進化したか（同行で上がる）
    level: 1, // 個体強化レベル（お金で永続強化）
    runs: 0, // ともに歩んだ旅の数（愛着の指標）
    originIdx: Math.floor(Math.random() * (COMPANION.origins[emotion] || [""]).length), // 出自の一言
  };
}

// 同行距離から「声」の段階（1〜4）を求める（設計書§17-2）
export function voiceStage(comp, currentDistance) {
  const traveled = Math.max(0, currentDistance - comp.joinedAt);
  return Math.min(4, 1 + Math.floor(traveled / COMPANION.voiceDistancePerStage));
}

// その段階のセリフを1つ返す
export function pickVoiceLine(stage) {
  const lines = COMPANION.voiceLines[stage] || COMPANION.voiceLines[1];
  return pick(lines);
}
