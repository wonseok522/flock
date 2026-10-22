-- Flock schema. Run top to bottom on a fresh Supabase project.
-- Clients never write tables directly: every write goes through a
-- security-definer RPC below that checks auth.uid(). Reads are limited by RLS.
-- PostGIS + pgcrypto live in the `extensions` schema on Supabase, so every
-- function sets search_path = public, extensions.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ───────────── Reference data ─────────────
create table universities (
  domain text primary key,                     -- 'ucl.ac.uk'
  name text not null                           -- 'UCL'
);

create table settings (
  key text primary key,
  value text not null
);

-- ───────────── Communities and members ─────────────
create table communities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                   -- 'The Hack Collective'
  allowed_email_domains text[] not null default '{}',
  luma_calendar_id text,
  discord_guild_id text,
  notion_rules_page_id text,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 40),
  uni_domain text not null,
  github_handle text,
  discord_user_id text,
  handle_hash text not null,                   -- sha256(lower(email)), for the blocklist
  trust_score int not null default 0,
  trust_reasons text[] not null default '{}',  -- shown to matches; never the score
  safe_walks int not null default 0,
  verified_at timestamptz,                     -- set by /api/verify
  emergency_contact text,
  created_at timestamptz not null default now()
);
create index members_handle_hash_idx on members (handle_hash);

create table community_members (
  community_id uuid references communities(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  role text not null default 'member' check (role in ('member','lead')),
  joined_at timestamptz not null default now(),
  primary key (community_id, member_id)
);
create index community_members_member_idx on community_members (member_id);

-- ───────────── Study sessions ─────────────
create table study_sessions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  title text not null,
  location_name text,
  location geography(point, 4326),
  starts_at timestamptz,
  ends_at timestamptz not null,
  source text not null default 'student' check (source in ('student','luma')),
  luma_event_id text unique,
  discord_thread_id text,
  reminder_sent_at timestamptz,
  created_by uuid references members(id),
  created_at timestamptz not null default now()
);
create index study_sessions_ends_idx on study_sessions (ends_at);

create table session_members (
  session_id uuid references study_sessions(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  joined_at timestamptz not null default now(),
  remembered_at timestamptz,                   -- worker sent it to Cognee
  primary key (session_id, member_id)
);
create index session_members_member_idx on session_members (member_id);

-- ───────────── Stations (seeded from OSM Overpass) ─────────────
create table stations (
  id bigint primary key,                       -- OSM node id
  name text not null,
  location geography(point, 4326) not null
);
create index stations_location_idx on stations using gist (location);
create index stations_name_idx on stations (lower(name));

-- ───────────── Walking ─────────────
create table walk_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  session_id uuid not null references study_sessions(id) on delete cascade,
  station_id bigint not null references stations(id),
  destination geography(point, 4326) not null, -- = station location, never an address
  leave_at timestamptz not null,
  status text not null default 'open' check (status in ('open','matched','done','cancelled')),
  created_at timestamptz not null default now()
);
create index walk_requests_dest_idx on walk_requests using gist (destination);
create index walk_requests_session_idx on walk_requests (session_id, status);

create table matches (
  id uuid primary key default gen_random_uuid(),
  request_a uuid not null references walk_requests(id),   -- the person who was waiting
  request_b uuid not null references walk_requests(id),   -- the person who chose
  session_id uuid not null references study_sessions(id) on delete cascade,
  meeting_point text,
  reason text,                                 -- Cognee "why you can trust them", filled by the worker
  reason_source text check (reason_source in ('cognee','unavailable')),
  seconds_to_match int,                        -- the 10x metric
  status text not null default 'active' check (status in ('active','home_safe','missed_checkin','help')),
  checkin_due_at timestamptz not null,
  alerted_at timestamptz,
  remembered_at timestamptz,                   -- safe walk sent to Cognee
  created_at timestamptz not null default now()
);
create index matches_status_idx on matches (status, checkin_due_at);

create table solo_trips (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  session_id uuid references study_sessions(id),
  station_id bigint not null references stations(id),
  leave_at timestamptz not null default now(),
  eta_at timestamptz not null,
  status text not null default 'active' check (status in ('active','home_safe','overdue','help')),
  alerted_at timestamptz,                      -- session group alerted
  escalated_at timestamptz,                    -- society safety team alerted (+10 min)
  created_at timestamptz not null default now()
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  solo_trip_id uuid references solo_trips(id) on delete cascade,
  member_id uuid not null references members(id),
  status text not null check (status in ('home_safe','need_help')),
  at timestamptz not null default now(),
  check (num_nonnulls(match_id, solo_trip_id) = 1)
);

create table vouches (
  match_id uuid references matches(id) on delete cascade,
  voucher_id uuid references members(id) on delete cascade,
  vouchee_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, voucher_id)
);

-- ───────────── Safety: reports, incidents, blocklist ─────────────
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references members(id),
  reported_member_id uuid references members(id),
  match_id uuid references matches(id),
  community_id uuid references communities(id),
  kind text not null check (kind in ('behaviour','scam','place')),
  evidence text not null check (char_length(evidence) >= 10),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  decided_by uuid references members(id),     -- a human always decides
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('missed_checkin','help','report')),
  match_id uuid references matches(id),
  solo_trip_id uuid references solo_trips(id),
  report_id uuid references reports(id),
  session_id uuid references study_sessions(id),
  community_id uuid references communities(id),
  member_first_names text[] not null default '{}',
  sos_location geography(point, 4326),         -- only when the member pressed SOS
  notion_page_id text,
  grok_recommendation text,                    -- synced from Notion; Grok Bot recommends, a human decides
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  alerted_at timestamptz,                      -- worker posted to Discord + Notion
  created_at timestamptz not null default now()
);
create index incidents_status_idx on incidents (status, created_at desc);

create table blocklist (
  handle_hash text primary key,                -- sha256, never raw
  reason text,
  confirmed_by_community uuid references communities(id),
  confirmed_by_member uuid references members(id),
  created_at timestamptz not null default now()
);

-- Overdue solo trips (read by the worker with the service role only)
create view overdue_solo_trips as
  select * from solo_trips
  where status = 'active' and eta_at < now() and alerted_at is null;

-- ───────────── Helpers ─────────────
create or replace function is_blocked(p_member uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from members m join blocklist b on b.handle_hash = m.handle_hash
                 where m.id = p_member);
$$;

-- Blocked members lose access to every verified space (sessions, walks, live location).
create or replace function is_community_member(p_community uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from community_members
                 where community_id = p_community and member_id = auth.uid())
     and not is_blocked(auth.uid());
$$;

create or replace function is_session_member(p_session uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from session_members
                 where session_id = p_session and member_id = auth.uid())
     and not is_blocked(auth.uid());
$$;

-- Lets the app show "This account can't use Flock" instead of empty screens.
create or replace function am_i_blocked()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select is_blocked(auth.uid());
$$;


create or replace function require_member()
returns members language plpgsql stable security definer set search_path = public, extensions as $$
declare me members;
begin
  select * into me from members where id = auth.uid();
  if me.id is null then raise exception 'not_onboarded'; end if;
  if is_blocked(me.id) then raise exception 'blocked'; end if;
  return me;
end $$;

create or replace function checkin_window() returns interval
language sql stable security definer set search_path = public, extensions as $$
  select make_interval(mins => coalesce((select value::int from settings where key = 'checkin_window_min'), 45));
$$;

-- ───────────── Onboarding ─────────────
-- Reads the email from auth.users (never from the client), enforces the
-- university domain, and grants +40 for a verified university email.
create or replace function onboard(p_first_name text, p_github text default null)
returns members language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text; v_domain text; v_hash text; v_uni text; v_new boolean; me members;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  v_domain := split_part(v_email, '@', 2);
  v_hash := encode(digest(v_email, 'sha256'), 'hex');

  if exists (select 1 from blocklist where handle_hash = v_hash) then
    raise exception 'blocked';
  end if;
  if not exists (
    select 1 from communities c, unnest(c.allowed_email_domains) d
    where v_domain = d or v_domain like '%.' || d
  ) then
    raise exception 'not_university_email';
  end if;

  select coalesce(
    (select u.name from universities u where v_domain = u.domain or v_domain like '%.' || u.domain limit 1),
    v_domain) into v_uni;

  v_new := not exists (select 1 from members where id = auth.uid());
  insert into members (id, first_name, uni_domain, github_handle, handle_hash, trust_score, trust_reasons)
  values (auth.uid(), trim(p_first_name), v_domain, nullif(trim(p_github), ''), v_hash,
          40, array['Verified ' || v_uni || ' student'])
  on conflict (id) do update
    set first_name = excluded.first_name, github_handle = excluded.github_handle;

  insert into community_members (community_id, member_id)
  select c.id, auth.uid() from communities c, unnest(c.allowed_email_domains) d
  where v_domain = d or v_domain like '%.' || d
  on conflict do nothing;

  select * into me from members where id = auth.uid();
  return me;
end $$;

-- ───────────── Sessions ─────────────
create or replace function sessions_overview()
returns table (
  id uuid, title text, location_name text, lat double precision, lng double precision,
  starts_at timestamptz, ends_at timestamptz, source text, community_name text,
  member_count bigint, joined boolean, member_names text[]
) language sql stable security definer set search_path = public, extensions as $$
  select s.id, s.title, s.location_name,
         st_y(s.location::geometry), st_x(s.location::geometry),
         s.starts_at, s.ends_at, s.source, c.name,
         (select count(*) from session_members sm where sm.session_id = s.id and not is_blocked(sm.member_id)),
         exists (select 1 from session_members sm where sm.session_id = s.id and sm.member_id = auth.uid()),
         array(select m.first_name from session_members sm join members m on m.id = sm.member_id
               where sm.session_id = s.id and not is_blocked(m.id) order by sm.joined_at limit 6)
  from study_sessions s join communities c on c.id = s.community_id
  where is_community_member(s.community_id)
    and s.ends_at > now() - interval '3 hours'
  order by s.ends_at;
$$;

create or replace function create_session(
  p_community uuid, p_title text, p_location_name text,
  p_lat double precision, p_lng double precision, p_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me members; v_id uuid;
begin
  me := require_member();
  if not is_community_member(p_community) then raise exception 'not_in_community'; end if;
  if p_ends_at <= now() then raise exception 'ends_in_past'; end if;
  insert into study_sessions (community_id, title, location_name, location, starts_at, ends_at, created_by)
  values (p_community, trim(p_title), trim(p_location_name),
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, now(), p_ends_at, me.id)
  returning id into v_id;
  insert into session_members (session_id, member_id) values (v_id, me.id);
  return v_id;
end $$;

create or replace function join_session(p_session uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me members;
begin
  me := require_member();
  if not exists (select 1 from study_sessions s where s.id = p_session and is_community_member(s.community_id)) then
    raise exception 'not_in_community';
  end if;
  insert into session_members (session_id, member_id) values (p_session, me.id) on conflict do nothing;
end $$;

-- Session members only. First names, never surnames or emails.
create or replace function session_walks(p_session uuid)
returns table (match_id uuid, first_names text[], station_names text[], status text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select mt.id,
         array[ma.first_name, mb.first_name],
         array[sa.name, sb.name],
         mt.status, mt.created_at
  from matches mt
  join walk_requests ra on ra.id = mt.request_a join members ma on ma.id = ra.member_id join stations sa on sa.id = ra.station_id
  join walk_requests rb on rb.id = mt.request_b join members mb on mb.id = rb.member_id join stations sb on sb.id = rb.station_id
  where mt.session_id = p_session and is_session_member(p_session)
    and mt.created_at > now() - interval '6 hours'
  order by mt.created_at desc;
$$;

create or replace function my_communities()
returns table (id uuid, name text, domains text[], role text, member_count bigint, next_session_title text, next_session_ends_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.name, c.allowed_email_domains, cm.role,
         (select count(*) from community_members x where x.community_id = c.id),
         ns.title, ns.ends_at
  from community_members cm join communities c on c.id = cm.community_id
  left join lateral (select s.title, s.ends_at from study_sessions s
                     where s.community_id = c.id and s.ends_at > now() order by s.ends_at limit 1) ns on true
  where cm.member_id = auth.uid()
  order by c.name;
$$;

-- ───────────── Stations ─────────────
create or replace function search_stations(p_query text, p_lat double precision, p_lng double precision)
returns table (id bigint, name text, lat double precision, lng double precision, distance_m double precision)
language sql stable security definer set search_path = public, extensions as $$
  select st.id, st.name, st_y(st.location::geometry), st_x(st.location::geometry),
         st_distance(st.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  from stations st
  where coalesce(p_query, '') = '' or st.name ilike '%' || p_query || '%'
  order by (coalesce(p_query, '') <> '' and lower(st.name) like lower(p_query) || '%') desc,
           st.location <-> st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
  limit 25;
$$;

-- ───────────── Walk matching ─────────────
-- Candidates: same session, destination stations within 1.5 km, leaving
-- within 20 minutes, verified (trust > 0), not on the blocklist. Up to 3.
create or replace function find_buddies(p_request uuid)
returns table (
  candidate_request uuid, first_name text, uni_domain text, station_name text,
  trust_reasons text[], safe_walks int, dest_distance_m double precision,
  minutes_apart double precision, leave_at timestamptz
) language sql stable security definer set search_path = public, extensions as $$
  select r2.id, m.first_name, m.uni_domain, st.name, m.trust_reasons, m.safe_walks,
         st_distance(r1.destination, r2.destination),
         abs(extract(epoch from (r1.leave_at - r2.leave_at))) / 60.0,
         r2.leave_at
  from walk_requests r1
  join walk_requests r2 on r2.session_id = r1.session_id and r2.id <> r1.id and r2.status = 'open'
  join members m on m.id = r2.member_id
  join stations st on st.id = r2.station_id
  where r1.id = p_request
    and r1.member_id = auth.uid()
    and r1.status = 'open'
    and r2.member_id <> r1.member_id
    and st_dwithin(r1.destination, r2.destination, 1500)
    and abs(extract(epoch from (r1.leave_at - r2.leave_at))) <= 20 * 60
    and m.trust_score > 0
    and not is_blocked(m.id)
    and not is_blocked(r1.member_id)
  order by m.trust_score desc, 7, 8
  limit 3;
$$;

create or replace function request_walk(p_session uuid, p_station bigint, p_leave_at timestamptz)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me members; v_dest geography; v_id uuid;
begin
  me := require_member();
  if not is_session_member(p_session) then raise exception 'not_in_session'; end if;
  select location into v_dest from stations where id = p_station;
  if v_dest is null then raise exception 'unknown_station'; end if;

  update walk_requests set status = 'cancelled'
  where member_id = me.id and session_id = p_session and status = 'open';

  insert into walk_requests (member_id, session_id, station_id, destination, leave_at)
  values (me.id, p_session, p_station, v_dest, coalesce(p_leave_at, now()))
  returning id into v_id;
  return v_id;
end $$;

-- "Walk with Amara": creates the match. The match row reaches Amara's phone
-- through Realtime (RLS lets both participants read it).
create or replace function choose_buddy(p_request uuid, p_candidate uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me members; r_me walk_requests; r_c walk_requests; v_id uuid; v_meet text;
begin
  me := require_member();
  select * into r_me from walk_requests where id = p_request and member_id = me.id for update;
  select * into r_c from walk_requests where id = p_candidate for update;
  if r_me.id is null or r_c.id is null then raise exception 'request_not_found'; end if;
  if r_me.status <> 'open' or r_c.status <> 'open' then raise exception 'no_longer_available'; end if;
  if not exists (select 1 from find_buddies(p_request) f where f.candidate_request = p_candidate) then
    raise exception 'no_longer_available';
  end if;

  select coalesce(location_name, title) into v_meet from study_sessions where id = r_me.session_id;
  insert into matches (request_a, request_b, session_id, meeting_point, seconds_to_match, checkin_due_at)
  values (r_c.id, r_me.id, r_me.session_id, v_meet,
          greatest(1, extract(epoch from (now() - least(r_me.created_at, r_c.created_at)))::int),
          greatest(r_me.leave_at, r_c.leave_at, now()) + checkin_window())
  returning id into v_id;
  update walk_requests set status = 'matched' where id in (r_me.id, r_c.id);
  return v_id;
end $$;

create or replace function cancel_walk(p_request uuid)
returns void language sql security definer set search_path = public, extensions as $$
  update walk_requests set status = 'cancelled'
  where id = p_request and member_id = auth.uid() and status = 'open';
$$;

-- Everything the match card and the walking-home screen need, for a participant.
create or replace function my_match(p_match uuid)
returns table (
  match_id uuid, status text, session_id uuid, session_title text, meeting_point text,
  session_lat double precision, session_lng double precision,
  my_station text, my_station_lat double precision, my_station_lng double precision,
  buddy_first_name text, buddy_uni_domain text, buddy_station text,
  buddy_station_lat double precision, buddy_station_lng double precision,
  buddy_trust_reasons text[], buddy_safe_walks int,
  reason text, reason_source text, seconds_to_match int, checkin_due_at timestamptz,
  my_checkin text, buddy_checkin text, i_vouched boolean, buddy_leave_at timestamptz
) language sql stable security definer set search_path = public, extensions as $$
  with mt as (select * from matches where id = p_match),
  mine as (select r.* from walk_requests r, mt where r.id in (mt.request_a, mt.request_b) and r.member_id = auth.uid()),
  theirs as (select r.* from walk_requests r, mt, mine where r.id in (mt.request_a, mt.request_b) and r.id <> mine.id)
  select mt.id, mt.status, s.id, s.title, mt.meeting_point,
         st_y(s.location::geometry), st_x(s.location::geometry),
         sm.name, st_y(sm.location::geometry), st_x(sm.location::geometry),
         b.first_name, b.uni_domain, sb.name,
         st_y(sb.location::geometry), st_x(sb.location::geometry),
         b.trust_reasons, b.safe_walks,
         mt.reason, mt.reason_source, mt.seconds_to_match, mt.checkin_due_at,
         (select c.status from checkins c where c.match_id = mt.id and c.member_id = mine.member_id order by c.at desc limit 1),
         (select c.status from checkins c where c.match_id = mt.id and c.member_id = theirs.member_id order by c.at desc limit 1),
         exists (select 1 from vouches v where v.match_id = mt.id and v.voucher_id = auth.uid()),
         theirs.leave_at
  from mt join mine on true join theirs on true
  join study_sessions s on s.id = mt.session_id
  join stations sm on sm.id = mine.station_id
  join stations sb on sb.id = theirs.station_id
  join members b on b.id = theirs.member_id;
$$;

-- For the Tonight screen: is there a walk or solo timer in progress?
create or replace function my_active()
returns table (kind text, id uuid, session_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  (select 'match', mt.id, mt.session_id from matches mt
   join walk_requests r on r.id in (mt.request_a, mt.request_b) and r.member_id = auth.uid()
   where mt.status in ('active','missed_checkin','help')
     and not exists (select 1 from checkins c where c.match_id = mt.id and c.member_id = auth.uid() and c.status = 'home_safe')
   order by mt.created_at desc limit 1)
  union all
  (select 'solo', t.id, t.session_id from solo_trips t
   where t.member_id = auth.uid() and t.status in ('active','overdue','help')
   order by t.created_at desc limit 1)
  union all
  (select 'request', r.id, r.session_id from walk_requests r
   where r.member_id = auth.uid() and r.status = 'open' and r.created_at > now() - interval '2 hours'
   order by r.created_at desc limit 1);
$$;

-- ───────────── Solo check-in timer ─────────────
create or replace function start_solo(p_session uuid, p_station bigint, p_eta_minutes int)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me members; v_id uuid;
begin
  me := require_member();
  if p_eta_minutes not between 1 and 180 then raise exception 'bad_eta'; end if;
  if p_session is not null and not is_session_member(p_session) then raise exception 'not_in_session'; end if;
  update walk_requests set status = 'cancelled' where member_id = me.id and status = 'open';
  insert into solo_trips (member_id, session_id, station_id, eta_at)
  values (me.id, p_session, p_station, now() + make_interval(mins => p_eta_minutes))
  returning id into v_id;
  return v_id;
end $$;

create or replace function my_trip(p_trip uuid)
returns table (trip_id uuid, status text, session_id uuid, session_title text, station_name text,
               station_lat double precision, station_lng double precision,
               session_lat double precision, session_lng double precision,
               leave_at timestamptz, eta_at timestamptz, alerted_at timestamptz, escalated_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select t.id, t.status, t.session_id, s.title, st.name,
         st_y(st.location::geometry), st_x(st.location::geometry),
         st_y(s.location::geometry), st_x(s.location::geometry),
         t.leave_at, t.eta_at, t.alerted_at, t.escalated_at
  from solo_trips t join stations st on st.id = t.station_id
  left join study_sessions s on s.id = t.session_id
  where t.id = p_trip and t.member_id = auth.uid();
$$;

-- "Add 10 min" on the solo timer: only before the worker has alerted anyone.
create or replace function extend_solo(p_trip uuid, p_minutes int)
returns timestamptz language plpgsql security definer set search_path = public, extensions as $$
declare me members; v_eta timestamptz;
begin
  me := require_member();
  if p_minutes not between 1 and 60 then raise exception 'bad_eta'; end if;
  update solo_trips
     set eta_at = least(greatest(eta_at, now()) + make_interval(mins => p_minutes), now() + interval '180 minutes')
   where id = p_trip and member_id = me.id and status = 'active' and alerted_at is null
  returning eta_at into v_eta;
  if v_eta is null then raise exception 'trip_not_active'; end if;
  return v_eta;
end $$;

-- ───────────── Check-ins ─────────────
-- need_help creates an incident (the worker posts it to Notion + Discord).
-- Both home_safe: +1 safe walk and +10 trust each, and any missed-check-in
-- incident for the walk is resolved.
create or replace function check_in(p_match uuid, p_trip uuid, p_status text,
                                    p_lat double precision default null, p_lng double precision default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  me members; mt matches; t solo_trips; v_session uuid; v_community uuid; v_loc geography; v_count int;
begin
  me := require_member();
  if p_status not in ('home_safe','need_help') then raise exception 'bad_status'; end if;
  if p_lat is not null and p_lng is not null and p_status = 'need_help' then
    v_loc := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  if p_match is not null then
    select * into mt from matches where id = p_match;
    if mt.id is null or not exists (select 1 from walk_requests r where r.id in (mt.request_a, mt.request_b) and r.member_id = me.id) then
      raise exception 'not_your_walk';
    end if;
    insert into checkins (match_id, member_id, status) values (mt.id, me.id, p_status);
    v_session := mt.session_id;

    if p_status = 'need_help' then
      update matches set status = 'help' where id = mt.id;
      select community_id into v_community from study_sessions where id = v_session;
      insert into incidents (kind, match_id, session_id, community_id, member_first_names, sos_location)
      values ('help', mt.id, v_session, v_community, array[me.first_name], v_loc);
      return 'help';
    end if;

    select count(distinct c.member_id) into v_count from checkins c
    where c.match_id = mt.id and c.status = 'home_safe';
    if v_count >= 2 and mt.status <> 'home_safe' then
      update matches set status = 'home_safe' where id = mt.id;
      update members set safe_walks = safe_walks + 1, trust_score = trust_score + 10
      where id in (select r.member_id from walk_requests r where r.id in (mt.request_a, mt.request_b));
      update walk_requests set status = 'done' where id in (mt.request_a, mt.request_b);
      update incidents set status = 'resolved', resolution = 'Both checked in home safe'
      where match_id = mt.id and kind = 'missed_checkin' and status = 'open';
      return 'both_home';
    end if;
    return 'home_safe';
  end if;

  if p_trip is not null then
    select * into t from solo_trips where id = p_trip and member_id = me.id;
    if t.id is null then raise exception 'not_your_trip'; end if;
    insert into checkins (solo_trip_id, member_id, status) values (t.id, me.id, p_status);
    if p_status = 'need_help' then
      update solo_trips set status = 'help' where id = t.id;
      select community_id into v_community from study_sessions where id = t.session_id;
      insert into incidents (kind, solo_trip_id, session_id, community_id, member_first_names, sos_location)
      values ('help', t.id, t.session_id, v_community, array[me.first_name], v_loc);
      return 'help';
    end if;
    update solo_trips set status = 'home_safe' where id = t.id;
    update incidents set status = 'resolved', resolution = 'Checked in home safe'
    where solo_trip_id = t.id and kind = 'missed_checkin' and status = 'open';
    return 'home_safe';
  end if;

  raise exception 'nothing_to_check_in';
end $$;

-- ───────────── Vouching ─────────────
create or replace function vouch(p_match uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me members; mt matches; v_buddy uuid; v_first boolean;
begin
  me := require_member();
  select * into mt from matches where id = p_match and status = 'home_safe';
  if mt.id is null then raise exception 'walk_not_finished'; end if;
  select r.member_id into v_buddy from walk_requests r
  where r.id in (mt.request_a, mt.request_b) and r.member_id <> me.id;
  if v_buddy is null or not exists (select 1 from walk_requests r where r.id in (mt.request_a, mt.request_b) and r.member_id = me.id) then
    raise exception 'not_your_walk';
  end if;
  v_first := not exists (select 1 from vouches where vouchee_id = v_buddy);
  insert into vouches (match_id, voucher_id, vouchee_id) values (mt.id, me.id, v_buddy) on conflict do nothing;
  if v_first and found then
    update members set trust_score = trust_score + 15,
                       trust_reasons = array_append(trust_reasons, 'Vouched for by a walk buddy')
    where id = v_buddy;
  end if;
end $$;

-- ───────────── Reports ─────────────
create or replace function file_report(p_match uuid, p_kind text, p_evidence text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me members; mt matches; v_reported uuid; v_community uuid; v_session uuid; v_report uuid; v_name text;
begin
  me := require_member();
  if p_match is not null then
    select * into mt from matches where id = p_match;
    if mt.id is null or not exists (select 1 from walk_requests r where r.id in (mt.request_a, mt.request_b) and r.member_id = me.id) then
      raise exception 'not_your_walk';
    end if;
    select r.member_id into v_reported from walk_requests r
    where r.id in (mt.request_a, mt.request_b) and r.member_id <> me.id;
    v_session := mt.session_id;
    select community_id into v_community from study_sessions where id = v_session;
  else
    select community_id into v_community from community_members where member_id = me.id limit 1;
  end if;

  insert into reports (reporter_id, reported_member_id, match_id, community_id, kind, evidence)
  values (me.id, v_reported, p_match, v_community, p_kind, trim(p_evidence))
  returning id into v_report;

  select first_name into v_name from members where id = v_reported;
  insert into incidents (kind, report_id, match_id, session_id, community_id, member_first_names)
  values ('report', v_report, p_match, v_session, v_community, array_remove(array[v_name], null));
  return v_report;
end $$;

-- ───────────── Live location (Realtime broadcast, never stored) ─────────────
-- Private channels: 'walk:<match id>' and 'trip:<solo trip id>'.
-- Participants send; participants and their session group receive.
create or replace function can_watch_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  begin v_id := split_part(p_topic, ':', 2)::uuid; exception when others then return false; end;
  if p_topic like 'walk:%' then
    return exists (select 1 from matches mt where mt.id = v_id and mt.created_at > now() - interval '6 hours'
                   and (is_session_member(mt.session_id)
                        or exists (select 1 from walk_requests r where r.id in (mt.request_a, mt.request_b) and r.member_id = auth.uid())));
  elsif p_topic like 'trip:%' then
    return exists (select 1 from solo_trips t where t.id = v_id and t.created_at > now() - interval '6 hours'
                   and (t.member_id = auth.uid() or (t.session_id is not null and is_session_member(t.session_id))));
  end if;
  return false;
end $$;

create or replace function can_share_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  begin v_id := split_part(p_topic, ':', 2)::uuid; exception when others then return false; end;
  if p_topic like 'walk:%' then
    return exists (select 1 from matches mt join walk_requests r on r.id in (mt.request_a, mt.request_b)
                   where mt.id = v_id and r.member_id = auth.uid() and mt.status in ('active','missed_checkin','help'));
  elsif p_topic like 'trip:%' then
    return exists (select 1 from solo_trips t where t.id = v_id and t.member_id = auth.uid() and t.status in ('active','overdue','help'));
  end if;
  return false;
end $$;

create policy "flock live location: receive" on realtime.messages for select to authenticated
  using (public.can_watch_topic(realtime.topic()));
create policy "flock live location: send" on realtime.messages for insert to authenticated
  with check (public.can_share_topic(realtime.topic()));

-- ───────────── Row-level security ─────────────
alter table universities enable row level security;
create policy "universities are public" on universities for select to authenticated using (true);

alter table settings enable row level security;                -- service role only

alter table communities enable row level security;
create policy "members read their communities" on communities for select to authenticated
  using (is_community_member(id));

alter table members enable row level security;
create policy "read own profile" on members for select to authenticated using (id = auth.uid());
create policy "update own profile" on members for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Only safe columns are editable. trust_*, handle_hash, uni_domain change via RPCs / service role only.
revoke insert, update, delete on members from anon, authenticated;
grant update (first_name, github_handle, discord_user_id, emergency_contact) on members to authenticated;

alter table community_members enable row level security;
create policy "read own memberships" on community_members for select to authenticated using (member_id = auth.uid());

alter table study_sessions enable row level security;
create policy "community members read sessions" on study_sessions for select to authenticated
  using (is_community_member(community_id));

alter table session_members enable row level security;
create policy "read own session memberships" on session_members for select to authenticated using (member_id = auth.uid());

alter table stations enable row level security;
create policy "stations are public" on stations for select to authenticated using (true);

alter table walk_requests enable row level security;
create policy "read own walk requests" on walk_requests for select to authenticated using (member_id = auth.uid());

alter table matches enable row level security;
create policy "participants read matches" on matches for select to authenticated
  using (exists (select 1 from walk_requests w where w.id in (request_a, request_b) and w.member_id = auth.uid()));

alter table checkins enable row level security;
create policy "read own checkins" on checkins for select to authenticated using (member_id = auth.uid());

alter table solo_trips enable row level security;
create policy "read own solo trips" on solo_trips for select to authenticated using (member_id = auth.uid());

alter table vouches enable row level security;
create policy "read own vouches" on vouches for select to authenticated using (voucher_id = auth.uid());

alter table reports enable row level security;
create policy "reporters read own reports" on reports for select to authenticated using (reporter_id = auth.uid());

alter table incidents enable row level security;                -- service role only (worker + dashboard route)
alter table blocklist enable row level security;                -- service role only

revoke all on overdue_solo_trips from anon, authenticated;

-- Clients may only call RPCs while signed in.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- Internal helpers: only called from other security-definer functions (which run as owner).
-- is_community_member stays callable (RLS policies use it); can_*_topic stay (Realtime policies use them).
revoke execute on function is_blocked(uuid) from authenticated;
revoke execute on function require_member() from authenticated;
revoke execute on function checkin_window() from authenticated;
revoke execute on function is_session_member(uuid) from authenticated;

-- ───────────── Realtime ─────────────
-- Phones: matches (RLS-filtered). Worker (service role): the rest.
do $$
declare t text;
begin
  foreach t in array array['matches','incidents','study_sessions','session_members','solo_trips'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table matches replica identity full;      -- UPDATE events carry the Cognee reason
