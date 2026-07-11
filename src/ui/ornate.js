// =====================================================================
//  ornate.js ── 金の彫刻フレーム（ログウィズ風の額縁）。Home/Game 共用。
//  二重罫＋ベベル（上左=光/下右=陰）＋四隅ブラケットを graphics に直接描く。
// =====================================================================

//  opts: corners=角飾り / thick=外罫の太さ / inset=内罫の食い込み / accent=内罫の色（省略で金）
export function ornateFrame(gfx, x, y, w, h, r = 10, opts = {}) {
  const L = x - w / 2, T = y - h / 2;
  const gold = opts.gold ?? 0xc9a23a; // 金の本体
  const goldHi = opts.goldHi ?? 0xf4dc86; // 光（上・左）
  const goldLo = opts.goldLo ?? 0x7d611a; // 陰（下・右）
  const dark = opts.dark ?? 0x140f08; // 外周の暗い縁（額の立体感）
  const thick = opts.thick ?? 3;
  // 外周の暗リム → 金の本体罫
  gfx.lineStyle(thick + 2, dark, 1);
  gfx.strokeRoundedRect(L - 1, T - 1, w + 2, h + 2, r + 2);
  gfx.lineStyle(thick, gold, 1);
  gfx.strokeRoundedRect(L, T, w, h, r);
  // ベベル：上/左に光、下/右に陰の細線で金属の丸みを出す
  gfx.lineStyle(1, goldHi, 0.9);
  gfx.beginPath(); gfx.moveTo(L + r, T + 1.5); gfx.lineTo(L + w - r, T + 1.5); gfx.strokePath();
  gfx.beginPath(); gfx.moveTo(L + 1.5, T + r); gfx.lineTo(L + 1.5, T + h - r); gfx.strokePath();
  gfx.lineStyle(1, goldLo, 0.9);
  gfx.beginPath(); gfx.moveTo(L + r, T + h - 1.5); gfx.lineTo(L + w - r, T + h - 1.5); gfx.strokePath();
  gfx.beginPath(); gfx.moveTo(L + w - 1.5, T + r); gfx.lineTo(L + w - 1.5, T + h - r); gfx.strokePath();
  // 内側のヘアライン（罫を二重に＝額縁らしさ）。accent があればその色で。
  const p = opts.inset ?? 5;
  gfx.lineStyle(1, opts.accent ?? goldLo, opts.accent ? 0.9 : 0.7);
  gfx.strokeRoundedRect(L + p, T + p, w - 2 * p, h - 2 * p, Math.max(2, r - p));
  // 四隅の角ブラケット（金の鋲）。大きい枠のみ。
  if (opts.corners) {
    const a = opts.cornerArm ?? 12, o = 3;
    gfx.lineStyle(2, goldHi, 1);
    const corner = (cx, cy, dx, dy) => {
      gfx.beginPath(); gfx.moveTo(cx + dx * a, cy); gfx.lineTo(cx, cy); gfx.lineTo(cx, cy + dy * a); gfx.strokePath();
    };
    corner(L + o, T + o, 1, 1); corner(L + w - o, T + o, -1, 1);
    corner(L + o, T + h - o, 1, -1); corner(L + w - o, T + h - o, -1, -1);
  }
}
