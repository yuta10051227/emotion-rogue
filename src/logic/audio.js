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
  startAmbient();
}

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.value = muted ? 0 : 0.32;
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
