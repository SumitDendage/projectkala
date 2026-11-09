-- Database for India's Hidden Gems: accounts, visitors and what they look at and ask.
-- Everything lives in a private schema "hg" that the Supabase Data API does not expose;
-- only the Node.js + Express backend (server/) reads and writes it.
-- Safe to run more than once.

create schema if not exists hg;

-- ---------- Accounts ----------
create table if not exists hg.users (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 100),
  email               text not null unique check (char_length(email) between 3 and 200 and email = lower(email)),
  password_hash       text not null,
  email_verified_at   timestamptz,
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz,
  password_changed_at timestamptz
);

-- Signed-in browsers. Only a SHA-256 of the cookie token is stored.
create table if not exists hg.sessions (
  token_hash  text primary key,
  user_id     uuid not null references hg.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  user_agent  text
);
create index if not exists sessions_user_idx on hg.sessions (user_id);

-- One-time links sent by email: password reset and email confirmation (SHA-256 only).
create table if not exists hg.tokens (
  token_hash  text primary key,
  user_id     uuid not null references hg.users(id) on delete cascade,
  purpose     text not null check (purpose in ('reset', 'verify')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists tokens_user_idx on hg.tokens (user_id, purpose);
-- Each link also comes with a 6-digit code (OTP) to type in instead. Only a SHA-256 of
-- "<user id>:<code>" is kept; after 5 wrong tries the code stops working.
alter table hg.tokens add column if not exists code_hash text;
alter table hg.tokens add column if not exists attempts integer not null default 0;

-- Sign-in and reset attempts, for rate limiting (keys are hashed, never raw IPs).
create table if not exists hg.auth_attempts (
  id          bigint generated always as identity primary key,
  key         text not null,
  created_at  timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on hg.auth_attempts (key, created_at desc);

-- ---------- Visitors ----------
-- One row per browser (an anonymous id in a cookie). Linked to an account once they sign in.
create table if not exists hg.visitors (
  id          uuid primary key,
  user_id     uuid references hg.users(id) on delete set null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  visit_count integer not null default 0,
  country     text,
  region      text,
  city        text,
  device      text,
  browser     text,
  os          text
);
create index if not exists visitors_last_seen_idx on hg.visitors (last_seen desc);
create index if not exists visitors_user_idx on hg.visitors (user_id);

-- Each page visit: when, from where (country and city only), device and browser.
create table if not exists hg.visits (
  id          bigint generated always as identity primary key,
  visitor_id  uuid not null references hg.visitors(id) on delete cascade,
  user_id     uuid references hg.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  path        text,
  referrer    text,
  country     text,
  region      text,
  city        text,
  device      text,
  browser     text,
  os          text,
  language    text,
  timezone    text
);
create index if not exists visits_visitor_idx on hg.visits (visitor_id, created_at desc);
create index if not exists visits_created_idx on hg.visits (created_at desc);

-- ---------- What visitors ask the AI consultant ----------
create table if not exists hg.chats (
  id            uuid primary key default gen_random_uuid(),
  visitor_id    uuid not null references hg.visitors(id) on delete cascade,
  user_id       uuid references hg.users(id) on delete set null,
  title         text not null,
  message_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists chats_visitor_idx on hg.chats (visitor_id, updated_at desc);
create index if not exists chats_user_idx on hg.chats (user_id, updated_at desc);

create table if not exists hg.chat_messages (
  id          bigint generated always as identity primary key,
  chat_id     uuid not null references hg.chats(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  text        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_chat_idx on hg.chat_messages (chat_id, id);
create index if not exists chat_messages_questions_idx on hg.chat_messages (created_at desc) where role = 'user';

-- ---------- Places viewed and saved ----------
create table if not exists hg.place_events (
  id          bigint generated always as identity primary key,
  visitor_id  uuid not null references hg.visitors(id) on delete cascade,
  user_id     uuid references hg.users(id) on delete set null,
  place_slug  text not null,
  action      text not null check (action in ('view', 'save', 'unsave')),
  created_at  timestamptz not null default now()
);
create index if not exists place_events_created_idx on hg.place_events (created_at desc);
create index if not exists place_events_place_idx on hg.place_events (place_slug, action);
create index if not exists place_events_visitor_idx on hg.place_events (visitor_id, created_at desc);

create table if not exists hg.saved_places (
  user_id     uuid not null references hg.users(id) on delete cascade,
  place_slug  text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, place_slug)
);

-- ---------- Trip enquiries ----------
create table if not exists hg.enquiries (
  id          uuid primary key default gen_random_uuid(),
  visitor_id  uuid references hg.visitors(id) on delete set null,
  user_id     uuid references hg.users(id) on delete set null,
  name        text not null,
  email       text not null,
  dates       text,
  travellers  integer check (travellers between 1 and 50),
  place       text,
  message     text not null,
  status      text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at  timestamptz not null default now()
);
create index if not exists enquiries_created_idx on hg.enquiries (created_at desc);

-- ---------- Gem Finder: the four-question match (answers and the places it suggested) ----------
create table if not exists hg.finder_runs (
  id          bigint generated always as identity primary key,
  visitor_id  uuid not null references hg.visitors(id) on delete cascade,
  user_id     uuid references hg.users(id) on delete set null,
  month       smallint check (month between 1 and 12),
  landscape   text check (landscape in ('mountains', 'water', 'forest', 'desert', 'heritage')),
  effort      smallint check (effort between 1 and 3),
  budget      smallint check (budget between 1 and 3),
  results     text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists finder_runs_created_idx on hg.finder_runs (created_at desc);
create index if not exists finder_runs_visitor_idx on hg.finder_runs (visitor_id, created_at desc);

-- ---------- Traveller gems: hidden places shared by visitors, shown once an admin approves them ----------
create table if not exists hg.gems (
  id           uuid primary key default gen_random_uuid(),
  visitor_id   uuid references hg.visitors(id) on delete set null,
  user_id      uuid references hg.users(id) on delete set null,
  place        text not null check (char_length(place) between 2 and 80),
  state        text not null check (char_length(state) between 2 and 60),
  story        text not null check (char_length(story) between 20 and 700),
  best_months  text check (char_length(best_months) <= 60),
  author       text check (char_length(author) <= 40),
  email        text check (char_length(email) <= 200),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  votes        integer not null default 0,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists gems_status_idx on hg.gems (status, created_at desc);

-- "Want to go" marks: one per browser per gem.
create table if not exists hg.gem_votes (
  gem_id      uuid not null references hg.gems(id) on delete cascade,
  visitor_id  uuid not null references hg.visitors(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (gem_id, visitor_id)
);

-- ---------- Season reminders: one email when a place's best months begin ----------
-- Confirmed by email first (only a SHA-256 of the confirmation token is kept). stop_token is the
-- random value in every email's "stop" link; it can only switch that one reminder off.
create table if not exists hg.season_alerts (
  id                uuid primary key default gen_random_uuid(),
  email             text not null check (char_length(email) between 3 and 200 and email = lower(email)),
  place_slug        text not null,
  visitor_id        uuid references hg.visitors(id) on delete set null,
  user_id           uuid references hg.users(id) on delete set null,
  confirm_hash      text unique,
  confirm_sent_at   timestamptz,
  confirmed_at      timestamptz,
  stop_token        text not null unique,
  stopped_at        timestamptz,
  last_sent_month   text,
  last_sent_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (email, place_slug)
);
create index if not exists season_alerts_place_idx on hg.season_alerts (place_slug) where confirmed_at is not null and stopped_at is null;

-- ---------- The backend's own login (created separately, once) ----------
-- The live backend connects as role "hg_app" through Supabase's transaction pooler
-- (user hg_app.<project-ref>, port 6543). It can use only the tables in this schema:
--   create role hg_app login connection limit 30 password '<a long random password>';
--   alter role hg_app set search_path = hg, public;
--   alter role hg_app set statement_timeout = '8s';
--   grant usage on schema hg to hg_app;
--   grant select, insert, update, delete on all tables in schema hg to hg_app;
--   grant usage, select on all sequences in schema hg to hg_app;
--   and, on every table: create policy hg_app_all on hg.<table> for all to hg_app using (true) with check (true);
-- Its password lives only in the DATABASE_URL setting on the host (Hostinger).

-- ---------- Lock it down ----------
-- Row level security with no policies: even if this schema were ever exposed through the
-- Supabase Data API, the public keys could read nothing. The backend connects as the
-- table owner, which is not affected.
do $$
declare t text;
begin
  foreach t in array array['users','sessions','tokens','auth_attempts','visitors','visits','chats','chat_messages','place_events','saved_places','enquiries','finder_runs','gems','gem_votes','season_alerts'] loop
    execute format('alter table hg.%I enable row level security', t);
    -- The backend's login (hg_app, see above) may use every table, including ones added later.
    if exists (select 1 from pg_roles where rolname = 'hg_app') then
      execute format('grant select, insert, update, delete on hg.%I to hg_app', t);
      if not exists (select 1 from pg_policies where schemaname = 'hg' and tablename = t and policyname = 'hg_app_all') then
        execute format('create policy hg_app_all on hg.%I for all to hg_app using (true) with check (true)', t);
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'hg_app') then
    execute 'grant usage, select on all sequences in schema hg to hg_app';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema hg from anon, authenticated';
    execute 'revoke all on all tables in schema hg from anon, authenticated';
  end if;
  execute 'revoke all on schema hg from public';
end $$;
