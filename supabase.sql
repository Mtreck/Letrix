-- =========================================================
--  Letrix - estrutura do banco (Supabase)
--  Cole tudo no SQL Editor do Supabase e clique em RUN.
--  ATENÇÃO: rodar de novo apaga as salas existentes.
-- =========================================================

create extension if not exists pgcrypto;

drop table if exists guesses, players, rooms cascade;

-- Salas (uma por partida)
create table rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  status     text not null default 'lobby',   -- lobby | talk | spinning | duel | result | end
  word_a     text not null default '',        -- palavra do Time Azul
  word_b     text not null default '',        -- palavra do Time Vermelho
  tried_a    text not null default '',        -- letras já chutadas na palavra A (pelo time B)
  tried_b    text not null default '',        -- letras já chutadas na palavra B (pelo time A)
  score_a    int  not null default 0,
  score_b    int  not null default 0,
  lives_max  int  not null default 5,         -- vidas de cada jogador por rodada
  duel       int  not null default 0,         -- número do duelo atual
  duel_a     uuid,                            -- sorteado do Time Azul
  duel_b     uuid,                            -- sorteado do Time Vermelho
  turn       text not null default 'A',       -- de quem é a vez no duelo
  turn_started_at timestamptz,                -- quando a vez atual começou
  turn_seconds int not null default 15,       -- tempo por jogada (0 = sem limite)
  talk       int  not null default 0,         -- número da discussão atual
  talk_started_at timestamptz,                -- quando a discussão começou
  talk_seconds int not null default 60,       -- tempo de discussão
  message    text not null default '',        -- resultado do duelo / votação
  event      text not null default '',        -- última jogada (aparece em todas as telas)
  event_kind text not null default '',        -- hit | miss | win | out | spin
  event_id   int  not null default 0,
  -- ciclo automático
  paused     boolean not null default false,  -- jogo pausado pelo mediador
  paused_at  timestamptz,                     -- quando pausou (para congelar os cronômetros)
  phase_until timestamptz,                    -- até quando o resultado fica na tela
  next_step  text not null default '',        -- talk | spin | round | end (o que vem depois do resultado)
  turns_max  int  not null default 3,         -- chances (vezes) de cada duelista por duelo
  turns_a    int  not null default 0,         -- vezes já usadas no duelo atual
  turns_b    int  not null default 0,
  target_score int not null default 5,        -- pontos para vencer o jogo
  round      int  not null default 0,         -- número da rodada
  word_list  text not null default '',        -- lista de palavras do mediador (uma por linha)
  used_words text not null default '',        -- palavras já usadas neste jogo
  created_at timestamptz not null default now()
);

-- Jogadores (alunos)
create table players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  name        text not null,
  team        text not null check (team in ('A', 'B')),
  lives       int  not null default 5,
  picked      int  not null default 0,        -- quantas vezes já foi sorteado
  role        text not null default 'cidadao',-- cidadao | espiao | vidente | guardiao | impostor
  shield      boolean not null default false, -- escudo do guardião
  secret      text not null default '',       -- letras secretas do espião
  vision      text not null default '',       -- visões do vidente: "e+x-" (e tem, x não tem)
  vision_talk int  not null default -1,       -- em qual discussão o vidente usou a visão
  vote        uuid,                           -- em quem votou como impostor
  created_at  timestamptz not null default now()
);

-- Jogadas dos duelos (o painel do mediador confere e aplica)
create table guesses (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references rooms(id) on delete cascade,
  player_id  uuid references players(id) on delete cascade,
  duel       int  not null,
  team       text not null,
  kind       text not null check (kind in ('letter', 'word')),
  guess      text not null,
  result     text,                            -- null = aguardando | hit | miss | win | wrong | ignored
  created_at timestamptz not null default now()
);

-- Acesso liberado para a chave pública (jogo de sala de aula, sem login)
alter table rooms   enable row level security;
alter table players enable row level security;
alter table guesses enable row level security;

create policy "acesso livre" on rooms   for all using (true) with check (true);
create policy "acesso livre" on players for all using (true) with check (true);
create policy "acesso livre" on guesses for all using (true) with check (true);

-- Tempo real (as telas atualizam sozinhas)
alter table players replica identity full;
alter publication supabase_realtime add table rooms, players, guesses;
