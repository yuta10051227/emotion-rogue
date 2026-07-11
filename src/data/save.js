// =====================================================================
//  save.js  ── 永続セーブ（localStorage）＋ 転生・装備のロジック
//  設計書§6（転生：記憶＝感情の傾向）/ §9（装備：感情の残響）に準拠。
//  ※ Phase 0 試作は保存なしだったが、転生の積み重ねを意味あるものにするため
//    Phase 1 のこのビルドから永続セーブを導入する。
// =====================================================================

import { HERO_BASE, EMOTIONS, EMOTION_ORDER, SOUL, EQUIPMENT, CRAFT, TREE, EVOLUTION, EVOLUTION_STAGES, MIXED_EVOLUTION, TRIPLE_EVOLUTION, COMPANION, DIARY, ARTIFACT, ITEMS, SHOP_COMPANIONS, SKILL, MASTERY, ACHIEVEMENTS, COLLECTION, DAILY } from "./config.js";

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
    player: { chosen: false, gender: "boy", name: "" }, // 主人公（男の子/女の子）＋なまえ
    battleCoached: false, // 初回バトルのコーチマークを見たか
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
    lifetime: { enlightenment: 0, gold: 0, kills: 0, bossKills: 0 },
    // 感情の熟練度（ログウィズ③）：生涯で集めた欠片の累計。感情ごとの「理解」が深まる
    lifetimeFrags: { anger: 0, sadness: 0, courage: 0, hope: 0 },
    // あかし（ログウィズ④・実績）：受け取り済みのid
    achievementsClaimed: [],
    abyssBest: 0, // 深淵モードでの最高到達距離
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
    endings: {}, // 見たエンディングの種類（balance/anger/sadness/courage/hope/dark）＝図鑑・再訪動機
    spiritName: "", // 統合で生まれた「感情の精霊」にプレイヤーがつけた名
    dex: { forms: {}, shiny: {}, rewards: [], shinyRewards: [] }, // 感情図鑑：記録した形態/きらめき/受取済み報酬
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
  if (typeof s.lifetime.kills !== "number") s.lifetime.kills = 0;
  if (typeof s.lifetime.bossKills !== "number") s.lifetime.bossKills = 0;
  s.lifetimeFrags = { ...d.lifetimeFrags, ...(s.lifetimeFrags || {}) };
  s.achievementsClaimed = Array.isArray(s.achievementsClaimed) ? s.achievementsClaimed : [];
  if (typeof s.abyssBest !== "number") s.abyssBest = 0;
  s.trueChapter = !!s.trueChapter; // 真章（空白の王撃破）
  if (s.starterEgg && !EMOTION_ORDER.includes(s.starterEgg)) s.starterEgg = null; // 始まりの卵
  // 既存の仲間に 個体強化/愛着/レア度フィールドを補完
  let _activeN = 0;
  for (const b of s.party.bonded) {
    if (typeof b.level !== "number") b.level = 1;
    if (typeof b.runs !== "number") b.runs = 0;
    if (typeof b.originIdx !== "number") b.originIdx = 0;
    if (typeof b.rarity !== "string") b.rarity = b.special ? "epic" : "common"; // 旧セーブの仲間は既定レア
    if (typeof b.stage !== "number") b.stage = b.special ? 2 : 1; // 声の段階（無いと表示が壊れ、成長の書き戻しも失敗する）
    if (typeof b.evo !== "number") b.evo = b.evo ? 1 : 0; // 進化フラグ（無いと再進化でステータスが二重に乗る）
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
  s.dex.shiny = s.dex.shiny && typeof s.dex.shiny === "object" ? s.dex.shiny : {}; // きらめき記録（emotion→true）
  s.dex.rewards = Array.isArray(s.dex.rewards) ? s.dex.rewards : []; // 受取済み図鑑コンプ報酬(need値)
  s.dex.shinyRewards = Array.isArray(s.dex.shinyRewards) ? s.dex.shinyRewards : [];
  s.endings = s.endings && typeof s.endings === "object" ? s.endings : {};
  s.player = { ...d.player, ...(s.player || {}) };
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

// ---- 収集要素（A きらめき / B 図鑑コンプ / C 図鑑ボーナス）----
function grantReward(r) {
  const s = getSave();
  if (r && r.satori) { s.enlightenment += r.satori; s.lifetime.enlightenment += r.satori; }
  if (r && r.gold) { s.gold += r.gold; s.lifetime.gold += r.gold; }
}
// きらめき個体を図鑑に記録（感情ごと）。新規記録なら true。
export function recordShiny(emotion) {
  const s = getSave();
  if (emotion && !s.dex.shiny[emotion]) { s.dex.shiny[emotion] = true; persist(); return true; }
  return false;
}
export function shinySeen(emotion) { return !!getSave().dex.shiny[emotion]; }
export function shinyCount() { const sh = getSave().dex.shiny || {}; return Object.keys(sh).filter((k) => sh[k]).length; }

// 図鑑で記録しうる全形態の名前（記録可能な総数の母数）
export function allDexForms() {
  const out = [];
  for (const k of EMOTION_ORDER) (EVOLUTION_STAGES.forms[k] || []).forEach((f) => out.push(f.name));
  Object.values(MIXED_EVOLUTION.forms).forEach((f) => out.push(f.name));
  Object.values(TRIPLE_EVOLUTION.forms).forEach((f) => out.push(f.name));
  out.push("感情の精霊"); // 頂点
  return out;
}
export function dexProgress() {
  const all = allDexForms();
  const forms = getSave().dex.forms;
  const seen = all.filter((n) => forms[n]).length;
  return { seen, total: all.length, pct: Math.round((seen / Math.max(1, all.length)) * 100) };
}
export function dexFormsCount() { return dexProgress().seen; }
// 図鑑ボーナス(C)：記録数に応じた恒久%（HP・攻撃）
export function dexBonusPct() { return dexFormsCount() * COLLECTION.dexBonusPerForm; }

// 図鑑コンプ報酬(B)・きらめき報酬(A)の一覧と受け取り
export function dexRewardList() {
  const seen = dexFormsCount();
  const done = getSave().dex.rewards;
  return COLLECTION.dexRewards.map((r) => ({ ...r, done: seen >= r.need, claimed: done.includes(r.need) }));
}
export function claimDexReward(need) {
  const s = getSave();
  const r = COLLECTION.dexRewards.find((x) => x.need === need);
  if (!r || s.dex.rewards.includes(need) || dexFormsCount() < need) return { ok: false };
  s.dex.rewards.push(need);
  grantReward(r.reward);
  persist();
  return { ok: true, reward: r.reward, label: r.label };
}
export function shinyRewardList() {
  const cnt = shinyCount();
  const done = getSave().dex.shinyRewards;
  return COLLECTION.shinyRewards.map((r) => ({ ...r, done: cnt >= r.need, claimed: done.includes(r.need) }));
}
export function claimShinyReward(need) {
  const s = getSave();
  const r = COLLECTION.shinyRewards.find((x) => x.need === need);
  if (!r || s.dex.shinyRewards.includes(need) || shinyCount() < need) return { ok: false };
  s.dex.shinyRewards.push(need);
  grantReward(r.reward);
  persist();
  return { ok: true, reward: r.reward, label: r.label };
}
export function unclaimedCollectionCount() {
  return dexRewardList().filter((r) => r.done && !r.claimed).length + shinyRewardList().filter((r) => r.done && !r.claimed).length;
}

// ---- 真章「本来の物語」（空白の王撃破で解放）＋始まりの卵 ----
export function trueChapterUnlocked() {
  return !!getSave().trueChapter;
}
export function markTrueChapter() {
  const s = getSave();
  if (!s.trueChapter) {
    s.trueChapter = true;
    persist();
    return true;
  }
  return false;
}
// 始まりの卵：次の旅の主人公の系統（null=スライム / anger|sadness|courage|hope=その系統の幼体スタート）
export function getStarterEgg() {
  return getSave().starterEgg || null;
}
export function setStarterEgg(emotion) {
  const s = getSave();
  s.starterEgg = emotion && EMOTION_ORDER.includes(emotion) ? emotion : null;
  persist();
}

// ---- 進化分岐のアンロック（A+B）----
//  A: 混合(X+Y)は 両系統の第1形態を図鑑に記録すると解放。三重は構成3系統すべて。
//  B: 解放後も未記録の姿はカード上でシルエット表示（選ぶと判明）→ UI側が formSeen で判定。
function stage1Seen(emotionKey) {
  const f = (EVOLUTION_STAGES.forms[emotionKey] || [])[0];
  return !!(f && getSave().dex.forms[f.name]);
}
export function mixUnlocked(pairKey) {
  const [a, b] = String(pairKey).split("+");
  return stage1Seen(a) && stage1Seen(b);
}
export function tripleUnlocked(missingKey) {
  return EMOTION_ORDER.filter((k) => k !== missingKey).every((k) => stage1Seen(k));
}

// ---- デイリーの灯（日替わり目標：今日やる理由）----
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; // 端末ローカル日付で日替わり
}
// その日の3件を用意（日付が変わっていたら引き直し）
export function ensureDaily() {
  const s = getSave();
  const today = todayStr();
  if (s.daily && s.daily.date === today && Array.isArray(s.daily.goals) && s.daily.goals.length) return s.daily;
  const pool = DAILY.pool.slice();
  // 型が重ならないように選ぶ（runs/frags/kills/boss/dist から3種）
  const goals = [];
  while (goals.length < DAILY.count && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    const def = pool.splice(i, 1)[0];
    if (goals.some((g) => g.type === def.type)) continue;
    goals.push({ id: def.id, type: def.type, target: def.target, label: def.label, reward: def.reward, progress: 0, claimed: false });
  }
  s.daily = { date: today, goals };
  persist();
  return s.daily;
}
// 転生時に旅の実績からデイリーを進める（進行の唯一の入口＝取りこぼしなし）
function advanceDaily(run, dist) {
  const d = ensureDaily();
  const fragSum = EMOTION_ORDER.reduce((a, k) => a + (Number.isFinite(run.emotions && run.emotions[k]) ? run.emotions[k] : 0), 0);
  for (const g of d.goals) {
    if (g.claimed) continue;
    if (g.type === "runs") g.progress += 1;
    else if (g.type === "frags") g.progress += fragSum;
    else if (g.type === "kills") g.progress += Number.isFinite(run.kills) ? run.kills : 0;
    else if (g.type === "boss") g.progress += Number.isFinite(run.bossKills) ? run.bossKills : 0;
    else if (g.type === "dist") g.progress = Math.max(g.progress, dist); // 1回の旅の最高到達
  }
}
export function dailyList() {
  return ensureDaily().goals.map((g) => ({ ...g, done: g.progress >= g.target }));
}
export function claimDaily(id) {
  const s = getSave();
  const d = ensureDaily();
  const g = d.goals.find((x) => x.id === id);
  if (!g || g.claimed || g.progress < g.target) return { ok: false };
  g.claimed = true;
  if (g.reward.satori) { s.enlightenment += g.reward.satori; s.lifetime.enlightenment += g.reward.satori; }
  if (g.reward.gold) { s.gold += g.reward.gold; s.lifetime.gold += g.reward.gold; }
  persist();
  return { ok: true, reward: g.reward, label: g.label };
}
export function unclaimedDailyCount() {
  return dailyList().filter((g) => g.done && !g.claimed).length;
}

// アーティファクトの恒久ボーナス（%）を集計
export function getArtifactBonuses() {
  const b = { hp: 0, atk: 0, spd: 0, frag: 0, coin: 0, drop: 0 };
  const arts = getSave().artifacts;
  const emos = {};
  for (const a of arts) {
    if (b[a.stat] !== undefined) b[a.stat] += a.pct;
    if (a.emotion) emos[a.emotion] = true;
  }
  // セット効果(収集D)：4感情すべての結晶を持つと全ステ+X%
  if (EMOTION_ORDER.every((k) => emos[k])) {
    b.hp += ARTIFACT.setBonusPctAll;
    b.atk += ARTIFACT.setBonusPctAll;
    b.spd += ARTIFACT.setBonusPctAll;
  }
  return b;
}
// 結晶のレア度をロール（収集D）
function rollArtifactRarity() {
  const r = Math.random();
  let acc = 0;
  for (const x of ARTIFACT.rarities) {
    acc += x.chance;
    if (r <= acc) return x;
  }
  return ARTIFACT.rarities[0];
}
// 結晶のセット効果が成立しているか（UI表示用）
export function artifactSetComplete() {
  const emos = {};
  for (const a of getSave().artifacts) if (a.emotion) emos[a.emotion] = true;
  return EMOTION_ORDER.every((k) => emos[k]);
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
  // 放置生産の二重付与防止：lastSeen は「新しい方」を保持する。
  //  クラウド側の古い lastSeen で巻き戻ると、回収済みの放置時間をもう一度もらえてしまう。
  const localLastSeen = _save && typeof _save.lastSeen === "number" ? _save.lastSeen : 0;
  _save = ensure({ ...defaultSave(), ...obj });
  _save.lastSeen = Math.max(_save.lastSeen || 0, localLastSeen);
  try {
    localStorage.setItem(KEY, JSON.stringify(_save));
  } catch (e) {
    /* ignore */
  }
  return true;
}

// ---- クラウド同期のフィールド単位マージ ----
//  丸ごと置換だと「負けた側にしか無い進行」が消える。永続・単調増加の進行は
//  双方向に取り込み、識別子を持たないコレクションは base（スコア勝者）優先で守る。
//  base=進行スコアの勝者 / other=敗者。マージ結果を新しいセーブとして返す。
function maxNum(a, b) {
  const x = Number.isFinite(a) ? a : 0;
  const y = Number.isFinite(b) ? b : 0;
  return Math.max(x, y);
}
export function mergeCloudSaves(base, other) {
  const m = ensure({ ...defaultSave(), ...JSON.parse(JSON.stringify(base || {})) });
  const o = ensure({ ...defaultSave(), ...JSON.parse(JSON.stringify(other || {})) });

  // 魂（すべて単調増加）
  m.soul.level = maxNum(m.soul.level, o.soul.level);
  m.soul.rebirths = maxNum(m.soul.rebirths, o.soul.rebirths);
  m.soul.bestDistance = maxNum(m.soul.bestDistance, o.soul.bestDistance);
  for (const k of EMOTION_ORDER) m.soul.memory[k] = maxNum(m.soul.memory[k], o.soul.memory[k]);

  // 通貨：累計は単調増加なので max。残高も max（消失より軽微な重複を選ぶ＝1人用ゲームで実害なし）
  m.lifetime.enlightenment = maxNum(m.lifetime.enlightenment, o.lifetime.enlightenment);
  m.lifetime.gold = maxNum(m.lifetime.gold, o.lifetime.gold);
  m.enlightenment = maxNum(m.enlightenment, o.enlightenment);
  m.gold = maxNum(m.gold, o.gold);

  // 導く心のツリー：ノードごとに高い方のレベル
  for (const br of TREE_BRANCH_KEYS) {
    for (const id in o.tree[br]) m.tree[br][id] = maxNum(m.tree[br][id], o.tree[br][id]);
  }

  // 絆・素材・アイテム・共鳴：per-key max
  m.bonds.met = maxNum(m.bonds.met, o.bonds.met);
  for (const k of EMOTION_ORDER) m.bonds.byEmotion[k] = maxNum(m.bonds.byEmotion[k], o.bonds.byEmotion[k]);
  for (const k of EMOTION_ORDER) m.materials[k] = maxNum(m.materials[k], o.materials[k]);
  for (const k in o.items) m.items[k] = maxNum(m.items[k], o.items[k]);
  m.party.paidSlots = maxNum(m.party.paidSlots, o.party.paidSlots);
  m.party.resonance = maxNum(m.party.resonance, o.party.resonance);

  // 特別な仲間（ショップ）：購入記録は和集合。敗者側だけが迎えた個体は base に移住させる
  for (const id of o.shopOwned) {
    if (!m.shopOwned.includes(id)) {
      m.shopOwned.push(id);
      const comp = o.party.bonded.find((b) => b.special && b.shopId === id);
      if (comp && !m.party.bonded.some((b) => b.special && b.shopId === id)) {
        m.party.bonded.push({ ...comp, id: m.party.nextId++, active: false });
      }
    }
  }

  // 図鑑・エンディング：見た記録の和集合
  for (const k in o.dex.forms) if (o.dex.forms[k]) m.dex.forms[k] = true;
  if (o.dex.shiny) for (const k in o.dex.shiny) if (o.dex.shiny[k]) m.dex.shiny[k] = true;
  if (Array.isArray(o.dex.rewards)) for (const n of o.dex.rewards) if (!m.dex.rewards.includes(n)) m.dex.rewards.push(n);
  if (Array.isArray(o.dex.shinyRewards)) for (const n of o.dex.shinyRewards) if (!m.dex.shinyRewards.includes(n)) m.dex.shinyRewards.push(n);
  m.trueChapter = !!(m.trueChapter || o.trueChapter); // 真章は片方で解放済みなら維持
  if (!m.starterEgg && o.starterEgg) m.starterEgg = o.starterEgg; // 卵の選択は勝者優先で補完
  for (const k in o.endings) if (o.endings[k]) m.endings[k] = true;
  m.endingSeen = !!(m.endingSeen || o.endingSeen);
  if (!m.spiritName && o.spiritName) m.spiritName = o.spiritName;
  m.seenIntro = !!(m.seenIntro || o.seenIntro);
  m.battleCoached = !!(m.battleCoached || o.battleCoached);
  if (!m.player.chosen && o.player.chosen) m.player = { ...o.player };

  // 識別子のないコレクション（結晶）：多い方を採用（和集合だと二重計上する）
  if (Array.isArray(o.artifacts) && o.artifacts.length > m.artifacts.length) m.artifacts = o.artifacts;

  // お知らせ既読・あかし受け取り：和集合
  for (const n of o.noticesRead) if (!m.noticesRead.includes(n)) m.noticesRead.push(n);
  for (const id of o.achievementsClaimed) if (!m.achievementsClaimed.includes(id)) m.achievementsClaimed.push(id);
  // 熟練度・生涯カウント・深淵到達（すべて単調増加）
  for (const k of EMOTION_ORDER) m.lifetimeFrags[k] = maxNum(m.lifetimeFrags[k], o.lifetimeFrags[k]);
  m.lifetime.kills = maxNum(m.lifetime.kills, o.lifetime.kills);
  m.lifetime.bossKills = maxNum(m.lifetime.bossKills, o.lifetime.bossKills);
  m.abyssBest = maxNum(m.abyssBest, o.abyssBest);

  // 時刻系は新しい方（lastSeen は放置生産の二重付与防止）
  m.lastSeen = maxNum(m.lastSeen, o.lastSeen);
  m.stamp = maxNum(m.stamp, o.stamp);
  // ※ equipment / 通常の仲間 / diary / prefs は識別子が端末ローカルのため base 優先のまま
  return m;
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
  const safeD = Number.isFinite(distance) ? Math.max(0, distance) : 0; // NaN/Infinity が装備ステに永続化するのを防ぐ
  const distMult = 1 + safeD / 200;
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
  // ツリー＋結晶＋熟練度（ログウィズ③：理解が深い感情ほど欠片が集まりやすい）
  for (const k of EMOTION_ORDER) m[k] = eff.fragAll + eff.fragPct[k] + art.frag / 100 + masteryLevel(k) * MASTERY.fragBonusPerLevel;
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

// いま「悟り」で上げられるノードが1つでもあるか（ホームのバッジ用・購入はしない dry-run）
export function canUnlockAnyNode() {
  const s = getSave();
  for (const br of TREE.branches) {
    if (br.hidden && !empathyUnlocked()) continue;
    const levels = s.tree[br.key] || {};
    for (let i = 0; i < br.nodes.length; i++) {
      const node = br.nodes[i];
      const cur = levels[node.id] || 0;
      if (cur >= nodeMax(node)) continue;
      if (i > 0 && (levels[br.nodes[i - 1].id] || 0) < 1) continue;
      if (s.enlightenment >= nodeCost(node, cur)) return true;
    }
  }
  return false;
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
  // 図鑑ボーナス(収集C)：集めるほど強くなる
  const dexB = dexBonusPct();
  hp *= 1 + dexB;
  atk *= 1 + dexB;
  hp = Math.round(hp);
  atk = Math.round(atk);
  spd = Math.round(spd);
  return { hp, maxHp: hp, atk, spd, def: Math.round(def), luk: Math.round(luk), resonanceKey: dominantMemory() };
}

// 転生処理：今生の生き方を魂に刻む（設計書§6）＋ 導く心が「悟り」を得る（§8）
export function transmigrate(run) {
  const s = getSave();
  // 上流バグ由来の NaN/Infinity が永続セーブへ混入すると通貨・魂が復旧不能に汚染されるため、必ず有限化する
  const runEmotions = (run && run.emotions) || {};
  const safeDist = Number.isFinite(run && run.distance) ? Math.max(0, run.distance) : 0;
  for (const k of EMOTION_ORDER) {
    const v = runEmotions[k];
    const safe = Number.isFinite(v) ? v : 0;
    s.soul.memory[k] = (Number.isFinite(s.soul.memory[k]) ? s.soul.memory[k] : 0) + safe;
    s.lifetimeFrags[k] = (Number.isFinite(s.lifetimeFrags[k]) ? s.lifetimeFrags[k] : 0) + safe; // 熟練度の源泉
  }
  // 生涯討伐数（あかし用）＋深淵の最高到達
  s.lifetime.kills += Number.isFinite(run && run.kills) ? run.kills : 0;
  s.lifetime.bossKills += Number.isFinite(run && run.bossKills) ? run.bossKills : 0;
  if (run && run.abyss) s.abyssBest = Math.max(s.abyssBest, Math.floor(safeDist));
  advanceDaily(run || {}, Math.floor(safeDist)); // デイリーの灯を進める（唯一の進行入口）
  const levelGain = safeDist >= SOUL.minRewardDistance ? Math.max(1, Math.floor(safeDist / SOUL.levelPerDeathDistance)) : 0;
  s.soul.level += levelGain;
  s.soul.rebirths += 1;
  const dist = Math.floor(safeDist);
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
  const domRun = dominantOf(runEmotions) || "none";
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
    const rar = rollArtifactRarity(); // レア度をロール（収集D）
    const base = stat.base + Math.floor(Math.random() * (stat.base + 1));
    const pct = Math.max(1, Math.round(base * rar.mult));
    const art = { emotion, stat: stat.key, pct, rarity: rar.key };
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
  // 節目の超強化（ログウィズ②）：Lv10の倍数=超激強化 ×2.0 / Lv5の倍数=超強化 ×1.5 / 通常 ×1.2
  const up = COMPANION.upgrade;
  let mult = up.statMult;
  let milestone = null;
  if (rec.level % 10 === 0) {
    mult = up.milestone10Mult || up.statMult;
    milestone = "hyper";
  } else if (rec.level % 5 === 0) {
    mult = up.milestone5Mult || up.statMult;
    milestone = "super";
  }
  rec.atk = Math.max(1, Math.round(rec.atk * mult));
  rec.heal = Math.max(1, Math.round(rec.heal * mult));
  persist();
  return { ok: true, level: rec.level, milestone };
}

// ---- 感情の熟練度（ログウィズ③：職業レベルの翻案）----
//  Lv = floor(√(累計欠片 / curve))。1Lvごとに その感情の欠片獲得 +3%（fragMultipliersに合流）。
export function masteryLevel(key) {
  const total = getSave().lifetimeFrags[key] || 0;
  return Math.min(MASTERY.maxLevel, Math.floor(Math.sqrt(Math.max(0, total) / MASTERY.levelCurve)));
}
export function masteryInfo() {
  const s = getSave();
  const out = {};
  for (const k of EMOTION_ORDER) {
    const level = masteryLevel(k);
    const next = level >= MASTERY.maxLevel ? null : MASTERY.levelCurve * Math.pow(level + 1, 2);
    out[k] = { level, total: s.lifetimeFrags[k] || 0, next, bonus: level * MASTERY.fragBonusPerLevel };
  }
  return out;
}
export function masterySum() {
  return EMOTION_ORDER.reduce((a, k) => a + masteryLevel(k), 0);
}

// ---- あかし（ログウィズ④：実績。達成 → ホームで受け取り）----
function achievementStat(s, key) {
  switch (key) {
    case "bestDistance": return s.soul.bestDistance || 0;
    case "rebirths": return s.soul.rebirths || 0;
    case "kills": return s.lifetime.kills || 0;
    case "bossKills": return s.lifetime.bossKills || 0;
    case "met": return (s.bonds && s.bonds.met) || 0;
    case "forms": return Object.keys(s.dex.forms || {}).length;
    case "endings": return Object.keys(s.endings || {}).filter((k) => s.endings[k]).length;
    case "artifacts": return (s.artifacts || []).length;
    case "masterySum": return masterySum();
    case "abyssBest": return s.abyssBest || 0;
    default: return 0;
  }
}
export function achievementList() {
  const s = getSave();
  return ACHIEVEMENTS.map((def) => ({
    def,
    value: achievementStat(s, def.stat),
    done: achievementStat(s, def.stat) >= def.gte,
    claimed: s.achievementsClaimed.includes(def.id),
  }));
}
export function unclaimedAchievementCount() {
  return achievementList().filter((a) => a.done && !a.claimed).length;
}
export function claimAchievement(id) {
  const s = getSave();
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return { ok: false };
  if (s.achievementsClaimed.includes(id)) return { ok: false, reason: "受け取り済み" };
  if (achievementStat(s, def.stat) < def.gte) return { ok: false, reason: "まだ達していない" };
  s.achievementsClaimed.push(id);
  const r = def.reward || {};
  if (r.satori) {
    s.enlightenment += r.satori;
    s.lifetime.enlightenment += r.satori;
  }
  if (r.gold) {
    s.gold += r.gold;
    s.lifetime.gold += r.gold;
  }
  persist();
  return { ok: true, reward: r, def };
}

// ---- 深淵（ログウィズ⑥：エンディング後のエンドレス高難度）----
export function abyssUnlocked() {
  const s = getSave();
  return !!s.endingSeen || Object.keys(s.endings || {}).some((k) => s.endings[k]);
}
export function setAbyss(on) {
  getSave().prefs.abyss = !!on;
  persist();
}
export function abyssActive() {
  return !!getSave().prefs.abyss && abyssUnlocked();
}

export function markIntroSeen() {
  getSave().seenIntro = true;
  persist();
}

export function markBattleCoached() {
  getSave().battleCoached = true;
  persist();
}

// 主人公（男の子/女の子＋なまえ）
export function getPlayer() {
  return getSave().player;
}
export function setPlayer(patch) {
  const s = getSave();
  s.player = { ...s.player, ...patch };
  persist();
}
export function markPlayerChosen() {
  getSave().player.chosen = true;
  persist();
}

export function markEndingSeen() {
  getSave().endingSeen = true;
  persist();
}

// 見たエンディングの種類を記録（図鑑・収集）
export function recordEnding(key) {
  const s = getSave();
  s.endings = s.endings || {};
  if (!s.endings[key]) {
    s.endings[key] = true;
    persist();
  }
}
export function endingCollected(key) {
  return !!(getSave().endings || {})[key];
}
export function endingsCount() {
  return Object.keys(getSave().endings || {}).length;
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
  if (s.party.bonded.length >= carryoverSlots()) return { ok: false, reason: "魂の器がいっぱい" }; // 器の上限を超えて迎えない
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
    shiny: Math.random() < COLLECTION.shinyChance, // きらめき個体(色違い)を低確率でロール（収集A）
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
  if (!Number.isFinite(runDistance)) runDistance = 0; // 共鳴蓄積の NaN 汚染防止
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
          shiny: !!rc.shiny, // きらめき個体（収集A）
        };
        s.party.bonded.push(rec);
        newlyBonded.push(rec);
        if (rec.shiny) recordShiny(rec.emotion); // 図鑑にきらめきを刻む
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
      if (hatched.shiny) recordShiny(hatched.emotion); // 孵化でのきらめきを記録（収集A）
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
