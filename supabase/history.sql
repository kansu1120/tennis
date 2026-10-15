create table if not exists public.court_record_history (
  id uuid primary key,
  kind text not null check (kind in ('member', 'tournament')),
  record_id text not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  before_data jsonb,
  after_data jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists court_record_history_record_idx
  on public.court_record_history (kind, record_id, changed_at desc);

alter table public.court_record_history enable row level security;

grant select, insert on public.court_record_history to anon, authenticated;

drop policy if exists "Public can read record history" on public.court_record_history;
create policy "Public can read record history"
  on public.court_record_history for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can insert record history" on public.court_record_history;
create policy "Public can insert record history"
  on public.court_record_history for insert
  to anon, authenticated
  with check (true);
