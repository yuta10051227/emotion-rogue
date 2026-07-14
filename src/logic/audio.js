// =====================================================================
//  audio.js  ── WebAudio で音を「合成」する簡易サウンド（アセット無し）
//  情緒ゲーに効く最小の効果音＋ほのかな環境音。すべてオシレータ生成。
//  ブラウザの自動再生制限のため、初回ユーザー操作で onFirstGesture() を呼ぶ。
// =====================================================================

let ctx = null;
let master = null;
let muted = false;
let ambient = null; // 環境音ノード群
let lastHit = 0; // 打撃音の最小間隔ゲート（高速時の機械的連打を間引く）
// ---- ファイルBGM（本物の曲）：public/audio/bgm_<mood>.mp3 か bgm_main.mp3 を置けば自動でループ再生 ----
let fileBgm = null; // 再生中 {key, el}
const bgmTried = {}; // key -> "ok" | "missing"（無いファイルの再試行を減らす）
let gestureDone = false; // 自動再生解禁（初回タップ後）

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.32;
  master.connect(ctx.destination);
  return ctx;
}

// 初回ジェスチャで解錠＋環境音開始
export function onFirstGesture() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  gestureDone = true;
  startAmbient();
  if (fileBgm && fileBgm.el && !muted) fileBgm.el.play().catch(() => {}); // 保留していたファイルBGMを再生
}

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.value = muted ? 0 : 0.32;
  if (fileBgm && fileBgm.el) { if (muted) fileBgm.el.pause(); else if (gestureDone) fileBgm.el.play().catch(() => {}); }
}

function stopFileBgm() { if (fileBgm && fileBgm.el) { try { fileBgm.el.pause(); } catch (e) {} } fileBgm = null; }
function stopProcedural() { if (music.timer) { clearTimeout(music.timer); music.timer = null; } }

// mood → bgm_<mood>.mp3 → bgm_main.mp3 の順に探す。見つかれば手続き音楽を止めてループ再生。無ければ onMissing()。
function startFileBgm(mood, onMissing) {
  const keys = mood ? [mood, "main"] : ["main"];
  const key = keys.find((k) => bgmTried[k] !== "missing");
  if (!key) { stopFileBgm(); if (onMissing) onMissing(); return; }
  if (fileBgm && fileBgm.key === key) { if (gestureDone && !muted) fileBgm.el.play().catch(() => {}); return; } // 同じ曲は継続（シーン跨ぎで途切れない）
  const el = new Audio("audio/bgm_" + key + ".mp3");
  el.loop = true; el.volume = muted ? 0 : 0.5; el.preload = "auto";
  let settled = false;
  el.addEventListener("canplaythrough", () => {
    if (settled) return; settled = true; bgmTried[key] = "ok";
    stopFileBgm(); stopProcedural(); fileBgm = { key, el };
    if (gestureDone && !muted) el.play().catch(() => {});
  }, { once: true });
  el.addEventListener("error", () => {
    if (settled) return; settled = true; bgmTried[key] = "missing";
    startFileBgm(mood, onMissing); // 次の候補（main）へ、無ければ手続き音楽
  }, { once: true });
  el.load();
}
export function isMuted() {
  return muted;
}

// ---- 基本波形 ----
function tone({ freq, dur = 0.12, type = "sine", vol = 0.3, glideTo = null, delay = 0, attack = 0.005, release = 0.08 }) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + release + 0.02);
}

function noise({ dur = 0.08, vol = 0.2, delay = 0, hp = 800 }) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "highpass";
  filt.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(filt);
  filt.connect(g);
  g.connect(master);
  src.start(t0);
}

function chord(freqs, { dur = 1.2, type = "sine", vol = 0.12, spread = 0.02 } = {}) {
  freqs.forEach((f, i) => tone({ freq: f, dur, type, vol, delay: i * spread }));
}

// ---- ほのかな環境音（ゆっくり揺れる低いパッド）----
function startAmbient() {
  if (ambient || !ctx) return;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  g.connect(master);
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  oscA.type = "sine";
  oscB.type = "sine";
  oscA.frequency.value = 110; // A2
  oscB.frequency.value = 110 * 1.5 + 0.4; // 5度＋わずかなうねり
  // ゆっくりした音量のうねり（呼吸のように）
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.08;
  lfoG.gain.value = 0.025;
  lfo.connect(lfoG);
  lfoG.connect(g.gain);
  oscA.connect(g);
  oscB.connect(g);
  oscA.start();
  oscB.start();
  lfo.start();
  ambient = { g, oscA, oscB, lfo };
}

// ---- 生成的BGM（夜のピアノ）----
//  スケールからまばらに一音ずつ爪弾く。ループ素材が無くても"曲"に聞こえる密度が狙い。
//  mood: "title"/"home"＝安らぎ（Aマイナー・ペンタ） / "journey"＝少し陰る（Gマイナー寄り）
const MUSIC_SCALES = {
  title: [220, 261.6, 293.7, 329.6, 392, 440, 523.3],
  home: [220, 261.6, 293.7, 329.6, 392, 440],
  journey: [196, 233.1, 261.6, 311.1, 349.2, 392],
};
let music = { mood: null, timer: null, lastFreq: 0 };

// ピアノ風の一音：基音＋倍音2つ、速いアタック・長い減衰・ローパスで柔らかく
function pluck(freq, vol = 0.1, dur = 2.4) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  lp.connect(g);
  g.connect(master);
  [
    [1, 1],
    [2, 0.4],
    [3, 0.14],
  ].forEach(([m, a]) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * m + (m > 1 ? Math.random() * 1.4 : 0); // 倍音をわずかに揺らす＝生っぽさ
    const og = c.createGain();
    og.gain.value = a;
    o.connect(og);
    og.connect(lp);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  });
}

function playMusicNote() {
  if (!ctx || ctx.state !== "running" || muted) return;
  const scale = MUSIC_SCALES[music.mood] || MUSIC_SCALES.home;
  let f = scale[Math.floor(Math.random() * scale.length)];
  if (f === music.lastFreq) f = scale[(scale.indexOf(f) + 1) % scale.length]; // 同音連打を避ける
  music.lastFreq = f;
  pluck(f, 0.085 + Math.random() * 0.03);
  if (Math.random() < 0.22) pluck(f * 2, 0.045, 1.8); // ときどき1オクターブ上が淡く重なる
}

function scheduleNextNote() {
  if (!music.mood) return;
  const wait = music.mood === "journey" ? 1800 + Math.random() * 2600 : 2600 + Math.random() * 3600;
  music.timer = setTimeout(() => {
    playMusicNote();
    scheduleNextNote();
  }, wait);
}

// シーンから呼ぶ：気分を切り替える（"off" で停止）。ミュートは master 側で一括制御。
export function setMusicMood(mood) {
  stopProcedural();
  music.mood = mood && mood !== "off" ? mood : null;
  if (!music.mood) { stopFileBgm(); return; }
  // ドローンの土台も気分に合わせて滑らかに移調（旅は少し低く・陰る）
  if (ambient && ctx) {
    const base = music.mood === "journey" ? 98 : 110; // G2 / A2
    const t = ctx.currentTime;
    ambient.oscA.frequency.exponentialRampToValueAtTime(base, t + 2.5);
    ambient.oscB.frequency.exponentialRampToValueAtTime(base * 1.5 + 0.4, t + 2.5);
  }
  // まず本物の曲ファイルを試す。あればループ再生（手続き音楽は止まる）。無ければ従来の合成音。
  startFileBgm(music.mood, () => scheduleNextNote());
}

// ---- 名前付きSE（このゲームの出来事に対応）----
export const sfx = {
  tap: () => tone({ freq: 520, dur: 0.04, type: "sine", vol: 0.07 }),
  hit: () => {
    const c = ensure();
    if (!c) return;
    // 高速倍速で打撃が密集しても、実時間130ms未満の連打は鳴らさない（一定テンポ化を防ぐ）
    if (c.currentTime - lastHit < 0.13) return;
    lastHit = c.currentTime;
    noise({ dur: 0.05, vol: 0.16, hp: 800 + Math.random() * 300 });
    tone({ freq: 170 + Math.random() * 90, dur: 0.05, type: "square", vol: 0.1 }); // 音程をばらす
  },
  heroHit: () => noise({ dur: 0.05, vol: 0.1, hp: 400 + Math.random() * 220 }),
  defeat: () => tone({ freq: 320, glideTo: 120, dur: 0.18, type: "sawtooth", vol: 0.16 }),
  coin: () => {
    tone({ freq: 880, dur: 0.05, type: "triangle", vol: 0.1 });
    tone({ freq: 1320, dur: 0.07, type: "triangle", vol: 0.09, delay: 0.05 });
  },
  // 感情の欠片（感情ごとに音程を変える：怒/悲/勇/希）
  frag: (i = 0) => tone({ freq: [392, 330, 523, 587][i % 4], dur: 0.13, type: "sine", vol: 0.13 }),
  evolve: () => [392, 494, 587, 784].forEach((f, i) => tone({ freq: f, dur: 0.2, type: "triangle", vol: 0.17, delay: i * 0.12 })),
  skill: () => {
    tone({ freq: 300, glideTo: 900, dur: 0.16, type: "sawtooth", vol: 0.16 });
    tone({ freq: 600, dur: 0.1, type: "square", vol: 0.1, delay: 0.12 });
  },
  care: () => tone({ freq: 660, glideTo: 990, dur: 0.2, type: "sine", vol: 0.13 }),
  bossWarn: () => tone({ freq: 90, glideTo: 55, dur: 0.6, type: "sawtooth", vol: 0.2 }),
  bossDown: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, type: "square", vol: 0.15, delay: i * 0.09 })),
  death: () => tone({ freq: 330, glideTo: 70, dur: 0.95, type: "sine", vol: 0.2 }),
  revive: () => [659, 880, 1175].forEach((f, i) => tone({ freq: f, dur: 0.22, type: "triangle", vol: 0.15, delay: i * 0.08 })),
  ending: () => chord([262, 330, 392, 523], { dur: 2.0, type: "sine", vol: 0.11 }), // 色が戻る暖かい和音
};
