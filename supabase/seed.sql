-- Flock seed: reference data only. Synthetic demo users come from
-- scripts/seed-demo.ts; stations from scripts/seed-stations.ts.

insert into universities (domain, name) values
  ('ucl.ac.uk', 'UCL'),
  ('kcl.ac.uk', 'King''s'),
  ('imperial.ac.uk', 'Imperial'),
  ('lse.ac.uk', 'LSE'),
  ('qmul.ac.uk', 'Queen Mary'),
  ('demo.flock.test', 'demo')
on conflict (domain) do update set name = excluded.name;

insert into communities (name, allowed_email_domains) values
  ('The Hack Collective', array['ucl.ac.uk','kcl.ac.uk','imperial.ac.uk','lse.ac.uk','qmul.ac.uk','demo.flock.test']),
  ('UCL', array['ucl.ac.uk'])
on conflict (name) do update set allowed_email_domains = excluded.allowed_email_domains;

-- Minutes after leaving before a missed check-in alert. Set to '1' for the demo.
insert into settings (key, value) values ('checkin_window_min', '45')
on conflict (key) do nothing;
