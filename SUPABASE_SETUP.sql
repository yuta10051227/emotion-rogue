-- =====================================================================
--  ラクリマ クラウドセーブ用テーブル（Supabase の SQL Editor で実行）
--  1ユーザー1行、進行データを JSON(jsonb) で保存。RLS で各自のデータを保護。
-- =====================================================================

create table if not exists public.saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security：各ユーザーは「自分の行」だけ読み書き可能
alter table public.saves enable row level security;

create policy "own save select" on public.saves
  for select using (auth.uid() = user_id);

create policy "own save insert" on public.saves
  for insert with check (auth.uid() = user_id);

create policy "own save update" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
