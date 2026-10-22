-- Flock schema — run in the Supabase SQL editor
create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ───────────── Communities and members ─────────────
create table communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- e.g. 'The Hack Collective', 'UCL'
  allowed_email_domains text[] not null default '{}', -- e.g. {'ucl.ac.uk','kcl.ac.uk'}
  luma_calendar_id text,                       -- for .ics import
  discord_guild_id text,
  notion_rules_page_id text,
  created_at timestamptz default now()
);

create table members (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  uni_domain text,                             -- e.g. 'ucl.ac.uk'
  github_handle text,
  discord_user_id text,
  handle_hash text,                            -- sha256(lower(email)) for blocklist
  trust_score int not null default 0,
  trust_reasons text[] not null default '{}',
  emergency_contact text,
  created_at timestamptz default now()
);

create table community_members (
  community_id uuid references communities(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  role text not null default 'member' check (role in ('member','lead')),
  primary key (community_id, member_id)
);

-- ───────────── Study sessions ─────────────
create table study_sessions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references communities(id) on delete cascade,
  title text not null,
  location_name text,                          -- e.g. 'UCL Main Library'
  location geography(point, 4326),
  starts_at timestamptz,
  ends_at timestamptz not null,
  source text not null default 'student' check (source in ('student','luma')),
  luma_event_id text unique,
  discord_thread_id text,
  created_by uuid references members(id),
  created_at timestamptz default now()
);

create table session_members (
  session_id uuid references study_sessions(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (session_id, member_id)
);

-- ───────────── Stations (seeded from OSM Overpass) ─────────────
create table stations (
  id bigint primary key,                       -- OSM node id
  name text not null,
  location geography(point, 4326) not null
);
create index stations_location_idx on stations using gist (location);

-- ───────────── Walking ─────────────
create table walk_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  session_id uuid not null references study_sessions(id) on delete cascade,
  station_id bigint not null references stations(id),
  destination geography(point, 4326) not null,
  leave_at timestamptz not null,
  status text not null default 'open' check (status in ('open','matched','done','cancelled')),
  created_at timestamptz default now()
);
create index walk_requests_dest_idx on walk_requests using gist (destination);

create table matches (
  id uuid primary key default gen_random_uuid(),
  request_a uuid not null references walk_requests(id),
  request_b uuid not null references walk_requests(id),
  meeting_point text,
  reason text,                                 -- trust reasons + Cognee
  seconds_to_match int,                        -- for the 10x metric
  status text not null default 'active' check (status in ('active','home_safe','missed_checkin','help')),
  created_at timestamptz default now()
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  solo_trip_id uuid,
  member_id uuid not null references members(id),
  status text not null check (status in ('home_safe','need_help')),
  at timestamptz default now()
);

-- Solo check-in timer (no buddy found)
create table solo_trips (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  session_id uuid references study_sessions(id),
  station_id bigint references stations(id),
  leave_at timestamptz not null default now(),
  eta_at timestamptz not null,
  status text not null default 'active' check (status in ('active','home_safe','overdue','help')),
  alerted_at timestamptz,
  created_at timestamptz default now()
);

-- ───────────── Safety: reports, incidents, blocklist ─────────────
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references members(id),
  reported_member_id uuid references members(id),
  community_id uuid references communities(id),
  kind text not null check (kind in ('behaviour','scam','place')),
  evidence text,
  grok_recommendation text,                    -- Grok Bot's suggestion; a human decides
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  notion_page_id text,
  created_at timestamptz default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('missed_checkin','help','report')),
  match_id uuid references matches(id),
  solo_trip_id uuid references solo_trips(id),
  report_id uuid references reports(id),
  community_id uuid references communities(id),
  notion_page_id text,
  resolved boolean not null default false,
  created_at timestamptz default now()
);

create table blocklist (
  handle_hash text primary key,                -- sha256, never raw
  reason text,
  confirmed_by uuid references communities(id),
  created_at timestamptz default now()
);

-- ───────────── Matching ─────────────
-- Same session, destinations within 1.5 km, leaving within 20 minutes, not blocked.
create or replace function find_buddies(req_id uuid)
returns table (
  candidate_request uuid,
  member_id uuid,
  first_name text,
  station_name text,
  trust_score int,
  trust_reasons text[],
  dest_distance_m double precision,
  minutes_apart double precision
)
language sql stable security definer set search_path = public as $$
  select r2.id, m.id, m.first_name, st.name, m.trust_score, m.trust_reasons,
         st_distance(r1.destination, r2.destination),
         abs(extract(epoch from (r1.leave_at - r2.leave_at))) / 60.0
  from walk_requests r1
  join walk_requests r2
    on r2.session_id = r1.session_id
   and r2.id <> r1.id
   and r2.status = 'open'
  join members m on m.id = r2.member_id
  join stations st on st.id = r2.station_id
  where r1.id = req_id
    and r1.member_id = auth.uid()
    and r2.member_id <> r1.member_id
    and st_dwithin(r1.destination, r2.destination, 1500)
    and abs(extract(epoch from (r1.leave_at - r2.leave_at))) <= 20 * 60
    and m.trust_score > 0
    and not exists (select 1 from blocklist b where b.handle_hash = m.handle_hash)
  order by m.trust_score desc, 7, 8
  limit 5;
$$;

-- Overdue solo trips (polled by the Discord bot)
create or replace view overdue_solo_trips as
  select * from solo_trips
  where status = 'active' and eta_at < now() and alerted_at is null;

-- ───────────── Row-level security ─────────────
alter table communities enable row level security;
create policy "members read their communities" on communities for select
  using (exists (select 1 from community_members cm where cm.community_id = id and cm.member_id = auth.uid()));

alter table members enable row level security;
create policy "read own profile" on members for select using (id = auth.uid());
create policy "insert own profile" on members for insert with check (id = auth.uid());
create policy "update own profile" on members for update using (id = auth.uid());

alter table community_members enable row level security;
create policy "read own memberships" on community_members for select using (member_id = auth.uid());

alter table study_sessions enable row level security;
create policy "community members read sessions" on study_sessions for select
  using (exists (select 1 from community_members cm where cm.community_id = study_sessions.community_id and cm.member_id = auth.uid()));
create policy "community members create sessions" on study_sessions for insert
  with check (created_by = auth.uid() and exists (select 1 from community_members cm where cm.community_id = study_sessions.community_id and cm.member_id = auth.uid()));

alter table session_members enable row level security;
create policy "join sessions" on session_members for insert with check (member_id = auth.uid());
create policy "read own session memberships" on session_members for select using (member_id = auth.uid());

alter table stations enable row level security;
create policy "stations are public" on stations for select using (true);

alter table walk_requests enable row level security;
create policy "own walk requests" on walk_requests for all
  using (member_id = auth.uid()) with check (member_id = auth.uid());

alter table matches enable row level security;
create policy "participants read matches" on matches for select
  using (exists (select 1 from walk_requests w where w.id in (request_a, request_b) and w.member_id = auth.uid()));

alter table checkins enable row level security;
create policy "own checkins" on checkins for all using (member_id = auth.uid()) with check (member_id = auth.uid());

alter table solo_trips enable row level security;
create policy "own solo trips" on solo_trips for all using (member_id = auth.uid()) with check (member_id = auth.uid());

alter table reports enable row level security;
create policy "members file reports" on reports for insert with check (reporter_id = auth.uid());
create policy "reporters read own reports" on reports for select using (reporter_id = auth.uid());

alter table incidents enable row level security;   -- service role only (dashboard uses route handlers)
alter table blocklist enable row level security;   -- service role only; read via find_buddies

-- Realtime: live matches
alter publication supabase_realtime add table walk_requests;
alter publication supabase_realtime add table matches;
