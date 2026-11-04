-- =========================================================
--  Letrix - atualização para o CICLO AUTOMÁTICO
--  Use este arquivo se você JÁ tinha rodado o supabase.sql antes.
--  Ele só acrescenta colunas novas: NÃO apaga salas nem jogadores.
--  Cole no SQL Editor do Supabase e clique em RUN.
-- =========================================================

alter table rooms add column if not exists paused       boolean not null default false;
alter table rooms add column if not exists paused_at    timestamptz;
alter table rooms add column if not exists phase_until  timestamptz;
alter table rooms add column if not exists next_step    text not null default '';
alter table rooms add column if not exists turns_max    int  not null default 3;
alter table rooms add column if not exists turns_a      int  not null default 0;
alter table rooms add column if not exists turns_b      int  not null default 0;
alter table rooms add column if not exists target_score int  not null default 5;
alter table rooms add column if not exists round        int  not null default 0;
alter table rooms add column if not exists word_list    text not null default '';
alter table rooms add column if not exists used_words   text not null default '';

-- avisa o Supabase para reconhecer as colunas novas na hora
notify pgrst, 'reload schema';
