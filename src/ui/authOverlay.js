// =====================================================================
//  authOverlay.js  ── ログイン画面（HTMLをキャンバス上に重ねる）
//  Phaser のキャンバスでは文字入力が扱いにくいので、DOM のフォームを重ねる。
//  メール＋パスワードで ログイン／新規登録 → クラウド同期。
// =====================================================================

import { signIn, signUp, signOut, syncOnLogin, startCloudAutosync, cloudConfigured, getUser } from "../data/cloud.js";

const FONT = '"Hiragino Sans","Helvetica Neue",Arial,sans-serif';

function el(tag, style, props) {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (props) Object.assign(e, props);
  return e;
}

// onDone(result) : result = {signedIn:true, action} または {signedIn:false}
export function openAuthOverlay(onDone) {
  const done = (r) => {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    if (onDone) onDone(r || { signedIn: false });
  };

  const wrap = el(
    "div",
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(6,6,13,0.86);backdrop-filter:blur(2px);",
  );
  const card = el(
    "div",
    "width:min(360px,86vw);background:#14141f;border:1px solid #33334a;border-radius:14px;" +
      "padding:22px 20px;box-shadow:0 12px 40px rgba(0,0,0,0.5);font-family:" +
      FONT +
      ";color:#e8e8ef;",
  );
  wrap.appendChild(card);

  card.appendChild(el("div", "font-size:15px;text-align:center;margin-bottom:2px;color:#cfc6ba;", { textContent: "💧 ラクリマ" }));
  card.appendChild(el("div", "font-size:18px;text-align:center;font-weight:600;margin-bottom:14px;", { textContent: "アカウント" }));
  card.appendChild(
    el("div", "font-size:12px;color:#9a9aac;text-align:center;line-height:1.6;margin-bottom:14px;", {
      textContent: "ログインすると、別の端末でも同じ進行で遊べます。",
    }),
  );

  const inputStyle =
    "width:100%;box-sizing:border-box;margin:6px 0;padding:11px 12px;font-size:15px;border-radius:9px;" +
    "border:1px solid #3a3a52;background:#0e0e16;color:#eef0f6;outline:none;";
  const email = el("input", inputStyle, { type: "email", placeholder: "メールアドレス", autocomplete: "email" });
  const pass = el("input", inputStyle, { type: "password", placeholder: "パスワード（6文字以上）", autocomplete: "current-password" });
  card.appendChild(email);
  card.appendChild(pass);

  const status = el("div", "min-height:18px;font-size:12px;text-align:center;margin:8px 0 4px;color:#ffb3b3;");
  card.appendChild(status);

  const btnBase =
    "width:100%;box-sizing:border-box;margin:6px 0;padding:12px;font-size:15px;font-weight:600;border-radius:10px;" +
    "border:1px solid;cursor:pointer;font-family:" + FONT + ";";
  const loginBtn = el("button", btnBase + "background:#1c2c3a;border-color:#5a7aa0;color:#bfe0ff;", { textContent: "ログイン" });
  const signupBtn = el("button", btnBase + "background:#2a2438;border-color:#a06ac0;color:#e6c2ff;", { textContent: "新規登録" });
  const closeBtn = el(
    "button",
    "width:100%;box-sizing:border-box;margin-top:10px;padding:9px;font-size:13px;border-radius:9px;" +
      "border:1px solid #33334a;background:transparent;color:#8a8aa0;cursor:pointer;font-family:" + FONT + ";",
    { textContent: "あとで（オフラインで遊ぶ）" },
  );
  card.appendChild(loginBtn);
  card.appendChild(signupBtn);
  card.appendChild(closeBtn);

  if (!cloudConfigured()) {
    status.style.color = "#ffd9a0";
    status.textContent = "⚠ クラウド未設定（セットアップ待ち）";
    loginBtn.disabled = true;
    signupBtn.disabled = true;
    loginBtn.style.opacity = signupBtn.style.opacity = "0.45";
  }

  const busy = (on, label) => {
    loginBtn.disabled = signupBtn.disabled = on;
    status.style.color = "#9ad0ff";
    if (label) status.textContent = label;
  };
  const fail = (msg) => {
    status.style.color = "#ffb3b3";
    status.textContent = "⚠ " + msg;
    loginBtn.disabled = signupBtn.disabled = false;
  };

  loginBtn.onclick = async () => {
    if (!email.value.trim() || !pass.value) return fail("メールとパスワードを入力してください");
    busy(true, "ログイン中…");
    const r = await signIn(email.value.trim(), pass.value);
    if (!r.ok) return fail(r.reason || "ログインに失敗しました");
    busy(true, "同期中…");
    const s = await syncOnLogin();
    startCloudAutosync(); // 和解後に autosync（未和解の空端末がクラウドを上書きしない）
    done({ signedIn: true, action: s.action });
  };

  signupBtn.onclick = async () => {
    if (!email.value.trim() || !pass.value) return fail("メールとパスワードを入力してください");
    if (pass.value.length < 6) return fail("パスワードは6文字以上にしてください");
    busy(true, "登録中…");
    const r = await signUp(email.value.trim(), pass.value);
    if (!r.ok) return fail(r.reason || "登録に失敗しました");
    if (r.needConfirm) {
      status.style.color = "#9fff9f";
      status.textContent = "✉ 確認メールを送りました。リンクを押してからログインしてください。";
      loginBtn.disabled = signupBtn.disabled = false;
      return;
    }
    busy(true, "同期中…");
    const s = await syncOnLogin();
    startCloudAutosync(); // 和解後に autosync（未和解の空端末がクラウドを上書きしない）
    done({ signedIn: true, action: s.action });
  };

  closeBtn.onclick = () => done({ signedIn: false });
  pass.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") loginBtn.click();
  });

  document.body.appendChild(wrap);
  setTimeout(() => email.focus(), 50);
}

// ログイン中のアカウント情報パネル（メール表示＋ログアウト）
export async function openAccountOverlay(onDone) {
  const user = await getUser();
  if (!user) {
    openAuthOverlay(onDone);
    return;
  }
  const done = (r) => {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    if (onDone) onDone(r || {});
  };
  const wrap = el(
    "div",
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,6,13,0.86);",
  );
  const card = el(
    "div",
    "width:min(340px,84vw);background:#14141f;border:1px solid #33334a;border-radius:14px;padding:22px 20px;" +
      "font-family:" + FONT + ";color:#e8e8ef;text-align:center;",
  );
  wrap.appendChild(card);
  card.appendChild(el("div", "font-size:16px;font-weight:600;margin-bottom:8px;", { textContent: "☁ ログイン中" }));
  card.appendChild(el("div", "font-size:13px;color:#9fff9f;margin-bottom:6px;word-break:break-all;", { textContent: user.email || "(メール不明)" }));
  card.appendChild(
    el("div", "font-size:12px;color:#9a9aac;line-height:1.6;margin-bottom:16px;", {
      textContent: "進行は自動でクラウドに保存され、別端末でも続きから遊べます。",
    }),
  );
  const btnBase =
    "width:100%;box-sizing:border-box;margin:6px 0;padding:11px;font-size:14px;border-radius:10px;border:1px solid;cursor:pointer;font-family:" +
    FONT + ";";
  const outBtn = el("button", btnBase + "background:#2a1a26;border-color:#6a4a5a;color:#e6b3c8;", { textContent: "ログアウト" });
  const closeBtn = el("button", btnBase + "background:transparent;border-color:#33334a;color:#8a8aa0;", { textContent: "閉じる" });
  card.appendChild(outBtn);
  card.appendChild(closeBtn);

  outBtn.onclick = async () => {
    outBtn.disabled = true;
    outBtn.textContent = "ログアウト中…";
    await signOut();
    done({ signedOut: true });
  };
  closeBtn.onclick = () => done({});
  document.body.appendChild(wrap);
}
