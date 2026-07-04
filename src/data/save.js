// =====================================================================
//  save.js  ── 永続セーブ（localStorage）＋ 転生・装備のロジック
//  設計書§6（転生：記憶＝感情の傾向）/ §9（装備：感情の残響）に準拠。
//  ※ Phase 0 試作は保存なしだったが、転生の積み重ねを意味あるものにするため
//    Phase 1 のこのビルドから永続セーブを導入する。
// =====================================================================

import { HERO_BASE, EMOTIONS, EMOTION_ORDER, SOUL, EQUIPMENT, CRAFT, TREE, EVOLUTION, COMPANION, DIARY, ARTIFACT, ITEMS, SHOP_COMPANIONS, SKILL } from "./config.js";

const KEY = "lacryma_save_v1";
const KEY_BAK = "lacryma_save_v1_bak"; // 1世代前の正常データ（データ消失対策・DR反面教師）
let _save = null;
let _saveFailed = false; // localStorage への書き込みが失敗しているか（保存無効環境の検知）

// このブラウザで localStorage が実際に使えるか（プライベートモード等で無効になる）
export function storageAvailable() {
  try {
    const t = "__lacryma_test__";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return true;
  } catch (e) {
    return false;
  }
}
export function isSaveFailing() {
  return _saveFailed || !storageAvailable();
}

// 手動バックアップ：セーブを文字列コードに（環境に依らず確実に持ち出せる）
export function exportSave() {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(getSave()))));
  } catch (e) {
    return "";
  }
}
export function importSave(code) {
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob((code || "").trim()))));
    if (!obj || typeof obj !== "object") return { ok: false };
    _save = ensure({ ...defaultSave(), ...obj });
    persist();
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

function defaultSave() {
  return {
    seenIntro: false,
    grantedStarters: false,
    nextEquipId: 1,
    soul: {
      memory: { anger: 0, sadness: 0, courage: 0, hope: 0 }, // 累積記憶（傾向）
      level: 1, // 魂レベル（永続強化）
      rebirths: 0, // 転生回数
      bestDistance: 0, // 最高到達距離
    },
    equipment: { owned: [], equipped: [] },
    materials: { anger: 0, sadness: 0, courage: 0, hope: 0 }, // 制作用
    items: {}, // 消耗アイテム {key: 個数}
    noticesRead: [],
    // 導く心のツリー（設計書§8 ④）：転生でリセットされない上層
    enlightenment: 0, // 所持「悟り」
    gold: 0, // お金（永続）：仲間の個体強化に使う
    // 累計獲得（使っても減らない）＝クラウド同期の進行度スコアを単調増加に保つ核心
    lifetime: { enlightenment: 0, gold: 0 },
    tree: { vessel: {}, anger: {}, sadness: {}, courage: {}, hope: {}, empathy: {} }, // {ノードid: レベル}
    // 絆（設計書§17）：仲間は転生で散るが、出会った記録だけは永続に残す
    bonds: { met: 0, byEmotion: { anger: 0, sadness: 0, courage: 0, hope: 0 } },
    // 魂の絆で連れ越した仲間のロスター（A案：限定持ち越し）。active=出撃同行
    //  resonance＝共鳴の蓄積、eggs＝生まれた感情の卵（次の旅で孵る）
    party: { bonded: [], nextId: 1, resonance: 0, eggs: [], paidSlots: 0 },
    shopOwned: [], // 直接購入した特別な仲間のid（再入手防止）
    // UI設定（戦闘画面のおまかせ強化・倍速）。見守るだけでも成立させる柱。
    prefs: { autoInvest: false, speed: 1, muted: false },
    // 旅の日記（DR③）：転生のたびに主感情で1行ずつ残る
    diary: [],
    lastSeen: 0, // 最後にホームを見た時刻（放置生産の経過計算用・Palworld由来）
    endingSeen: false, // 感情統合エンディングを見たか（§17-4：一度だけ）
    spiritName: "", // 統合で生まれた「感情の精霊」にプレイヤーがつけた名
    dex: { forms: {} }, // 感情図鑑：到達した進化形態の名前を記録
    // 感情の結晶＝アーティファクト（DR④／設計§9軸1）：持つだけで恒久%強化が積み上がる
    artifacts: [],
    stamp: 0, // 最終保存時刻（端末間クラウド同期の新旧判定）
  };
}

const TREE_BRANCH_KEYS = ["vessel", "anger", "sadness", "courage", "hope", "empathy"];

// 古い/欠けたセーブでも構造を保証
function ensure(s) {
  const d = defaultSave();
  s.soul = { ...d.soul, ...(s.soul || {}) };
  s.soul.memory = { ...d.soul.memory, ...(s.soul.memory || {}) };
  s.equipment = { ...d.equipment, ...(s.equipment || {}) };
  s.equipment.owned = s.equipment.owned || [];
  s.equipment.equipped = s.equipment.equipped || [];
  s.materials = { ...d.materials, ...(s.materials || {}) };
  // 旧 items（配列・未実装）→ {key:個数} に作り替え
  s.items = s.items && !Array.isArray(s.items) && typeof s.items === "object" ? s.items : {};
  s.noticesRead = s.noticesRead || [];
  if (typeof s.stamp !== "number") s.stamp = 0;
  if (typeof s.enlightenment !== "number") s.enlightenment = 0;
  s.tree = { ...d.tree, ...(s.tree || {}) };
  for (const k of TREE_BRANCH_KEYS) {
    // 旧形式（解放済id配列）→ 新形式（{id: レベル}）へ移行
    if (Array.isArray(s.tree[k])) {
      const obj = {};
      for (const id of s.tree[k]) obj[id] = 1;
      s.tree[k] = obj;
    } else if (!s.tree[k] || typeof s.tree[k] !== "object") {
      s.tree[k] = {};
    }
  }
  s.bonds = { ...d.bonds, ...(s.bonds || {}) };
  s.bonds.byEmotion = { ...d.bonds.byEmotion, ...(s.bonds.byEmotion || {}) };
  s.party = { ...d.party, ...(s.party || {}) };
  s.party.bonded = Array.isArray(s.party.bonded) ? s.party.bonded : [];
  if (typeof s.party.nextId !== "number") s.party.nextId = 1;
  if (typeof s.party.resonance !== "number") s.party.resonance = 0;
  if (typeof s.party.paidSlots !== "number") s.party.paidSlots = 0; // 課金で拡張した器の枠
  s.party.eggs = Array.isArray(s.party.eggs) ? s.party.eggs : [];
  if (typeof s.gold !== "number") s.gold = 0;
  // 累計獲得（クラウド同期の単調増加スコア用）。現残高を下限に「必ず」引き上げる。
  //  defaultSaveが lifetime={0,0} を先に入れるため型ガードでは埋まらない → Math.maxで冪等に下限シード。
  s.lifetime = s.lifetime && typeof s.lifetime === "object" ? s.lifetime : {};
  s.lifetime.enlightenment = Math.max(s.lifetime.enlightenment || 0, s.enlightenment || 0);
  s.lifetime.gold = Math.max(s.lifetime.gold || 0, s.gold || 0);
  // 既存の仲間に 個体強化/愛着/レア度フィールドを補完
  let _activeN = 0;
  for (const b of s.party.bonded) {
    if (typeof b.level !== "number") b.level = 1;
    if (typeof b.runs !== "number") b.runs = 0;
    if (typeof b.originIdx !== "number") b.originIdx = 0;
    if (typeof b.rarity !== "string") b.rarity = b.special ? "epic" : "common"; // 旧セーブの仲間は既定レア
    // 旧バグ掃除：同行(active)は maxParty まで。超過分は留守番に。
    if (b.active) {
      _activeN += 1;
      if (_activeN > COMPANION.maxParty) b.active = false;
    }
  }
  s.shopOwned = Array.isArray(s.shopOwned) ? s.shopOwned : [];
  s.prefs = { ...d.prefs, ...(s.prefs || {}) };
  s.diary = Array.isArray(s.diary) ? s.diary : [];
  if (typeof s.lastSeen !== "number") s.lastSeen = 0;
  s.artifacts = Array.isArray(s.artifacts) ? s.artifacts : [];
  s.dex = s.dex && typeof s.dex === "object" ? s.dex : { forms: {} };
  s.dex.forms = s.dex.forms && typeof s.dex.forms === "object" ? s.dex.forms : {};
  if (typeof s.nextEquipId !== "number") s.nextEquipId = 1;
  return s;
}

// 感情図鑑：到達した進化形態を記録
export function recordForm(name) {
  if (!name) return;
  const s = getSave();
  if (!s.dex.forms[name]) {
    s.dex.forms[name] = true;
    persist();
  }
}
export function formSeen(name) {
  return !!getSave().dex.forms[name];
}

// アーティファクトの恒久ボーナス（%）を集計
export function getArtifactBonuses() {
  const b = { hp: 0, atk: 0, spd: 0, frag: 0, coin: 0, drop: 0 };
  for (const a of getSave().artifacts) {
    if (b[a.stat] !== undefined) b[a.stat] += a.pct;
  }
  return b;
}

// 感情オブジェクトの主感情（なければ null）
function dominantOf(emotions) {
  let best = null;
  let val = 0;
  for (const k of EMOTION_ORDER) {
    if ((emotions[k] || 0) > val) {
      val = emotions[k];
      best = k;
    }
  }
  return best;
}

function loadFrom(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return ensure({ ...defaultSave(), ...JSON.parse(raw) });
}

export function getSave() {
  if (_save) return _save;
  // 本体→破損/欠損ならバックアップ→それも無ければ新規（データ消失で0に戻さない）
  try {
    _save = loadFrom(KEY);
  } catch (e) {
    _save = null;
  }
  if (!_save) {
    try {
      _save = loadFrom(KEY_BAK);
    } catch (e) {
      _save = null;
    }
  }
  if (!_save) _save = defaultSave();
  // 直近の正常状態をバックアップへ退避（次回 本体が壊れても1世代前に戻せる）
  try {
    localStorage.setItem(KEY_BAK, JSON.stringify(_save));
  } catch (e) {
    /* ignore */
  }
  // 初回のみ、お試し装備を2つ付与（装備変更を体験できるように）
  if (!_save.grantedStarters) {
    _save.equipment.owned.push(makeEquipment("anger", "common", 0));
    _save.equipment.owned.push(makeEquipment("sadness", "common", 0));
    _save.grantedStarters = true;
    persist();
  }
  return _save;
}

let _persistHook = null; // クラウド同期などの後追い処理（保存のたびに呼ぶ）
export function setPersistHook(fn) {
  _persistHook = fn;
}

// クラウドから取り込んだセーブでローカルを置き換える（同期の下り）。
//  クラウド再送を避けるため localStorage へ直接書く（persistHook は呼ばない）。
export function adoptCloudSave(obj) {
  if (!obj || typeof obj !== "object") return false;
  // 上書き前に、今のローカルを復旧スロットへ退避（万一の誤同期でも取り戻せる）
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) localStorage.setItem(KEY + "_preadopt", cur);
  } catch (e) {
    /* ignore */
  }
  _save = ensure({ ...defaultSave(), ...obj });
  try {
    localStorage.setItem(KEY, JSON.stringify(_save));
  } catch (e) {
    /* ignore */
  }
  return true;
}

export function persist() {
  if (!_save) return;
  _save.stamp = Date.now(); // 端末間の新旧判定に使う保存時刻
  try {
    localStorage.setItem(KEY, JSON.stringify(_save));
    _saveFailed = false;
  } catch (e) {
    _saveFailed = true; // localStorage 不可環境（プライベートモード等）。バックアップコードで退避を促す。
  }
  if (_persistHook) {
    try {
      _persistHook(_save);
    } catch (e) {
      /* クラウド同期の失敗はゲーム進行を止めない */
    }
  }
}

export function resetSave() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_BAK); // バックアップも消さないと復旧で戻ってしまう
  } catch (e) {
    /* ignore */
  }
  _save = null;
  return getSave();
}

// ---- 装備生成（感情の残響）----
function rollRarity() {
  const total = EQUIPMENT.rarities.reduce((a, r) => a + r.weight, 0);
  let x = Math.random() * total;
  for (const r of EQUIPMENT.rarities) {
    x -= r.weight;
    if (x <= 0) return r;
  }
  return EQUIPMENT.rarities[0];
}

export function makeEquipment(emotionKey, rarityKey, distance) {
  const s = getSave();
  const rarity = EQUIPMENT.rarities.find((r) => r.key === rarityKey) || EQUIPMENT.rarities[0];
  const emo = EMOTIONS[emotionKey];
  const focus = EQUIPMENT.focus[emotionKey];
  const distMult = 1 + distance / 200;
  const b = EQUIPMENT.baseStat;
  const stat = (name, base) =>
    Math.round(base * rarity.mult * distMult * (focus === name ? 1.7 : 0.55));
  return {
    id: s.nextEquipId++,
    emotion: emotionKey,
    rarity: rarityKey,
    name: `${emo.label}の残響`,
    hp: stat("hp", b.hp),
    atk: stat("atk", b.atk),
    spd: Math.round(b.spd * rarity.mult * distMult * (focus === "spd" ? 2 : 0.4)), // hp/atk同様 距離スケールを反映
    def: stat("def", b.def), // 悲しみ装備が得意（盾）
    luk: stat("luk", b.luk), // 希望装備が得意（会心）
  };
}

// 戦闘勝利時のドロップ判定。装備を返す（なければ null）。owned に追加して保存。
export function rollEquipmentDrop(distance) {
  const chance = EQUIPMENT.dropChance + getTreeEffects().dropPct + getArtifactBonuses().drop / 100;
  if (Math.random() > chance) return null;
  const emotion = EMOTION_ORDER[Math.floor(Math.random() * EMOTION_ORDER.length)];
  const r = rollRarity();
  const item = makeEquipment(emotion, r.key, distance);
  getSave().equipment.owned.push(item);
  persist();
  return item;
}

// ボス撃破のレア報酬：レア以上の装備＋感情の結晶を確定で授ける
function rollRarityFrom(pool) {
  const total = pool.reduce((a, r) => a + r.weight, 0);
  let x = Math.random() * total;
  for (const r of pool) {
    x -= r.weight;
    if (x <= 0) return r;
  }
  return pool[0];
}

export function bossReward(distance, emotion) {
  const s = getSave();
  const pool = EQUIPMENT.rarities.filter((r) => r.key !== "common"); // 並は出さない
  const rar = rollRarityFrom(pool);
  const equip = makeEquipment(emotion, rar.key, distance);
  s.equipment.owned.push(equip);
  // 感情の結晶を1個 確定
  const stat = ARTIFACT.stats[Math.floor(Math.random() * ARTIFACT.stats.length)];
  const pct = stat.base + Math.floor(Math.random() * (stat.base + 1));
  const art = { emotion, stat: stat.key, pct };
  s.artifacts.push(art);
  persist();
  return { equip, rar, stat, pct };
}

// 制作：素材を消費して装備を作る。威力は最高到達距離を基準にスケール。
export function craftEquipment(emotionKey, rarityKey) {
  const s = getSave();
  const cost = CRAFT.costs[rarityKey];
  if (!cost || (s.materials[emotionKey] || 0) < cost) return { ok: false };
  s.materials[emotionKey] -= cost;
  const item = makeEquipment(emotionKey, rarityKey, s.soul.bestDistance);
  s.equipment.owned.push(item);
  persist();
  return { ok: true, item };
}

// 消耗アイテムを素材から作る
export function craftItem(key) {
  const s = getSave();
  const def = ITEMS[key];
  if (!def) return { ok: false };
  for (const [emo, n] of Object.entries(def.cost)) {
    if ((s.materials[emo] || 0) < n) return { ok: false, reason: "素材不足" };
  }
  for (const [emo, n] of Object.entries(def.cost)) s.materials[emo] -= n;
  s.items[key] = (s.items[key] || 0) + 1;
  persist();
  return { ok: true };
}

export function itemCount(key) {
  return getSave().items[key] || 0;
}

// 消耗アイテムを n 個使う（在庫から減らす）
export function useItem(key, n = 1) {
  const s = getSave();
  s.items[key] = Math.max(0, (s.items[key] || 0) - n);
  persist();
}

export function toggleEquip(itemId) {
  const eq = getSave().equipment.equipped;
  const i = eq.indexOf(itemId);
  if (i >= 0) {
    eq.splice(i, 1);
  } else {
    eq.push(itemId);
    while (eq.length > effectiveEquipSlots()) eq.shift(); // 枠超過は古いものを外す
  }
  persist();
}

export function isEquipped(itemId) {
  return getSave().equipment.equipped.includes(itemId);
}

export function addMaterials(emotions) {
  const m = getSave().materials;
  for (const k of emotions) if (m[k] !== undefined) m[k] += 1;
  persist();
}

// いちばん多く抱いた記憶の感情（なければ null）
export function dominantMemory() {
  const mem = getSave().soul.memory;
  let best = null;
  let val = 0;
  for (const k of EMOTION_ORDER) {
    if (mem[k] > val) {
      val = mem[k];
      best = k;
    }
  }
  return best;
}

// ---- 導く心のツリー（設計書§8 ④：ノードは繰り返しレベルアップできる）----
// ノードの現在Lv／上限／次コスト
export function nodeLevel(branchKey, nodeId) {
  const b = getSave().tree[branchKey] || {};
  return b[nodeId] || 0;
}
export function nodeMax(node) {
  return node.max != null ? node.max : TREE.maxNodeLevel;
}
export function nodeCost(node, level) {
  return Math.round(node.cost * Math.pow(TREE.costGrowth, level));
}

// 「共感」枝の出現条件：4感情の各枝を1つ以上 規定数だけ取得したか
export function empathyUnlocked() {
  const t = getSave().tree;
  return EMOTION_ORDER.every((k) => Object.values(t[k] || {}).filter((v) => v > 0).length >= TREE.empathyRequirePerEmotion);
}

// ノード効果の集約（効果はレベルに比例）
export function getTreeEffects() {
  const t = getSave().tree;
  const eff = {
    heroHpPct: 0,
    heroAtkPct: 0,
    heroSpdFlat: 0,
    equipSlots: 0,
    dropPct: 0,
    soulLevelPct: 0,
    evoThresholdDelta: 0,
    carryover: 0,
    skillMult: 0,
    skillCharge: 0,
    fragAll: 0,
    fragPct: { anger: 0, sadness: 0, courage: 0, hope: 0 },
  };
  for (const br of TREE.branches) {
    const levels = t[br.key] || {};
    for (const node of br.nodes) {
      const lv = levels[node.id] || 0;
      if (lv <= 0) continue;
      const e = node.effect;
      const v = e.value * lv;
      switch (e.type) {
        case "heroHpPct": eff.heroHpPct += v; break;
        case "heroAtkPct": eff.heroAtkPct += v; break;
        case "heroSpdFlat": eff.heroSpdFlat += v; break;
        case "equipSlot": eff.equipSlots += v; break;
        case "dropPct": eff.dropPct += v; break;
        case "soulLevelPct": eff.soulLevelPct += v; break;
        case "evoThreshold": eff.evoThresholdDelta += v; break;
        case "carryover": eff.carryover += v; break;
        case "skillMult": eff.skillMult += v; break;
        case "skillCharge": eff.skillCharge += v; break;
        case "fragAll": eff.fragAll += v; break;
        case "fragEmotion": eff.fragPct[e.emotion] += v; break;
      }
    }
  }
  return eff;
}

// 感情ごとの欠片獲得倍率（共鳴とは別。ツリーの fragAll＋fragEmotion 由来）
export function fragMultipliers() {
  const eff = getTreeEffects();
  const art = getArtifactBonuses();
  const m = {};
  for (const k of EMOTION_ORDER) m[k] = eff.fragAll + eff.fragPct[k] + art.frag / 100;
  return m;
}

// 実効の装備スロット数（基本＋ツリー）
export function effectiveEquipSlots() {
  return EQUIPMENT.slots + getTreeEffects().equipSlots;
}

// 技パラメータ（ツリーで威力UP・発動短縮。進化は atk 経由で効く）
export function skillParams() {
  const eff = getTreeEffects();
  return {
    every: Math.max(2, SKILL.heroEvery - eff.skillCharge),
    mult: SKILL.heroMult + eff.skillMult,
  };
}

// 実効の進化閾値（ツリーで下げられる。floor 未満にはしない）
export function effectiveEvoThreshold() {
  return Math.max(TREE.evoThresholdFloor, EVOLUTION.threshold + getTreeEffects().evoThresholdDelta);
}

// ノードを「悟り」で1段レベルアップ（同枝の前ノードを1Lv以上が前提）。
export function unlockNode(branchKey, nodeId) {
  const s = getSave();
  const br = TREE.branches.find((b) => b.key === branchKey);
  if (!br) return { ok: false, reason: "枝が無い" };
  if (br.hidden && !empathyUnlocked()) return { ok: false, reason: "まだ芽吹いていない" };
  const idx = br.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) return { ok: false, reason: "ノードが無い" };
  const node = br.nodes[idx];
  const levels = s.tree[branchKey] || (s.tree[branchKey] = {});
  const cur = levels[nodeId] || 0;
  if (cur >= nodeMax(node)) return { ok: false, reason: "最大Lv" };
  if (idx > 0 && (levels[br.nodes[idx - 1].id] || 0) < 1) return { ok: false, reason: "前提が必要" };
  const cost = nodeCost(node, cur);
  if (s.enlightenment < cost) return { ok: false, reason: "悟り不足" };
  s.enlightenment -= cost;
  levels[nodeId] = cur + 1;
  persist();
  return { ok: true, node, level: cur + 1 };
}

// 出撃時の主人公ステータス（魂レベル＋装備＋ツリーを反映）
export function computeHeroStats() {
  const s = getSave();
  const eff = getTreeEffects();
  const art = getArtifactBonuses();
  const lvlMult = 1 + (SOUL.levelStatPerLevel + eff.soulLevelPct) * (s.soul.level - 1);
  let hp = HERO_BASE.hp * lvlMult * (1 + eff.heroHpPct);
  let atk = HERO_BASE.atk * lvlMult * (1 + eff.heroAtkPct);
  let spd = HERO_BASE.spd + eff.heroSpdFlat;
  let def = HERO_BASE.def || 0;
  let luk = HERO_BASE.luk || 0;
  for (const id of s.equipment.equipped) {
    const it = s.equipment.owned.find((o) => o.id === id);
    if (it) {
      hp += it.hp;
      atk += it.atk;
      spd += it.spd;
      def += it.def || 0;
      luk += it.luk || 0;
    }
  }
  // 感情の結晶（恒久%）を最後に重ねる
  hp *= 1 + art.hp / 100;
  atk *= 1 + art.atk / 100;
  spd *= 1 + art.spd / 100;
  hp = Math.round(hp);
  atk = Math.round(atk);
  spd = Math.round(spd);
  return { hp, maxHp: hp, atk, spd, def: Math.round(def), luk: Math.round(luk), resonanceKey: dominantMemory() };
}

// 転生処理：今生の生き方を魂に刻む（設計書§6）＋ 導く心が「悟り」を得る（§8）
export function transmigrate(run) {
  const s = getSave();
  for (const k of EMOTION_ORDER) s.soul.memory[k] += run.emotions[k] || 0;
  const levelGain = run.distance >= SOUL.minRewardDistance ? Math.max(1, Math.floor(run.distance / SOUL.levelPerDeathDistance)) : 0;
  s.soul.level += levelGain;
  s.soul.rebirths += 1;
  const dist = Math.floor(run.distance);
  const newBest = dist > s.soul.bestDistance;
  if (newBest) s.soul.bestDistance = dist;

  // 「悟り」獲得：到達距離 ＋ 進化達成 ＋ 最高更新（プレイヤーは旅から学ぶ）
  const satoriGain =
    Math.floor(dist * TREE.satori.perMeter) +
    (run.evolved ? TREE.satori.evolveBonus : 0) +
    (newBest ? TREE.satori.bestBonus : 0);
  s.enlightenment += satoriGain;
  s.lifetime.enlightenment += satoriGain; // 累計（使っても減らない進行度）

  // お金（永続）：旅の到達と撃破から。仲間の個体強化に使う。
  const goldGain = Math.floor(dist / 4) + (run.kills || 0) * 2;
  s.gold += goldGain;
  s.lifetime.gold += goldGain; // 累計（使っても減らない進行度）

  // 旅の日記（DR③）：主感情で1行残す
  const domRun = dominantOf(run.emotions) || "none";
  const lines = DIARY.lines[domRun] || DIARY.lines.none;
  const text = `${dist}m の旅。 ` + lines[Math.floor(Math.random() * lines.length)];
  s.diary.unshift({ n: s.soul.rebirths, distance: dist, emotion: domRun === "none" ? null : domRun, text });
  if (s.diary.length > DIARY.max) s.diary.length = DIARY.max;

  // 感情の結晶（DR④）：旅の成果として恒久%強化をランダム獲得。図鑑に積む。
  let artN = 0;
  if (dist >= 40) artN += 1;
  if (newBest) artN += 1;
  if (dist >= SOUL.minRewardDistance && Math.random() < 0.25) artN += 1;
  const earnedArtifacts = [];
  for (let i = 0; i < artN; i++) {
    const emotion = EMOTION_ORDER[Math.floor(Math.random() * EMOTION_ORDER.length)];
    const stat = ARTIFACT.stats[Math.floor(Math.random() * ARTIFACT.stats.length)];
    const pct = stat.base + Math.floor(Math.random() * (stat.base + 1));
    const art = { emotion, stat: stat.key, pct };
    s.artifacts.push(art);
    earnedArtifacts.push(art);
  }

  persist();
  return {
    levelGain,
    newLevel: s.soul.level,
    distance: dist,
    newBest,
    rebirths: s.soul.rebirths,
    resonanceKey: dominantMemory(),
    satoriGain,
    goldGain,
    enlightenment: s.enlightenment,
    artifacts: earnedArtifacts,
  };
}

// 仲間の個体強化（お金で永続レベルアップ）
export function companionUpgradeCost(rec) {
  return Math.round(COMPANION.upgrade.baseCost * Math.pow(COMPANION.upgrade.growth, (rec.level || 1) - 1));
}

export function upgradeCompanion(bondedId) {
  const s = getSave();
  const rec = s.party.bonded.find((b) => b.id === bondedId);
  if (!rec) return { ok: false };
  const cost = companionUpgradeCost(rec);
  if (s.gold < cost) return { ok: false, reason: "お金不足" };
  s.gold -= cost;
  rec.level = (rec.level || 1) + 1;
  rec.atk = Math.max(1, Math.round(rec.atk * COMPANION.upgrade.statMult));
  rec.heal = Math.max(1, Math.round(rec.heal * COMPANION.upgrade.statMult));
  persist();
  return { ok: true, level: rec.level };
}

export function markIntroSeen() {
  getSave().seenIntro = true;
  persist();
}

export function markEndingSeen() {
  getSave().endingSeen = true;
  persist();
}

export function setSpiritName(name) {
  getSave().spiritName = name;
  persist();
}

// UI設定（おまかせ強化・倍速など）の取得/保存
export function getPref(key) {
  return getSave().prefs[key];
}
export function setPref(key, value) {
  getSave().prefs[key] = value;
  persist();
}

export function markNoticesRead(ids) {
  const s = getSave();
  for (const id of ids) if (!s.noticesRead.includes(id)) s.noticesRead.push(id);
  persist();
}

// 留守番仲間の放置生産（Palworld由来）：ホームに戻るたび、同行してない仲間が
//  経過時間ぶん 自分の感情の素材を集めておいてくれる。上限キャップで農場化を防ぐ。
// 街レベル（転生で育つ）
export function townLevel() {
  return 1 + Math.floor(getSave().soul.rebirths / COMPANION.idle.townRebirthsPerLevel);
}

export function collectIdleProduction() {
  const s = getSave();
  const now = Date.now();
  const last = s.lastSeen || now; // 初回(0)は now 扱い＝いきなり大量付与しない
  let hours = (now - last) / 3600000;
  hours = Math.max(0, Math.min(hours, COMPANION.idle.capHours));
  s.lastSeen = now;
  const townMult = 1 + COMPANION.idle.townBonusPerLevel * (townLevel() - 1);
  const stayHome = s.party.bonded.filter((b) => !b.active);
  const produced = {};
  for (const b of stayHome) {
    const amt = Math.floor(hours * COMPANION.idle.perHour * (b.evo ? COMPANION.idle.evoMult : 1) * townMult);
    if (amt > 0) {
      s.materials[b.emotion] = (s.materials[b.emotion] || 0) + amt;
      produced[b.emotion] = (produced[b.emotion] || 0) + amt;
    }
  }
  persist();
  return { produced, workers: stayHome.length, hours };
}

// 仲間と出会った記録を永続化（設計書§17：散っても出会いは残る）
export function recordBond(emotion) {
  const s = getSave();
  s.bonds.met += 1;
  if (s.bonds.byEmotion[emotion] !== undefined) s.bonds.byEmotion[emotion] += 1;
  persist();
  return s.bonds.met;
}

// ---- 仲間のロスター（魂の器）----
// 手元に置ける仲間の数：無料10＋課金枠＋導く心ツリー、上限20。
export function carryoverSlots() {
  const s = getSave();
  const paid = s.party.paidSlots || 0;
  return Math.min(COMPANION.maxSlots, COMPANION.freeSlots + paid + getTreeEffects().carryover);
}

// いま拡張済みの上限と、あと何枠買えるか
export function rosterSlotInfo() {
  const s = getSave();
  const paid = s.party.paidSlots || 0;
  const tree = getTreeEffects().carryover;
  const cap = Math.min(COMPANION.maxSlots, COMPANION.freeSlots + paid + tree);
  const canBuyMore = COMPANION.freeSlots + paid + tree < COMPANION.maxSlots;
  return { cap, used: s.party.bonded.length, free: COMPANION.freeSlots, paid, tree, max: COMPANION.maxSlots, canBuyMore, cost: COMPANION.paidSlotCost };
}

// 課金で器を1枠拡張（試作：のちに実IAPへ接続。いまは所持ゴールドで代用）
export function buyRosterSlot() {
  const s = getSave();
  const info = rosterSlotInfo();
  if (!info.canBuyMore) return { ok: false, reason: "上限に達しています" };
  if (s.gold < info.cost) return { ok: false, reason: "ゴールドが足りない" };
  s.gold -= info.cost;
  s.party.paidSlots = (s.party.paidSlots || 0) + 1;
  persist();
  return { ok: true, cap: carryoverSlots() };
}

// 出撃に同行する仲間（active な持ち越し仲間）。maxParty で上限（全員同行バグ防止）。
export function getActiveCompanions() {
  return getSave().party.bonded.filter((b) => b.active).slice(0, COMPANION.maxParty);
}

// 〔同行/留守番〕の切り替え。同行は maxParty まで。
export function toggleCompanionActive(bondedId) {
  const s = getSave();
  const rec = s.party.bonded.find((b) => b.id === bondedId);
  if (!rec) return { ok: false };
  if (!rec.active) {
    const activeCount = s.party.bonded.filter((b) => b.active).length;
    if (activeCount >= COMPANION.maxParty) return { ok: false, reason: "同行枠が満員" };
  }
  rec.active = !rec.active;
  persist();
  return { ok: true, active: rec.active };
}

// 仲間を見送る（解放）。魂の絆の枠が空く。
export function releaseCompanion(bondedId) {
  const s = getSave();
  const i = s.party.bonded.findIndex((b) => b.id === bondedId);
  if (i < 0) return { ok: false };
  const [removed] = s.party.bonded.splice(i, 1);
  persist();
  return { ok: true, removed };
}

// ---- 特別な仲間（直接購入：ガチャでなく確定で迎える）----
export function isShopOwned(id) {
  return getSave().shopOwned.includes(id);
}

export function buyShopCompanion(id) {
  const s = getSave();
  if (s.shopOwned.includes(id)) return { ok: false, reason: "入手済" };
  const def = SHOP_COMPANIONS.find((x) => x.id === id);
  if (!def) return { ok: false };
  const roleInfo = COMPANION.roles[def.emotion];
  s.party.bonded.push({
    id: s.party.nextId++,
    emotion: def.emotion,
    shopId: def.id, // 専用アート shop_{id} 用（特別な仲間）
    role: def.role,
    icon: def.icon,
    roleLabel: roleInfo ? roleInfo.label : "",
    name: def.name,
    rarity: def.rarity || "epic", // 特別な仲間は確定で高レア
    atk: def.atk,
    heal: def.heal,
    spd: def.spd,
    stage: 2,
    evo: 0,
    level: 1,
    runs: 0,
    originIdx: 0,
    active: false,
    special: true,
  });
  s.shopOwned.push(id);
  persist();
  return { ok: true, def };
}

// 共鳴で生まれた子（少し強い）
function makeChild(emotion) {
  const s = getSave();
  const r = COMPANION.roles[emotion];
  const f = COMPANION.statScale * COMPANION.resonance.childStatMult;
  const names = COMPANION.names[emotion];
  return {
    id: s.party.nextId++,
    emotion,
    role: r.role,
    icon: r.icon,
    roleLabel: r.label,
    name: names[Math.floor(Math.random() * names.length)],
    rarity: "rare", // 共鳴で生まれた子は希少
    atk: Math.max(1, Math.round(COMPANION.base.atk * f)),
    heal: Math.max(1, Math.round(COMPANION.base.heal * f)),
    spd: COMPANION.base.spd + 1,
    stage: 1,
    evo: 0,
    level: 1,
    runs: 0,
    originIdx: Math.floor(Math.random() * (COMPANION.origins[emotion] || [""]).length),
    active: false,
    child: true,
  };
}

// 旅の終わりに仲間の去就を確定する（設計書§17：絆 or 別れ）。
//  - 持ち越してきた仲間（bondedId あり）：声の段階を書き戻して残留
//  - 旅で新たに出会った仲間：魂の絆の空き枠の分だけ繋がり、残りは光に還る
//  - 共鳴孵化：2体以上同行で絆が積もり、卵→次の旅で孵る（runDistance を加算）
export function commitRunCompanions(runComps, runDistance = 0) {
  const s = getSave();
  const cap = carryoverSlots();
  const newlyBonded = [];
  const dispersed = [];
  let hatched = null;
  let newEgg = null;

  // 1) 連れてきた仲間：成長（声段階・進化）を書き戻す
  for (const rc of runComps) {
    if (rc.bondedId != null) {
      const rec = s.party.bonded.find((b) => b.id === rc.bondedId);
      if (rec) {
        if (rc.stage > rec.stage) rec.stage = rc.stage;
        if (rc.evo && !rec.evo) {
          rec.evo = 1;
          rec.atk = rc.atk;
          rec.heal = rc.heal;
          rec.spd = rc.spd;
          rec.icon = rc.icon;
        }
      }
    }
  }
  // 2) 新しく出会った仲間：空き枠の分だけ絆を結ぶ
  let activeCount = s.party.bonded.filter((b) => b.active).length; // 同行は maxParty まで（全員同行バグ防止）
  for (const rc of runComps) {
    if (rc.bondedId == null) {
      if (s.party.bonded.length < cap) {
        const willActive = activeCount < COMPANION.maxParty;
        if (willActive) activeCount += 1;
        const rec = {
          id: s.party.nextId++,
          emotion: rc.emotion,
          role: rc.role,
          icon: rc.icon,
          roleLabel: rc.roleLabel,
          name: rc.name,
          rarity: rc.rarity || "common",
          atk: rc.atk,
          heal: rc.heal,
          spd: rc.spd,
          stage: rc.stage,
          evo: rc.evo || 0,
          level: rc.level || 1,
          runs: rc.runs || 0,
          originIdx: rc.originIdx || 0,
          active: willActive,
        };
        s.party.bonded.push(rec);
        newlyBonded.push(rec);
      } else {
        dispersed.push({ name: rc.name, icon: rc.icon });
      }
    }
  }
  // ともに歩んだ旅の数（愛着の指標）
  for (const b of s.party.bonded) if (b.active) b.runs = (b.runs || 0) + 1;

  // 共鳴孵化（2体以上を同行させた時だけ進む）
  const active = s.party.bonded.filter((b) => b.active);
  if (active.length >= 2) {
    // 1) 準備できた卵を孵す（魂の絆に空きがあれば）
    if (s.party.eggs.length > 0 && s.party.bonded.length < cap) {
      const egg = s.party.eggs.shift();
      hatched = makeChild(egg.emotion);
      s.party.bonded.push(hatched);
    }
    // 2) 共鳴の蓄積 → 卵
    s.party.resonance += Math.floor(runDistance);
    if (s.party.resonance >= COMPANION.resonance.threshold) {
      s.party.resonance -= COMPANION.resonance.threshold;
      const emos = active.map((b) => b.emotion);
      newEgg = { emotion: emos[Math.floor(Math.random() * emos.length)] };
      s.party.eggs.push(newEgg);
    }
  }

  persist();
  return { newlyBonded, dispersed, hatched, newEgg };
}
