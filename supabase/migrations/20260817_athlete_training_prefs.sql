-- T53 #3: typed per-athlete training preferences. Enumerated columns with CHECK
-- constraints — an enum cannot carry a prompt injection the way free text can,
-- which is why preferences get their own typed table instead of athlete_context
-- (whose extractor rightly refuses behavior-change requests). Every default is
-- today's shipped behavior; an absent row means "all defaults".
create table if not exists athlete_training_prefs (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  loading_language text not null default 'percent+rpe'
    check (loading_language in ('percent+rpe','percent','rpe','climb_singles','fixed_weight')),
  max_update_policy text not null default 'infer'
    check (max_update_policy in ('infer','declared_only','pr_single_only')),
  testing_style text not null default 'retest_cycle'
    check (testing_style in ('final_week','test_day','retest_cycle')),
  session_minutes_cap int
    check (session_minutes_cap is null or session_minutes_cap between 15 and 240),
  movements_per_day_cap int
    check (movements_per_day_cap is null or movements_per_day_cap between 2 and 15),
  accessory_load text not null default 'programmed'
    check (accessory_load in ('programmed','athlete_choice')),
  source text not null default 'chat'
    check (source in ('chat','builder','settings')),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Gateway-only access, same posture as the other athlete PII tables.
revoke all on athlete_training_prefs from anon, authenticated;
