// =====================================================================
//  cloud.js  ── クラウドセーブ＆ログイン（Supabase）
//  ・ログイン（メール＋パスワード）
//  ・アカウントに紐づくセーブを保存/読込（別端末でも同じ進行）
//  ・localStorage を実行時の主保存、クラウドを同期層として重ねる
//  未設定（cloudConfig 未入力）なら全機能が no-op ＝従来通りオフライン動作。
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./cloudConfig.js";
import { getSave, adoptCloudSave, setPersistHook, resetSave, mergeCloudSaves } from "./save.js";

let _client = null;

export function cloudConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function client() {
  if (!cloudConfigured()) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return _client;
}

// ---------------------------- 認証 ----------------------------
export async function getUser() {
  const c = client();
  if (!c) return null;
  try {
    const { data } = await c.auth.getUser();
    return data ? data.user : null;
  } catch (e) {
    return null;
  }
}

export async function signUp(email, password) {
  const c = client();
  if (!c) return { ok: false, reason: "クラウド未設定" };
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) return { ok: false, reason: error.message };
  // メール確認が有効な場合、session は null（確認待ち）
  return { ok: true, session: data.session, needConfirm: !data.session };
}

export async function signIn(email, password) {
  const c = client();
  if (!c) return { ok: false, reason: "クラウド未設定" };
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, session: data.session };
}

export async function signOut() {
  const c = client();
  if (!c) return;
  try {
    await c.auth.signOut();
  } catch (e) {
    /* ignore */
  }
}

// ---------------------------- セーブ同期 ----------------------------
//  「行が無い（初回）」と「通信エラー」を区別して返す。
//  エラーを null（＝クラウド未作成）と混同すると、通信断のログイン時に
//  空ローカルで本物のクラウドを上書きしてしまうため。
export async function pullSave() {
  const c = client();
  if (!c) return { ok: false };
  const user = await getUser();
  if (!user) return { ok: false };
  try {
    const { data, error } = await c.from("saves").select("data").eq("user_id", user.id).maybeSingle();
    if (error) {
      console.warn("[cloud] pullSave:", error.message);
      return { ok: false };
    }
    return { ok: true, data: data ? data.data : null };
  } catch (e) {
    console.warn("[cloud] pullSave:", e);
    return { ok: false };
  }
}

export async function pushSave(obj) {
  const c = client();
  if (!c) return { ok: false };
  const user = await getUser();
  if (!user) return { ok: false };
  const { error } = await c.from("saves").upsert(
    { user_id: user.id, data: obj, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) {
    console.warn("[cloud] pushSave:", error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

// 進行度スコア（永続・増える一方の値だけで測る）。
//  空の端末が“最新”を装って本物のクラウドを上書きするのを防ぐ核心。
export function progressScore(s) {
  if (!s || typeof s !== "object") return -1;
  const soul = s.soul || {};
  const bonds = s.bonds || {};
  const party = s.party || {};
  const lifetime = s.lifetime || {};
  const arts = Array.isArray(s.artifacts) ? s.artifacts.length : 0;
  // ツリー総レベル＝「まなび」の永続投資（転生でも減らない）。使ったまなびを進行度として数える。
  let treeLv = 0;
  if (s.tree && typeof s.tree === "object") {
    for (const k in s.tree) {
      const br = s.tree[k];
      if (br && typeof br === "object") for (const id in br) treeLv += br[id] || 0;
    }
  }
  // 残高ではなく「累計獲得」を使う＝強化で残高が減っても進行度は下がらない（空/古い端末が本物を上書きするのを防ぐ核心）。
  const lifeEnl = Math.max(lifetime.enlightenment || 0, s.enlightenment || 0);
  const lifeGold = Math.max(lifetime.gold || 0, s.gold || 0);
  // 仲間への投資（個体強化レベル）も進行度に数える。
  //  ゴールドは使うと残高が減るため、これが無いと「仲間を育てた端末」が
  //  「貯金しただけの端末」にスコアで負けて同期消失する。
  let compLv = 0;
  if (Array.isArray(party.bonded)) {
    for (const b of party.bonded) compLv += Math.max(0, ((b && b.level) || 1) - 1);
  }
  const score =
    (soul.rebirths || 0) * 1000 +
    (soul.level || 0) * 50 +
    (soul.bestDistance || 0) +
    lifeEnl * 30 +
    lifeGold * 0.5 +
    treeLv * 60 +
    compLv * 40 +
    (party.paidSlots || 0) * 80 +
    (bonds.met || 0) * 20 +
    arts * 15 +
    (s.endingSeen ? 500 : 0);
  // NaN が混じると全比較が false になり時刻タイブレークへ落ちる（空端末が勝ち得る）。
  return Number.isFinite(score) ? score : -1;
}

// ログイン直後：進行が多い方を採用（少ない/空の側で上書きしない）。同点なら新しい方。
//  通信エラー時は何もせず未和解のまま返す（誤って空ローカルを初回アップロードしない）。
export async function syncOnLogin() {
  const pulled = await pullSave();
  if (!pulled.ok) return { action: "error" }; // 取得失敗 → 和解しない・上書きしない
  const remote = pulled.data;
  const local = getSave();
  try {
    if (!remote) {
      await pushSave(local); // クラウド未作成 → ローカルを初回アップロード
      return { action: "uploaded", localScore: progressScore(local) };
    }
    const rScore = progressScore(remote);
    const lScore = progressScore(local);
    // 丸ごと置換ではなくフィールド単位マージ：勝者を土台に、敗者にしか無い
    // 永続進行（魂/ツリー/累計/図鑑/特別な仲間 等）も取り込む＝どちらの端末の進行も消えない。
    if (rScore > lScore) {
      const merged = mergeCloudSaves(remote, local);
      adoptCloudSave(merged);
      await pushSave(merged);
      return { action: "downloaded", remoteScore: rScore, localScore: lScore, merged: true };
    }
    if (lScore > rScore) {
      const merged = mergeCloudSaves(local, remote);
      adoptCloudSave(merged);
      await pushSave(merged); // ローカル優位でも敗者(クラウド)の固有進行は拾って押し上げる
      return { action: "uploaded", remoteScore: rScore, localScore: lScore, merged: true };
    }
    // 同点 → 保存時刻の新しい方を土台にマージ
    const baseRemote = (remote.stamp || 0) > (local.stamp || 0);
    const merged = mergeCloudSaves(baseRemote ? remote : local, baseRemote ? local : remote);
    adoptCloudSave(merged);
    await pushSave(merged);
    return { action: baseRemote ? "downloaded" : "insync", tie: true, merged: true };
  } finally {
    _reconciled = true; // 以後の autosync は「和解済みのセーブ」だけを押し上げる
  }
}

// 保存のたびにクラウドへ（デバウンス 1.5s・失敗は握りつぶしオフライン継続）
let _pushTimer = null;
let _reconciled = false; // syncOnLogin が終わるまで false ＝未和解のローカルでクラウドを上書きしない
export function startCloudAutosync() {
  if (!cloudConfigured()) return;
  setPersistHook(() => {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      _pushTimer = null;
      if (!_reconciled) return; // ログイン同期が未完なら押し上げない（空端末クラウド上書き防止）
      pushSave(getSave());
    }, 1500);
  });
}

// 自動同期を止める（ログアウト時）。保留中の押し上げも破棄し、和解フラグも下ろす。
export function stopCloudAutosync() {
  if (_pushTimer) {
    clearTimeout(_pushTimer);
    _pushTimer = null;
  }
  _reconciled = false;
  setPersistHook(null);
}

// 本来のログアウト：①最終セーブをクラウドへ確実に退避 → ②サインアウト → ③この端末を初期化。
//  クラウドへ上げられた時だけ端末を消す＝データ消失させない。上げられなければ中断（ログアウトしない）。
export async function logoutAndWipe() {
  const user = await getUser();
  if (!user) return { ok: false, reason: "not-signed-in" };
  // 未和解（ログイン直後で syncOnLogin 未完了など）のまま押し上げると、
  // 空のローカルで本物のクラウドを上書き→端末初期化＝全消失になる。必ず先に和解する。
  if (!_reconciled) {
    const r = await syncOnLogin();
    if (r.action === "error") return { ok: false, reason: "offline" };
  }
  let pushed = false;
  try {
    const r = await pushSave(getSave()); // 未同期分を最後にもう一度確実にアップ
    pushed = !!(r && r.ok);
  } catch (e) {
    pushed = false;
  }
  if (!pushed) return { ok: false, reason: "offline" }; // 退避できない → 消失防止のため中断
  stopCloudAutosync();
  await signOut();
  resetSave(); // クラウドに安全に退避できたので、この端末は「ログアウト＝まっさら」に
  return { ok: true };
}
