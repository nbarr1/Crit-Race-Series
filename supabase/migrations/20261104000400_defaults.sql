-- Configuration defaults (not demo data). Admins change these in the app.

insert into public.app_settings (key, value, description, is_public) values
  ('payments_enabled', 'true', 'Collect online payment through Stripe Checkout. Off: registrations confirm without payment and riders pay at the desk.', true),
  ('schedule_cadence_note', '"Staff enter each event date by hand."', 'Weekly or every two weeks. Informational only; dates come from the events table.', true),
  ('refund_policy', '"no_automatic_refunds"', 'One of: no_automatic_refunds, full_refund_before_close. Default: staff decide refunds by hand.', true),
  ('usac_license_required', 'false', 'Require a USA Cycling license number before registration. Default: optional, not enforced.', true),
  ('masters_min_age', '40', 'Masters minimum age (as of December 31 of the season year). Warning only; staff can override.', true),
  ('minors_allowed', 'true', 'Allow riders under 18 to register. They need a parent or guardian signature on the waiver.', true),
  ('default_category_capacity', '60', 'Default capacity for a new event category.', true),
  ('default_price_cents', '2500', 'Placeholder per-race online price. Admin must set the real value.', true),
  ('default_walk_up_price_cents', '3000', 'Placeholder walk-up price. Admin must set the real value.', true),
  ('season_pass_price_cents', '20000', 'Placeholder season pass price. Admin must set the real value.', true),
  ('external_waiver_url', 'null', 'Optional link to an external waiver (for example, a sanctioning body''s). Shown alongside the series waiver when set.', true),
  ('reminder_hours_before', '24', 'Hours before the first start time to send a race-day reminder email.', true);

insert into public.categories (name, description, eligibility_notes, min_age, requires_gender, sort_order) values
  ('A', 'Fastest field. Experienced racers.', '', null, null, 10),
  ('B', 'Intermediate field. Newer racers start here.', '', null, null, 20),
  ('Open Women', 'Open to women of all abilities.', 'Open to riders who identify as women.', null, 'woman', 30),
  ('Masters', 'Riders 40 and older.', 'Minimum age set in admin settings (default 40). Warning only.', 40, null, 40);

insert into public.points_rules (name, points_by_place, drop_worst_n, tiebreaker) values
  ('Default series points',
   '{"1":25,"2":20,"3":16,"4":13,"5":11,"6":10,"7":9,"8":8,"9":7,"10":6,"11":5,"12":4,"13":3,"14":2,"15":1}',
   0, 'most_wins_then_most_recent_best');

-- Placeholder coordinates near Brevard, North Carolina. An admin must confirm
-- the real address and coordinates (coordinates_confirmed = false until then).
insert into public.venues (name, address, latitude, longitude, coordinates_confirmed, parking_notes)
values (
  'Connestee Nature Park',
  'Address to be confirmed by an admin',
  35.2338, -82.7343,
  false,
  'Parking and arrival notes to be confirmed by an admin.'
);
