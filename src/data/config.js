// =====================================================================
//  config.js  ── 調整パラメータ集約（指示書§7）
//  バランス調整はすべてここで行う。マジックナンバーをコード本体に置かない。
//  ※数値は「実際に遊んで微調整する」前提（設計書§5注記）。
// =====================================================================

// ---- 画面（スマホ縦持ち 9:16 相当）----
export const GAME_WIDTH = 450;
export const GAME_HEIGHT = 800;

// ---- 主人公の初期ステータス（試作は HP/ATK/SPD の3要素）----
export const HERO_BASE = {
  hp: 100,
  atk: 15,
  spd: 10,
  def: 5, // 被ダメ軽減の素体値（悲しみ=盾のベース）。ATK×(100/(100+DEF)) で軽減。
  luk: 5, // 会心率の素体値（希望=会心のベース）。
};

// 会心（クリ）：運(LUK)が高いほど会心が出て大ダメージ（希望=逆転のバースト）
export const CRIT = {
  chancePerLuk: 0.006, // LUK1につき会心率 +0.6%
  maxChance: 0.5, // 会心率の上限
  mult: 1.8, // 会心時のダメージ倍率
};

// ---- 敵の基礎値（距離に応じて指数インフレ：設計書§5）----
export const ENEMY_BASE = {
  hp: 44, // 取締役調整：HPを厚く（打ち合いを長く・白熱）
  atk: 3, // 攻撃はある程度下げる（即死を減らす）
  growth: 1.072, // 成長をやや緩やかに → 育て切った終盤は雑魚をワンパンできる方向
  spdMin: 5,
  spdMax: 15,
};

// ---- 戦闘テンポ ----
export const COMBAT = {
  turnIntervalMs: 380, // 1ティックの間隔（見ていられる速さ）
  atbThreshold: 10, // 行動ゲージ閾値（spdを毎ティック加算→到達で攻撃）
  walkSpeed: 22, // 進軍速度(m/s)
  distancePerEncounter: 14, // 何mごとに敵が出るか（±ゆらぎあり）
  maxBattleTicks: 340, // 戦闘の最長ティック。超えたら強制決着（フリーズ防止の安全網。ボスHP増に合わせ拡大）
  maxActionsPerTick: 12, // 1ティックで処理する最大行動数（速い者が貯めたゲージ分だけ多く動ける上限＝暴走防止）
  swarmEnabled: true, // 群れ（複数の敵を連戦）。控えは右にシルエット表示。取締役：進軍する群れを採用。
};

// ---- 戦い方 → 宿る感情（このゲームの肝：設計書§4-3）----
//  ※複数同時に該当してよい（該当した感情すべてに +1）
export const EMOTION_RULES = {
  angerTurns: 2, // 🔥怒り  : 撃破までのターン <= これ（短時間で押し切った）
  sadnessDamageRatio: 0.4, // 💧悲しみ: 被ダメ >= 主人公最大HPのこの割合（耐えて勝った）
  // ⚡勇気  : 敵の攻撃回数 == 0（先制で倒した）
  hopeHpRatio: 0.25, // ✨希望  : 戦闘中の最低HP割合 <= これ かつ 勝利（瀕死から勝った）
};

// ---- 技（主人公の必殺技：通常攻撃を重ねると放つ。感情で技が変わる）----
export const SKILL = {
  heroEvery: 4, // 主人公はこの回数攻撃するごとに「技」を放つ
  heroMult: 2.6, // 技のダメージ倍率
  // 感情ごとの技名（漢字＝種族技のイメージ）
  names: { anger: "焦熱斬", sadness: "鎮魂の波", courage: "疾風突", hope: "希望の輝き" },
  defaultName: "ひとふり",
};

// ---- 逓減（同じ感情ばかり集めると効率↓：設計書§4 歯止め2）----
//  試作では既定OFF（ゲージの動きを分かりやすく見せるため）。要検証時にON。
export const DIMINISH = {
  enabled: false,
  factorPerStack: 0.85, // n個目の同感情は 0.85^n の価値
};

// ---- 進化（試作は初進化のみ：指示書§5）----
export const EVOLUTION = {
  threshold: 12, // いずれかの感情累計がこの値で初進化（取締役：早すぎ→引き上げ）
  statMultiplier: 1.5, // 進化時 ATK/HP ×1.5
};

// ---- 多段進化（設計書§3：スライム→獣→戦士→感情の化身。4系統×3段）----
//  単一感情が累計しきい値を超えるたびに次の段階へ。混合/三重/闇堕ちは初進化の特別ルート。
export const EVOLUTION_STAGES = {
  // 累計しきい値（leading emotion）：獣／戦士／化身。1段目はツリーの effectiveEvoThreshold を使う。
  step2: 14, // 戦士へ：1段目の閾値＋この値（GameSceneが参照）
  step3: 34, // 化身へ：1段目の閾値＋この値（GameSceneが参照）
  statMultiplier: 1.5, // 各段階で ATK/HP ×
  forms: {
    anger: [
      { name: "カグツ", label: "火牙", icon: "🔥" },
      { name: "ベルガ", label: "紅蓮戦鬼", icon: "👹" },
      { name: "イグニス", label: "憤怒の化身", icon: "🌋" },
    ],
    sadness: [
      { name: "シズク", label: "涙獣", icon: "💧" },
      { name: "アオイ", label: "蒼守護者", icon: "🛡️" },
      { name: "ラクリマ", label: "慈悲の化身", icon: "🌊" },
    ],
    courage: [
      { name: "カゼリ", label: "風牙", icon: "⚡" },
      { name: "ハヤテ", label: "疾風剣士", icon: "⚔️" },
      { name: "ウェントス", label: "勇気の化身", icon: "🌩️" },
    ],
    hope: [
      { name: "ヒカリ", label: "光牙", icon: "✨" },
      { name: "アカリ", label: "聖賢者", icon: "🕯️" },
      { name: "ステラ", label: "希望の化身", icon: "🌟" },
    ],
  },
};

// ---- 混合進化（設計書§11：2系統が拮抗→混ざった姿へ・全6種）----
//  キーは EMOTION_ORDER 順にソートした2感情を "+"。個体名＝カタカナ／種族＝漢字。
export const MIXED_EVOLUTION = {
  ratio: 0.7, // 2位が1位のこの割合以上なら"拮抗"とみなし混合進化
  forms: {
    "anger+sadness": { name: "ドウコク", label: "慟哭の鬼", icon: "👹", color: 0xc0506a },
    "anger+courage": { name: "フンジン", label: "疾る焔", icon: "☄️", color: 0xff7a3b },
    "anger+hope": { name: "ネガイ", label: "灼ける聖者", icon: "🔥", color: 0xffb14d },
    "sadness+courage": { name: "チンコン", label: "涙する剣", icon: "🗡️", color: 0x6a8fd0 },
    "sadness+hope": { name: "ニジ", label: "雨上がりの守護者", icon: "🌈", color: 0x7ad0c0 },
    "courage+hope": { name: "アウロラ", label: "暁の使徒", icon: "🌅", color: 0xffd27a },
  },
};

// ---- 三重混合（設計書§11：3系統拮抗→欠けた1感情で性格が決まる・全4種）----
//  キー＝"欠けた感情"（最も低い1つ）。
export const TRIPLE_EVOLUTION = {
  forms: {
    hope: { name: "シュラ", label: "嘆きを断つ者", icon: "⚔️", color: 0xb0566e }, // 怒×悲×勇（希望が欠）
    courage: { name: "ジョウカ", label: "痛みを抱く光", icon: "🕯️", color: 0xe0b070 }, // 怒×悲×希（勇気が欠）
    sadness: { name: "レツジツ", label: "砕けぬ意志", icon: "☀️", color: 0xff9a3b }, // 怒×勇×希（悲しみが欠）
    anger: { name: "ジウ", label: "すべてを赦す者", icon: "🌟", color: 0x9ad0ff }, // 悲×勇×希（怒りが欠）
  },
};

// ---- 闇堕ち進化（設計書§11：絶望で混合が反転・全6種）----
//  二重混合のペアキーに対応。旅で瀕死を耐えた回数（絶望）が閾値超で堕ちる。
export const DARK_EVOLUTION = {
  despairThreshold: 2, // 瀕死(最低HP<12%)を耐えた回数がこれ以上で闇堕ち
  forms: {
    "anger+sadness": { name: "オンサ", label: "呪う亡霊", icon: "👻", color: 0x7a4a6a }, // 慟哭→
    "anger+courage": { name: "キョウラン", label: "焼き尽くす者", icon: "🌋", color: 0x9a3a2a }, // 疾る焔→
    "anger+hope": { name: "ショウド", label: "灰の伝道者", icon: "🌑", color: 0x7a6a5a }, // 灼ける聖者→
    "sadness+courage": { name: "ボウシュウ", label: "還らぬ剣", icon: "🗡️", color: 0x4a5a7a }, // 涙する剣→
    "sadness+hope": { name: "デキコウ", label: "偽りの救い手", icon: "🌫️", color: 0x5a7a6a }, // 雨上がりの守護者→
    "courage+hope": { name: "ビャクヤ", label: "眠らない使徒", icon: "🌗", color: 0x8a8ab0 }, // 暁→
  },
};

// ---- 感情の表示情報 ----
//  カタカナ＝個体名 / 漢字ラベル＝種族（設計書§11命名ルール）
export const EMOTIONS = {
  anger: { key: "anger", icon: "🔥", color: 0xff4d4d, label: "怒り", evolvedIcon: "🔥", name: "カグツ" },
  sadness: { key: "sadness", icon: "💧", color: 0x4d9fff, label: "悲しみ", evolvedIcon: "💧", name: "シズク" },
  courage: { key: "courage", icon: "⚡", color: 0xffd24d, label: "勇気", evolvedIcon: "⚡", name: "カゼリ" },
  hope: { key: "hope", icon: "✨", color: 0xf0f0f0, label: "希望", evolvedIcon: "✨", name: "ヒカリ" },
};

export const EMOTION_ORDER = ["anger", "sadness", "courage", "hope"];

// ---- 敵タイプ（設計書§12：敵の性質が戦い方を誘導する）----
//  試作にも入れて「4感情の差」を体感できるようにする（黒沢の検証ポイント）。
//  hpMod/atkMod/spdMod は ENEMY_BASE への倍率。
export const ENEMY_TYPES = [
  // もろい・攻撃的 → 短時間で押し切る＝怒り
  { key: "anger", icon: "😡", label: "ささくれ影", hpMod: 0.7, atkMod: 1.0, spdMod: 0.8 },
  // 硬い・粘る → 耐えて勝つ＝悲しみ
  { key: "sadness", icon: "😢", label: "よどみ影", hpMod: 2.4, atkMod: 3.0, spdMod: 0.6 },
  // 鈍重・低火力 → 一方的に先制撃破＝勇気
  { key: "courage", icon: "😤", label: "ちらつき影", hpMod: 1.3, atkMod: 0.5, spdMod: 0.3 },
  // 高速・高火力 → 瀕死から逆転＝希望
  { key: "hope", icon: "🌫️", label: "うずくまり影", hpMod: 1.6, atkMod: 3.2, spdMod: 1.2 },
];

// ---- バイオーム別の敵ロスター（周回マンネリ対策：territoryごとに違う相手）----
//  4感情の挙動(anger=脆く速攻/sadness=硬く耐え/courage=鈍く先制/hope=速く逆転)は厳守。名前/絵文字/色/深部変種で territory 感。
export const BIOME_DEEP_DIST = 600; // これ以深で各バイオームの「深部変種」（強化＋接頭辞）が出る
export const BIOME_ENEMIES = [
  { name: "山鳴りの道", key: "mountain", deep: { prefix: "「山鳴りを孕む」", hp: 0.22, atk: 0.16 }, types: [
    { lean: "anger", name: "岩噛みの影", icon: "🪨", tint: 0x9c4a63, hpMod: 0.68, atkMod: 1.03, spdMod: 0.78, flavor: "登れなかった斜面をいまも爪で掻きむしる、脆く尖った怒りの影。" },
    { lean: "sadness", name: "沈む巌の影", icon: "🗿", tint: 0x2b3a66, hpMod: 2.5, atkMod: 2.9, spdMod: 0.58, flavor: "背負った石を下ろせぬまま、藍色の夜に沈み込んでいく悲しみ。" },
    { lean: "courage", name: "すくむ足の影", icon: "👣", tint: 0x566a8c, hpMod: 1.35, atkMod: 0.47, spdMod: 0.28, flavor: "踏み出せなかった最初の一歩が、岩陰でうずくまり山風に震えている。" },
    { lean: "hope", name: "またたく星影", icon: "💫", tint: 0xb7c2ee, hpMod: 1.55, atkMod: 3.3, spdMod: 1.25, flavor: "暗い尾根でただ一つ瞬く、消えそうで消えない身軽な希望の残り火。" },
  ] },
  { name: "囁きの森", key: "forest", deep: { prefix: "森に呑まれし", hp: 0.25, atk: 0.18 }, types: [
    { lean: "anger", name: "棘噛みの影", icon: "🥀", tint: 0x7a5a34, hpMod: 0.7, atkMod: 1.05, spdMod: 0.8, flavor: "森に捨てられた憤り。荊となり、通る者に噛みついて放さない。" },
    { lean: "sadness", name: "苔生す慟哭", icon: "🍄", tint: 0x2f5e54, hpMod: 2.35, atkMod: 2.9, spdMod: 0.6, flavor: "泣くのをやめた者が沈めた悲しみ。苔と泥濘に埋もれ枝を振り下ろす。" },
    { lean: "courage", name: "根縛りの影", icon: "🌳", tint: 0x93a552, hpMod: 1.3, atkMod: 0.5, spdMod: 0.32, flavor: "踏み出せなかった勇気が根を張った。動けぬまま道の真ん中に立ち続ける。" },
    { lean: "hope", name: "惑わす燐火", icon: "🦋", tint: 0xbfe39a, hpMod: 1.62, atkMod: 3.15, spdMod: 1.2, flavor: "拾われるのを待つ希望の燐火。木々の間を駆け、瀕死の旅人を試すように光る。" },
  ] },
  { name: "忘れられた廃墟", key: "ruins", deep: { prefix: "「風化せし」", hp: 0.25, atk: 0.18 }, types: [
    { lean: "anger", name: "錆刃の怨影", icon: "🗡️", tint: 0xc0562e, hpMod: 0.68, atkMod: 1.05, spdMod: 0.82, flavor: "打ち捨てられた武具に宿った怒り。錆に喰われながらなお刃を振るう。" },
    { lean: "sadness", name: "錆涙の澱影", icon: "🪦", tint: 0x6e8a80, hpMod: 2.55, atkMod: 3.1, spdMod: 0.58, flavor: "壁を伝う錆は、この地が流し続けた涙の跡。重く、決して崩れ落ちない。" },
    { lean: "courage", name: "忘れ守りの影", icon: "🏛️", tint: 0xce9a3c, hpMod: 1.35, atkMod: 0.46, spdMod: 0.28, flavor: "誰も還らぬ門を、名も忘れた衛士がまだ守る。鈍いが決して退かない。" },
    { lean: "hope", name: "宵灯の残響", icon: "🏮", tint: 0xf0b46a, hpMod: 1.55, atkMod: 3.3, spdMod: 1.28, flavor: "夕日に灯る幻の窓明かり。かつての賑わいを希って素早く瞬いては消える。" },
  ] },
  { name: "幽玄の境", key: "void", deep: { prefix: "幽冥に憑かれし", hp: 0.3, atk: 0.25 }, types: [
    { lean: "anger", name: "鬼哭の紫焔", icon: "👺", tint: 0x9b3d7a, hpMod: 0.68, atkMod: 1.05, spdMod: 0.82, flavor: "捨てられた怒りが夢幻の境で紫の焔となり、見境なく噛みつく脆い亡魂。" },
    { lean: "sadness", name: "慟哭の淵影", icon: "👻", tint: 0x2f2450, hpMod: 2.5, atkMod: 3, spdMod: 0.6, flavor: "誰にも掬われなかった悲しみが澱み沈み、境の底で来訪者を重く押し潰す。" },
    { lean: "courage", name: "微睡む骸兵", icon: "🛡️", tint: 0x5b4c86, hpMod: 1.3, atkMod: 0.5, spdMod: 0.3, flavor: "挫かれ手放された勇気の亡骸。斬りかかられて初めて鈍く目を醒ます。" },
    { lean: "hope", name: "揺らめく夢魔", icon: "🔮", tint: 0xb083ff, hpMod: 1.6, atkMod: 3.2, spdMod: 1.25, flavor: "手放された希望が鬼火となり、瀕死の淵まで一息に駆け寄っては弾ける。" },
  ] },
];

// ---- 転生（設計書§6：記憶＝感情の傾向）----
export const SOUL = {
  levelStatPerLevel: 0.05, // 魂レベル1ごとに 主人公の最大HP/ATK +5%
  levelPerDeathDistance: 50, // この距離ごとに魂レベル+1（死亡/撤退時、最低+1）
  minRewardDistance: 20, // これ未満の距離で帰ると魂レベル/結晶の永続報酬は無し（出発→即撤退の無限稼ぎ封じ）
  resonanceBonus: 0.5, // いちばん多く抱いた記憶の感情：その欠片の獲得量 +50%（共鳴）
};

// ---- 装備「感情の残響」（設計書§9 軸1）----
export const EQUIPMENT = {
  slots: 2, // 装備できる枠数
  dropChance: 0.22, // 戦闘勝利時のドロップ率
  baseStat: { hp: 12, atk: 3, spd: 1, def: 6, luk: 5 },
  // 感情ごとの得意ステータス（その感情の装備は得意ステが伸びる）。4感情=4ステの識別：怒=攻/悲=盾/勇=速/希=運
  focus: { anger: "atk", sadness: "def", courage: "spd", hope: "luk" },
  // レアリティ（並/希/極/神話）：青天井の収集欲（設計書§9）
  rarities: [
    { key: "common", label: "並", color: 0xb0b0c0, weight: 70, mult: 1.0 },
    { key: "rare", label: "希", color: 0x4d9fff, weight: 22, mult: 1.7 },
    { key: "epic", label: "極", color: 0xb24dff, weight: 7, mult: 2.6 },
    { key: "mythic", label: "神話", color: 0xffba3b, weight: 1, mult: 4.0 },
  ],
};

// ---- 制作（素材→装備）----
//  各感情の素材をコスト分消費して、その感情の装備「感情の残響」を作る。
//  生成時の威力は「最高到達距離」を基準にスケール（進むほど強い装備が作れる）。
export const CRAFT = {
  costs: { common: 5, rare: 15, epic: 40, mythic: 100 },
};

// ---- アーティファクト「感情の残響」（設計書§9 軸1：ローグウィズデッド型の%強化コレクション）----
//  装備（スロット制・固定値）と違い、拾うほど無制限に積み上がり、所持するだけで永続%ボーナス。
export const ARTIFACT = {
  dropChance: 0.12, // 戦闘勝利時のドロップ率
  stats: [
    { key: "hp", label: "最大HP", icon: "❤", base: 5 },
    { key: "atk", label: "攻撃", icon: "⚔", base: 5 },
    { key: "spd", label: "素早さ", icon: "⚡", base: 4 },
    { key: "frag", label: "感情獲得", icon: "🌱", base: 6 },
    { key: "coin", label: "コイン", icon: "💰", base: 8 },
    { key: "drop", label: "ドロップ率", icon: "🎁", base: 5 },
  ],
};

// ---- 導く心のツリー（設計書§8 ④プレイヤー成長）----
//  主人公は転生でリセットされるが、プレイヤー＝導く心は決してリセットされない。
//  通貨「悟り」をノードに投じて永続強化。器(汎用)＋感情4枝＋隠し枝「共感」。
//  ノード効果は save.js getTreeEffects() で集約し、既存システムに配線する。
export const TREE = {
  evoThresholdFloor: 3, // 進化閾値はこれ未満には下げない（聖域）
  // 「悟り」の獲得式（転生時に確定。到達距離・進化達成・最高更新から）
  //  ※貯まりが速すぎたので減速（2026-06-29 v0.4.1）。要なら更に divisor を上げる。
  satori: {
    perMeter: 1 / 16, // 16mごとに +1（旧 1/8）
    evolveBonus: 2, // その旅で初進化に到達した（旧 3）
    bestBonus: 3, // 最高到達を更新した（旧 5）
  },
  empathyRequirePerEmotion: 2, // 4感情の各枝を各1Lv以上にすると「共感」枝が出現
  costGrowth: 1.4, // ノードを1段上げるごとにコストが ×この値（どんどんレベルアップ）
  maxNodeLevel: 10, // 通常ノードの上限Lv（cost.max を持つノードはそちらを優先）
  branches: [
    {
      key: "vessel",
      icon: "⚙",
      label: "心の器",
      color: 0x8a8aa0,
      desc: "感情に依らない土台。器を広げ、装備や魂を盛る。",
      nodes: [
        { id: "v1", label: "心の広がり", desc: "最大HP +8%", cost: 3, effect: { type: "heroHpPct", value: 0.08 } },
        { id: "v2", label: "器の拡張", desc: "装備スロット +1/Lv", cost: 6, max: 2, effect: { type: "equipSlot", value: 1 } },
        { id: "v3", label: "ドロップの祝福", desc: "装備ドロップ率 +6%", cost: 8, effect: { type: "dropPct", value: 0.06 } },
        { id: "v4", label: "魂の増幅", desc: "魂レベルの強化 +2%/Lv", cost: 12, effect: { type: "soulLevelPct", value: 0.02 } },
        { id: "v5", label: "魂の絆", desc: "持ち越せる仲間 +1/Lv", cost: 16, max: 3, effect: { type: "carryover", value: 1 } },
        { id: "v6", label: "技の冴え", desc: "技の威力 +20%/Lv", cost: 10, effect: { type: "skillMult", value: 0.2 } },
        { id: "v7", label: "疾い技", desc: "技が出るまで -1回/Lv", cost: 14, max: 2, effect: { type: "skillCharge", value: 1 } },
      ],
    },
    {
      key: "anger",
      icon: "🔥",
      label: "怒りの理解",
      color: 0xff4d4d,
      desc: "短く激しく押し切る系統を深く知る。",
      nodes: [
        { id: "a1", label: "怒りの理解Ⅰ", desc: "🔥怒りの欠片 +25%", cost: 4, effect: { type: "fragEmotion", emotion: "anger", value: 0.25 } },
        { id: "a2", label: "滾る血", desc: "攻撃 +7%", cost: 7, effect: { type: "heroAtkPct", value: 0.07 } },
        { id: "a3", label: "怒りの理解Ⅱ", desc: "🔥怒りの欠片 +35%", cost: 12, effect: { type: "fragEmotion", emotion: "anger", value: 0.35 } },
      ],
    },
    {
      key: "sadness",
      icon: "💧",
      label: "悲しみの理解",
      color: 0x4d9fff,
      desc: "耐えて、抱えて勝つ系統を深く知る。",
      nodes: [
        { id: "s1", label: "悲しみの理解Ⅰ", desc: "💧悲しみの欠片 +25%", cost: 4, effect: { type: "fragEmotion", emotion: "sadness", value: 0.25 } },
        { id: "s2", label: "沈黙の盾", desc: "最大HP +10%", cost: 7, effect: { type: "heroHpPct", value: 0.1 } },
        { id: "s3", label: "悲しみの理解Ⅱ", desc: "💧悲しみの欠片 +35%", cost: 12, effect: { type: "fragEmotion", emotion: "sadness", value: 0.35 } },
      ],
    },
    {
      key: "courage",
      icon: "⚡",
      label: "勇気の理解",
      color: 0xffd24d,
      desc: "先んじて制する系統を深く知る。",
      nodes: [
        { id: "c1", label: "勇気の理解Ⅰ", desc: "⚡勇気の欠片 +25%", cost: 4, effect: { type: "fragEmotion", emotion: "courage", value: 0.25 } },
        { id: "c2", label: "疾走", desc: "素早さ +2", cost: 7, effect: { type: "heroSpdFlat", value: 2 } },
        { id: "c3", label: "勇気の理解Ⅱ", desc: "⚡勇気の欠片 +35%", cost: 12, effect: { type: "fragEmotion", emotion: "courage", value: 0.35 } },
      ],
    },
    {
      key: "hope",
      icon: "✨",
      label: "希望の理解",
      color: 0xf0f0f0,
      desc: "瀕死から立て直す系統を深く知る。",
      nodes: [
        { id: "h1", label: "希望の理解Ⅰ", desc: "✨希望の欠片 +25%", cost: 4, effect: { type: "fragEmotion", emotion: "hope", value: 0.25 } },
        { id: "h2", label: "灯火", desc: "攻撃 +6%", cost: 7, effect: { type: "heroAtkPct", value: 0.06 } },
        { id: "h3", label: "希望の理解Ⅱ", desc: "✨希望の欠片 +35%", cost: 12, effect: { type: "fragEmotion", emotion: "hope", value: 0.35 } },
      ],
    },
    {
      key: "empathy",
      icon: "🤝",
      label: "共感",
      color: 0xffb3d9,
      hidden: true, // 4感情を各 empathyRequirePerEmotion 解放すると出現
      desc: "4つの感情すべてを一定以上理解した心にだけ、中央に芽吹く枝。",
      nodes: [
        { id: "e1", label: "受け入れる心", desc: "すべての欠片 +15%", cost: 15, effect: { type: "fragAll", value: 0.15 } },
        { id: "e2", label: "すべてを抱く", desc: "進化に必要な感情 -1/Lv", cost: 25, max: 2, effect: { type: "evoThreshold", value: -1 } },
      ],
    },
  ],
};

// ---- 特別な仲間（直接購入：ガチャでなく"見て選んで迎える"。マネタイズ改訂方針）----
//  手作りの特別個体。永続（転生でも散らない）。試作では確認用に入手できる。
export const SHOP_COMPANIONS = [
  { id: "s_hotaru", name: "ホタル", label: "灯を抱く者", emotion: "hope", role: "clutch", icon: "💫", atk: 18, heal: 16, spd: 9, price: 480, desc: "絶望の淵に、ひとつだけ灯をともす希望。" },
  { id: "s_kurogane", name: "クロガネ", label: "鎮まらぬ焔", emotion: "anger", role: "attacker", icon: "🔥", atk: 24, heal: 8, spd: 8, price: 480, desc: "決して消えない、静かで深い怒り。" },
  { id: "s_nagi", name: "ナギ", label: "凪の守り手", emotion: "sadness", role: "healer", icon: "🌊", atk: 10, heal: 22, spd: 7, price: 480, desc: "すべてを受け止め、波を凪へと還す。" },
];

// ---- 消耗アイテム（素材から作り、一度きり使う）----
//  power/guard は出撃時に消費して旅を強化、phoenix は倒れた時に砕けて立ち上がる。
export const ITEMS = {
  power: { key: "power", icon: "⚔", label: "力の試薬", desc: "この旅 攻撃 +30%（出撃で消費）", cost: { anger: 15 } },
  guard: { key: "guard", icon: "❤", label: "守りの試薬", desc: "この旅 最大HP +30%（出撃で消費）", cost: { sadness: 15 } },
  phoenix: { key: "phoenix", icon: "🪶", label: "不死鳥の羽", desc: "倒れた時 一度だけ立ち上がる", cost: { hope: 25 } },
};
export const ITEM_ORDER = ["power", "guard", "phoenix"];

// ---- 旅の日記（DR③：戻る理由・情緒。転生のたびに主感情で1行残る）----
export const DIARY = {
  max: 20,
  lines: {
    anger: [
      "怒りの多い旅だった。何かを許せないまま、前へ進んだ。",
      "ささくれた影をいくつも払った。胸の奥が、まだ熱い。",
      "押し切るように歩いた。強さの理由は、まだわからない。",
    ],
    sadness: [
      "静かな旅だった。こらえて、こらえて、足を運んだ。",
      "うつむきながら、それでも足は止まらなかった。",
      "悲しみは重かった。でも、ひとつも捨てなかった。",
    ],
    courage: [
      "軽い足取りの旅だった。怖さより先に、足が出た。",
      "先んじて、いくつもの影を越えていった。",
      "迷う前に動けた。少しだけ、自分を好きになれた気がする。",
    ],
    hope: [
      "何度も諦めかけて、そのたびに小さな光を見た。",
      "瀕死から立ち直った。終わらないことが、希望だった。",
      "暗がりの奥に、ぽつんと灯りがあった気がした。",
    ],
    none: ["とりとめのない旅だった。ただ、歩いた。"],
  },
};

// ---- 使い切りコイン強化（ローグウィズデッド型：旅の中だけ・倒れたら1から）----
//  撃破で得た coins を、戦闘画面で攻撃/守り/速さ/欠片に投じる。買うほど高コスト。
//  永続層（魂Lv/ツリー/装備/仲間絆）とは別の "使い切り" 層。聖域：戦闘は自動のまま、
//  これは「命令」でなく「導き＝後押し」。おまかせ自動投資で純・見守るも成立。
export const UPGRADES = {
  costGrowth: 1.55, // 1段ごとにコストが ×この値
  // kind: "pct"=基礎値への割合加算 / "flat"=加算
  items: [
    { key: "atk", icon: "⚔", label: "攻撃", baseCost: 14, per: 0.08, kind: "pct" },
    { key: "hp", icon: "❤", label: "守り", baseCost: 14, per: 0.08, kind: "pct" },
    { key: "spd", icon: "⚡", label: "速さ", baseCost: 12, per: 1, kind: "flat" },
    { key: "frag", icon: "🌱", label: "欠片", baseCost: 18, per: 0.1, kind: "pct" },
  ],
};

// 倍速（"見守る速度"の操作。戦闘の命令ではない）。進化など見せ場は速度非依存に保つ。
export const SPEED_STEPS = [1, 2, 3];

// ---- 進行の可視化（設計書§5 / DR：この先に何かある感）----
export const PROGRESS = {
  milestoneEvery: 100, // この距離ごとに節目演出
};

// ---- 固定距離ボス（DR④：ローグウィズ型。進捗バーの🚩＝向かう先）----
export const BOSS = {
  everyMeters: 100, // この距離ごとにボスが待つ（進捗バーの節目と一致）
  hpMult: 5.5, // 取締役調整：ボスは硬い壁に（HP厚く＝白熱する殴り合い）。安全網 maxBattleTicks/forceFinish で長期化フリーズは回避
  minHitsToKill: 55, // これ未満の攻撃回数で溶けないよう、主人公の攻撃力に応じてHPを底上げ（"すぐ消える"防止・白熱）
  maxHitFrac: 0.04, // ボスは1発で最大HPのこの割合しか減らない＝どんな高火力でも最低約25手の殴り合い（"即溶け=消える"の根絶）
  atkMult: 1.05, // 攻撃は下げて即死を減らし、粘り合いにする
  spdMult: 0.9,
  warnDistance: 22, // 何m手前で接近警告（予兆を長めに）
  rewardMult: 4, // 撃破報酬（コイン）の倍率
  materialBonus: 3, // 撃破で確定で得る素材数
  types: {
    anger: { name: "業火の主", icon: "👹" },
    sadness: { name: "慟哭の淵", icon: "🌧️" },
    courage: { name: "雷鳴の王", icon: "⚔️" },
    hope: { name: "黄昏の使者", icon: "🌟" },
  },
};

// ---- 感情のケア（DR：デジモン式"せわ"。溢れる前にそっと受け止める＝導き・任意）----
//  戦闘後ときどき、いちばん高ぶった感情を受け止められる。タップ＝欠片ブースト。
//  放置のままでも問題なし（無視すれば そっと流れる）。命令ではない。
export const CARE = {
  chance: 0.3, // 戦闘後にケアの機会が訪れる確率
  windowMs: 4000, // 受け止められる猶予
  bonusFrag: 2, // 受け止めた時に宿る欠片
};

// ---- 仲間「救って連れていく」（設計書§17）----
//  敵＝捨てられた感情。倒すとごく稀に「浄化」されて同行＝仲間モンスター。
//  仲間は被弾しない助太刀（試作スコープ。パーティ全滅処理を避ける）。
//  仲間はしゃべる（声4段階）／主人公は沈黙のまま（非対称演出 §17-2,§17-3）。
//  転生＝別れ：仲間は持ち越さず光に還る（"絆と別れ"の核）。出会った数は永続記録。
export const COMPANION = {
  joinChance: 0.12, // 戦闘勝利時に浄化して仲間化する確率（"ごく稀"の試作値・要調整）
  maxParty: 4, // 1回の旅で同時に連れて行ける上限（同行＋旅で新たに出会う合計）
  // 魂の器：手元に置ける仲間の数。10体まで無料、課金で最大20体まで拡張。
  freeSlots: 10, // 無料枠
  maxSlots: 20, // 拡張上限（課金）
  paidSlotCost: 480, // 課金枠1つの価格（試作表示・のちにIAP接続）
  // レア度（どこで仲間になったかで強さが変わる）。距離が深いほど高レア寄り、ボスは高レア確定。
  rarities: [
    { key: "common", label: "並", star: "★", color: 0xb4b4c4, weight: 62, statMult: 1.0 },
    { key: "rare", label: "希", star: "★★", color: 0x53a4ff, weight: 27, statMult: 1.45 },
    { key: "epic", label: "極", star: "★★★", color: 0xb463ff, weight: 9, statMult: 2.1 },
    { key: "mythic", label: "神話", star: "★★★★", color: 0xffbf40, weight: 2, statMult: 3.2 },
  ],
  rarityDepthBias: 0.006, // 距離1mごとに上位レアの重みをこの率で押し上げる（深部ほどレア）
  bossRarityFloor: "rare", // ボス撃破で仲間になる個体の最低レア
  bossRarityFloorDeep: "epic", // 深部ボス（bossFloorDeepFrom以降）の最低レア
  bossFloorDeepFrom: 4, // 何体目のボスから floorDeep を適用するか
  base: { atk: 8, spd: 7, heal: 7 }, // ENEMY_BASE.growth で距離スケールさせる素体
  statScale: 0.6, // 主人公を食わない係数（仲間は脇役）
  clutchHpRatio: 0.4, // ✨希望：主人公HPがこの割合未満で大ダメージ（逆転の一手）
  voiceDistancePerStage: 45, // 同行でこの距離ごとに声の段階が上がる（最大4）
  // 留守番仲間の放置生産（Palworld由来：見守る間も仲間が静かに働く。上限キャップ必須）
  //  街は転生で育つ（townRebirthsPerLevel ごとに +1）。Lvが上がると生産+townBonusPerLevel。
  idle: { capHours: 8, perHour: 6, evoMult: 1.5, townRebirthsPerLevel: 3, townBonusPerLevel: 0.1 },
  // 感情ごとの「街の場所」（属性に合った場所で働く）
  spots: { anger: "焔の炉", sadness: "雫の泉", courage: "疾風の塔", hope: "灯の祭壇" },
  // 共鳴孵化（Palworld配合の翻案：2体以上同行で絆が積もり、卵→新しい仲間）
  resonance: { threshold: 300, childStatMult: 1.3 },
  // 個体強化（お金で各仲間を永続レベルアップ＝ローグウィズ型・愛着の核）
  upgrade: { baseCost: 30, growth: 1.5, statMult: 1.2 },
  // 出自の一言（設計書§17-1：仲間＝誰かが捨てた感情。愛着を生む物語の欠片）
  origins: {
    anger: ["誰かが「もう怒らない」と決めて、置いていった怒り。", "守りたかった。でも守れなかった日の、行き場のない怒り。", "言えなかった「ふざけるな」が、ひとりで燻っていた。"],
    sadness: ["泣くのをやめた人が、そっと手放した悲しみ。", "「平気」と笑うために、隠しておかれた悲しみ。", "もう会えない誰かを、まだ想っている悲しみ。"],
    courage: ["一歩が踏み出せなかった夜に、捨てられた勇気。", "「どうせ無理」に負けて、置き去りにされた勇気。", "誰かを庇おうとして、間に合わなかった勇気。"],
    hope: ["何度も裏切られて、とうとう手放された希望。", "「期待しない方が楽」と、伏せられていた希望。", "暗がりでずっと、拾われるのを待っていた希望。"],
  },
  // 仲間の進化（設計書§17：仲間も同行で進化する）
  evolveAtStage: 3, // 声がこの段階に達したら進化
  evolveStatMult: 1.9, // 進化で攻撃/癒しが ×この値（取締役：もっと強く）
  evolvedIcons: { anger: "👹", sadness: "🌊", courage: "🌩️", hope: "💫" }, // 進化後の姿
  // 感情 → 役割（設計書§17-1）
  roles: {
    anger: { role: "attacker", icon: "🔥", label: "前衛", desc: "敵に追撃する" },
    sadness: { role: "healer", icon: "💧", label: "癒し", desc: "主人公のHPを癒す" },
    courage: { role: "striker", icon: "⚡", label: "先制", desc: "素早く追撃する" },
    hope: { role: "clutch", icon: "✨", label: "逆転", desc: "瀕死の時 一撃を入れる" },
  },
  // 個体名（カタカナ＝個体名。設計書§11命名ルール）
  names: {
    anger: ["ボロ", "スネ", "イカリ", "ヒバ"],
    sadness: ["シオ", "ナミ", "シズ", "アメ"],
    courage: ["ハヤ", "カケ", "トキ", "ソラ"],
    hope: ["アカリ", "ノゾミ", "トモ", "ユメ"],
  },
  // 声の4段階（喋れること自体が成長の表現 §17-2）
  voiceLines: {
    1: ["…", "あ…", "う…", "…っ"],
    2: ["さむい…", "…ありがと", "いた…", "…そばに、いる"],
    3: ["きみは、だれ…?", "どこへ、いくの…?", "…ここは?"],
    4: ["わたし、わすれられたの…", "ずっと、ひとりだった…", "…でも、もう、ひとりじゃない"],
  },
};
