// =====================================================================
//  cloud.js  ── クラウドセーブ＆ログイン（Supabase）
//  ・ログイン（メール＋パスワード）
//  ・アカウントに紐づくセーブを保存/読込（別端末でも同じ進行）
//  ・localStorage を実行時の主保存、クラウドを同期層として重ねる
//  未設定（cloudConfig 未入力）なら全機能が no-op ＝従来通りオフライン動作。
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./cloudConfig.js";
import { getSave, adoptCloudSave, setPersistHook } from "./save.js";

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
export async function pullSave() {
  const c = client();
  if (!c) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await c.from("saves").select("data").eq("user_id", user.id).maybeSingle();
  if (error) {
    console.warn("[cloud] pullSave:", error.message);
    return null;
  }
  return data ? data.data : null;
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
  const bonded = Array.isArray(party.bonded) ? party.bonded.length : 0;
  const arts = Array.isArray(s.artifacts) ? s.artifacts.length : 0;
  return (
    (soul.rebirths || 0) * 1000 +
    (soul.level || 0) * 50 +
    (soul.bestDistance || 0) +
    (s.enlightenment || 0) * 30 +
    (s.gold || 0) * 0.5 +
    (bonds.met || 0) * 20 +
    bonded * 40 +
    arts * 15 +
    (s.endingSeen ? 500 : 0)
  );
}

// ログイン直後：進行が多い方を採用（少ない/空の側で上書きしない）。同点なら新しい方。
export async function syncOnLogin() {
  const remote = await pullSave();
  const local = getSave();
  if (!remote) {
    await pushSave(local); // クラウド未作成 → ローカルを初回アップロード
    return { action: "uploaded", localScore: progressScore(local) };
  }
  const rScore = progressScore(remote);
  const lScore = progressScore(local);
  if (rScore > lScore) {
    adoptCloudSave(remote); // クラウドの方が進んでいる → 取り込む
    return { action: "downloaded", remoteScore: rScore, localScore: lScore };
  }
  if (lScore > rScore) {
    await pushSave(local); // ローカルの方が進んでいる → 押し上げる（空が本物を消さない）
    return { action: "uploaded", remoteScore: rScore, localScore: lScore };
  }
  // 同点 → 保存時刻の新しい方
  if ((remote.stamp || 0) > (local.stamp || 0)) {
    adoptCloudSave(remote);
    return { action: "downloaded", tie: true };
  }
  await pushSave(local);
  return { action: "insync" };
}

// 保存のたびにクラウドへ（デバウンス 1.5s・失敗は握りつぶしオフライン継続）
let _pushTimer = null;
export function startCloudAutosync() {
  if (!cloudConfigured()) return;
  setPersistHook(() => {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      pushSave(getSave());
    }, 1500);
  });
}
