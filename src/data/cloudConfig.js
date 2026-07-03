// =====================================================================
//  cloudConfig.js  ── Supabase 接続情報（クラウドセーブ／ログイン）
//  ここに Supabase プロジェクトの「URL」と「anon public key」を貼ると、
//  クラウド同期が自動でONになります（未入力のままだと従来通りオフライン動作）。
//
//  取得場所：Supabase → プロジェクト → Settings → API
//    - Project URL           → SUPABASE_URL
//    - Project API keys: anon → SUPABASE_ANON_KEY
//  ※ anon key は「公開してよい鍵」です（RLSでデータは各ユーザーに保護されます）。
//
//  .env を使う場合は VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を優先します。
// =====================================================================

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

// ▼▼▼ ここに Supabase の値を貼る（クオートの中に）▼▼▼
const PASTE_URL = "https://pfxqueqhjxkndkjnzhjj.supabase.co";
const PASTE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmeHF1ZXFoanhrbmRram56aGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMzM4NjAsImV4cCI6MjA5ODYwOTg2MH0.IFhz-FJ4IT2uv7A1jDlDAFwY583gl_dKu0EepRK9do4";
// ▲▲▲ ここまで ▲▲▲

export const SUPABASE_URL = env.VITE_SUPABASE_URL || PASTE_URL;
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || PASTE_ANON_KEY;
