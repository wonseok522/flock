-- Flock schema test. Runs as one block and ALWAYS rolls back by ending with
-- an exception: "FLOCK TESTS PASSED ..." means success; anything else is the
-- first failure. Safe to run on the live project (needs seed.sql applied).
do $$
declare
  a uuid := gen_random_uuid();  -- Amara, heading to Camden Town
  b uuid := gen_random_uuid();  -- Ben, heading to Mornington Crescent
  c uuid := gen_random_uuid();  -- Cara, heading to Camden Town, will be blocked
  g uuid := gen_random_uuid();  -- Gina, gmail: must be rejected
  hc uuid; sess uuid; ra uuid; rb uuid; rc uuid; m uuid; n int; t text; ok boolean;
  st_camden bigint := -1001; st_morn bigint := -1002; st_far bigint := -1003;
begin
  select id into hc from communities where name = 'The Hack Collective';
  if hc is null then raise exception 'FAIL: run seed.sql first'; end if;

  insert into stations (id, name, location) values
    (st_camden, 'TEST Camden Town', st_setsrid(st_makepoint(-0.1426, 51.5392), 4326)::geography),
    (st_morn,   'TEST Mornington Crescent', st_setsrid(st_makepoint(-0.1387, 51.5342), 4326)::geography),
    (st_far,    'TEST Stratford', st_setsrid(st_makepoint(-0.0035, 51.5416), 4326)::geography);

  insert into auth.users (id, email, aud, role) values
    (a, 'amara.test@demo.flock.test', 'authenticated', 'authenticated'),
    (b, 'ben.test@demo.flock.test', 'authenticated', 'authenticated'),
    (c, 'cara.test@demo.flock.test', 'authenticated', 'authenticated'),
    (g, 'gina.test@gmail.com', 'authenticated', 'authenticated');

  -- S3: non-university email is rejected server-side
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  begin
    perform onboard('Gina');
    raise exception 'FAIL: gmail was allowed to onboard';
  exception when others then
    if sqlerrm <> 'not_university_email' then raise; end if;
  end;

  -- S3/S4: onboarding grants +40 and joins the community
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform onboard('Amara');
  if (select trust_score from members where id = a) <> 40 then raise exception 'FAIL: no +40 on onboard'; end if;
  if not is_community_member(hc) then raise exception 'FAIL: not added to community'; end if;
  sess := create_session(hc, 'TEST Late study', 'TEST Library', 51.5246, -0.1340, now() + interval '2 hours');

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform onboard('Ben');
  perform join_session(sess);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform onboard('Cara');
  perform join_session(sess);

  -- Requests: Amara first (waits), Cara, then Ben
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ra := request_walk(sess, st_camden, now() + interval '5 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  rc := request_walk(sess, st_camden, now() + interval '5 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rb := request_walk(sess, st_morn, now() + interval '10 minutes');

  select count(*) into n from find_buddies(rb);
  if n <> 2 then raise exception 'FAIL: Ben should see 2 candidates, saw %', n; end if;

  -- Blocklist: Cara is blocked (a human confirmed a report) → disappears
  insert into blocklist (handle_hash, reason) select handle_hash, 'test' from members where id = c;
  select count(*) into n from find_buddies(rb);
  if n <> 1 then raise exception 'FAIL: blocked user still matchable (% candidates)', n; end if;
  if (select first_name from find_buddies(rb) limit 1) <> 'Amara' then raise exception 'FAIL: wrong candidate'; end if;

  -- Far station never matches
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform request_walk(sess, st_far, now());
  select count(*) into n from find_buddies((select id from walk_requests where member_id = a and status = 'open'));
  if n <> 0 then raise exception 'FAIL: Stratford matched Camden'; end if;
  ra := request_walk(sess, st_camden, now() + interval '5 minutes');

  -- S1: Ben chooses Amara → a match exists that BOTH can read
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  m := choose_buddy(rb, ra);
  if (select status from walk_requests where id = ra) <> 'matched' then raise exception 'FAIL: requests not matched'; end if;
  if (select buddy_first_name from my_match(m)) <> 'Amara' then raise exception 'FAIL: my_match for Ben'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  if (select buddy_first_name from my_match(m)) <> 'Ben' then raise exception 'FAIL: my_match for Amara'; end if;
  if (select seconds_to_match from matches where id = m) is null then raise exception 'FAIL: no seconds_to_match'; end if;
  if not can_share_topic('walk:' || m) then raise exception 'FAIL: Amara cannot share location'; end if;

  -- Double booking is refused
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    perform choose_buddy(rb, ra);
    raise exception 'FAIL: matched twice';
  exception when others then
    if sqlerrm <> 'no_longer_available' then raise; end if;
  end;

  -- Check-ins: both home → +1 safe walk, +10 trust; then vouch (+15 once)
  -- (the caught error above rolled back its set_config, so set Ben again)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  t := check_in(m, null, 'home_safe');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  t := check_in(m, null, 'home_safe');
  if t <> 'both_home' then raise exception 'FAIL: expected both_home, got %', t; end if;
  if (select safe_walks from members where id = b) <> 1 then raise exception 'FAIL: safe_walks'; end if;
  if (select trust_score from members where id = b) <> 50 then raise exception 'FAIL: +10 trust'; end if;
  perform vouch(m);
  if (select trust_score from members where id = b) <> 65 then raise exception 'FAIL: +15 vouch'; end if;

  -- Solo + SOS → incident
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  t := check_in(null, start_solo(sess, st_morn, 15), 'need_help', 51.53, -0.14);
  if not exists (select 1 from incidents where kind = 'help' and 'Ben' = any(member_first_names) and sos_location is not null) then
    raise exception 'FAIL: SOS did not create an incident';
  end if;

  -- Blocked user can't use the app
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin
    perform request_walk(sess, st_camden, now());
    raise exception 'FAIL: blocked user could request a walk';
  exception when others then
    if sqlerrm <> 'blocked' then raise; end if;
  end;

  raise exception 'FLOCK TESTS PASSED (rolled back)';
end $$;
