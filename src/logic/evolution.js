// =====================================================================
//  evolution.js  ── 感情の累計管理 ＋ 進化判定（設計書§3・§4）
//  判定は「比率」：累計で最も割合の高い感情の系統へ進化。
// =====================================================================

import { EVOLUTION, EMOTION_ORDER, DIMINISH } from "../data/config.js";

export function createEmotionState() {
  return { anger: 0, sadness: 0, courage: 0, hope: 0 };
}

// 宿った感情を加算。逓減ONなら、既に多い感情ほど価値が下がる。
// opts.resonanceKey + opts.resonanceBonus で、転生の「記憶の共鳴」を反映（設計書§6）。
// opts.fragMult[key] で、こころの木の欠片獲得ボーナスを反映（設計書§8）。
export function gainEmotions(state, emotions, opts = {}) {
  const gained = [];
  for (const key of emotions) {
    let amount = 1;
    if (DIMINISH.enabled) {
      amount = Math.pow(DIMINISH.factorPerStack, state[key]);
    }
    if (opts.resonanceKey && key === opts.resonanceKey) {
      amount *= 1 + (opts.resonanceBonus || 0);
    }
    if (opts.fragMult && opts.fragMult[key]) {
      amount *= 1 + opts.fragMult[key];
    }
    state[key] += amount;
    gained.push({ key, amount });
  }
  return gained;
}

// 現在いちばん多い感情
export function leadingEmotion(state) {
  let max = EMOTION_ORDER[0];
  let maxVal = -1;
  for (const key of EMOTION_ORDER) {
    if (state[key] > maxVal) {
      maxVal = state[key];
      max = key;
    }
  }
  return { key: max, value: maxVal };
}

// 2番目に多い感情（混合進化判定用）
export function secondEmotion(state) {
  const sorted = EMOTION_ORDER.map((k) => ({ key: k, value: state[k] })).sort((a, b) => b.value - a.value);
  return sorted[1] || { key: null, value: 0 };
}

// 初進化判定：いずれかが閾値到達なら、最大の感情系統を返す。なければ null。
// threshold はツリーで下げられるため、呼び出し側から実効値を渡せる（設計書§8）。
export function checkEvolution(state, threshold = EVOLUTION.threshold) {
  const lead = leadingEmotion(state);
  if (lead.value >= threshold) return lead.key;
  return null;
}
