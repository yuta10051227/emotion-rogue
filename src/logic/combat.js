// =====================================================================
//  combat.js  ── 1戦闘の処理 ＋「戦い方」判定 → 宿る感情を返す
//  設計書§4-3・§5 に準拠。戦闘は完全自動。
//  ATB方式：毎ティック spd を行動ゲージに加算し、閾値到達で攻撃。
//  これにより「素早さ差」が攻撃回数に効く（＝勇気＝先制撃破が表現できる）。
// =====================================================================

import { COMBAT, EMOTION_RULES, COMPANION, SKILL, BOSS, CRIT } from "../data/config.js";

function rollDamage(atk) {
  const r = 0.9 + Math.random() * 0.2; // 乱数 0.9〜1.1（設計書§5）
  return Math.max(1, Math.round(atk * r));
}

// ボスは1発で最大HPの一定割合までしか削れない＝即溶け（画面から"消える"）を防ぎ、殴り合いを白熱させる
function capBoss(dmg, enemy) {
  if (enemy && enemy.boss && BOSS.maxHitFrac) return Math.min(dmg, Math.max(1, Math.ceil(enemy.maxHp * BOSS.maxHitFrac)));
  return dmg;
}

// 被ダメ軽減：DEFが高いほど食らうダメージが減る（設計§5：ATK×100/(100+DEF)）。悲しみ=盾。
function mitigate(dmg, def) {
  if (!def || def <= 0) return dmg;
  return Math.max(1, Math.round(dmg * (100 / (100 + def))));
}

// 会心判定：LUKが高いほど会心（大ダメージ）。希望=逆転のバースト。
function rollCrit(luk) {
  const chance = Math.min(CRIT.maxChance, (luk || 0) * CRIT.chancePerLuk);
  return Math.random() < chance;
}

// 戦闘オブジェクトを生成。hero/enemy は { hp, maxHp, atk, spd }
// allies（仲間）は被弾しない助太刀。各 { id, role, atk, heal, spd, gauge }（設計書§17）。
export function createBattle(hero, enemy, allies = [], opts = {}) {
  for (const a of allies) a.gauge = 0; // 戦闘ごとに行動ゲージをリセット
  return {
    hero,
    enemy,
    allies,
    heroGauge: 0,
    enemyGauge: 0,
    heroAttacks: 0, // 技ゲージ用：主人公の攻撃回数
    skillEvery: opts.skillEvery || SKILL.heroEvery, // ツリーで短縮可
    skillMult: opts.skillMult || SKILL.heroMult, // ツリーで強化可
    // 判定用に記録する値（設計書§4-3）
    turnsToWin: 0, // 主人公の攻撃回数
    damageTaken: 0, // 主人公が受けた総ダメージ
    enemyAttacked: 0, // 敵が攻撃できた回数
    minHpRatio: hero.hp / hero.maxHp, // 戦闘中の最低HP割合
    finished: false,
    win: false,
    emotions: [], // 宿った感情キーの配列
  };
}

// 1ティック進める。発生した攻撃イベントの配列を返す（演出用）。
export function stepBattle(b) {
  if (b.finished) return [];
  const T = COMBAT.atbThreshold;
  const CAP = COMBAT.maxActionsPerTick || 12;
  const events = [];

  // 毎ティック、素早さを行動ゲージへ加算（spdが速いほど早く貯まる）
  b.heroGauge += b.hero.spd;
  b.enemyGauge += b.enemy.spd;
  for (const a of b.allies) a.gauge += a.spd;

  // 閾値に達した者を「行動ゲージの高い順」に1体ずつ処理。
  // 貯めが2回分あれば同じティックでも再行動できる＝spdが攻撃回数に効く（勇気=SPDが機能）。CAPで暴走防止。
  let acts = 0;
  while (acts < CAP && !b.finished) {
    let pick = null;
    const consider = (who, gauge, spd, ally) => {
      if (gauge >= T && (!pick || gauge > pick.gauge || (gauge === pick.gauge && spd > pick.spd))) pick = { who, gauge, spd, ally };
    };
    consider("hero", b.heroGauge, b.hero.spd, null);
    consider("enemy", b.enemyGauge, b.enemy.spd, null);
    for (const a of b.allies) consider("ally", a.gauge, a.spd, a);
    if (!pick) break;

    if (pick.who === "hero") {
      b.heroGauge -= T;
      b.heroAttacks += 1;
      const isSkill = b.heroAttacks % b.skillEvery === 0; // 一定回数ごとに技（ツリーで短縮可）
      const crit = rollCrit(b.hero.luk);
      let raw = rollDamage(b.hero.atk * (isSkill ? b.skillMult : 1));
      if (crit) raw = Math.round(raw * CRIT.mult);
      const dmg = capBoss(raw, b.enemy);
      b.enemy.hp -= dmg;
      b.turnsToWin += 1;
      events.push({ by: "hero", target: "enemy", dmg, skill: isSkill, crit });
      if (b.enemy.hp <= 0) {
        b.enemy.hp = 0;
        finish(b, true);
      }
    } else if (pick.who === "enemy") {
      b.enemyGauge -= T;
      const dmg = mitigate(rollDamage(b.enemy.atk), b.hero.def); // DEFで軽減（悲しみ=盾）
      b.hero.hp -= dmg;
      b.damageTaken += dmg;
      b.enemyAttacked += 1;
      const ratio = Math.max(0, b.hero.hp) / b.hero.maxHp;
      if (ratio < b.minHpRatio) b.minHpRatio = ratio;
      events.push({ by: "enemy", target: "hero", dmg });
      if (b.hero.hp <= 0) {
        b.hero.hp = 0;
        finish(b, false);
      }
    } else {
      // 仲間の助太刀（役割別）。仲間は被弾しないので守りの処理は無し。
      const a = pick.ally;
      a.gauge -= T;
      if (a.role === "healer") {
        const before = b.hero.hp;
        b.hero.hp = Math.min(b.hero.maxHp, b.hero.hp + a.heal);
        const healed = b.hero.hp - before;
        if (healed > 0) events.push({ by: "ally", allyId: a.id, target: "hero", heal: healed });
      } else {
        // attacker / striker / clutch はいずれも敵に攻撃。clutch は瀕死で倍打。
        let atk = a.atk;
        if (a.role === "clutch" && b.hero.hp / b.hero.maxHp < COMPANION.clutchHpRatio) {
          atk = a.atk * 2;
        }
        const crit = rollCrit(b.hero.luk); // 主人公の運が仲間の一撃も導く（パーティの運）
        let raw = rollDamage(atk);
        if (crit) raw = Math.round(raw * CRIT.mult);
        const dmg = capBoss(raw, b.enemy);
        b.enemy.hp -= dmg;
        events.push({ by: "ally", allyId: a.id, target: "enemy", dmg, crit });
        if (b.enemy.hp <= 0) {
          b.enemy.hp = 0;
          finish(b, true);
        }
      }
    }
    acts += 1;
  }
  return events;
}

function finish(b, win) {
  b.finished = true;
  b.win = win;
  b.emotions = win ? judgeEmotions(b) : [];
}

// 長期化した戦闘の強制決着（フリーズ防止の安全網）。HPの多い側を勝ちにする。
export function forceFinish(b) {
  if (b.finished) return;
  finish(b, b.hero.hp >= b.enemy.hp);
}

// 「どう勝ったか」→ 宿る感情（複数可）
function judgeEmotions(b) {
  const e = [];
  if (b.turnsToWin <= EMOTION_RULES.angerTurns && b.enemyAttacked > 0) e.push("anger"); // 速攻で押し切った（先制無傷は勇気に譲る＝重複解消）
  if (b.damageTaken >= b.hero.maxHp * EMOTION_RULES.sadnessDamageRatio) e.push("sadness");
  if (b.enemyAttacked === 0) e.push("courage");
  if (b.minHpRatio <= EMOTION_RULES.hopeHpRatio) e.push("hope");
  if (e.length === 0) e.push(nearestEmotion(b)); // 空振り防止（§4-3）
  return e;
}

// どれも該当しない時、最も「近い」条件の感情を1つ与える
function nearestEmotion(b) {
  const scores = {
    anger: EMOTION_RULES.angerTurns / Math.max(1, b.turnsToWin),
    sadness: b.damageTaken / b.hero.maxHp / EMOTION_RULES.sadnessDamageRatio,
    courage: b.enemyAttacked === 0 ? 1 : 1 / (1 + b.enemyAttacked),
    hope: EMOTION_RULES.hopeHpRatio / Math.max(0.01, b.minHpRatio),
  };
  let best = "anger";
  let bestVal = -Infinity;
  for (const k in scores) {
    if (scores[k] > bestVal) {
      bestVal = scores[k];
      best = k;
    }
  }
  return best;
}
