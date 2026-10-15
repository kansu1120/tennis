create table if not exists public.court_records (
  id text not null,
  kind text not null check (kind in ('member', 'tournament')),
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, id),
  check (deleted or data is not null)
);

create or replace function public.set_court_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists court_records_updated_at on public.court_records;
create trigger court_records_updated_at
  before update on public.court_records
  for each row execute function public.set_court_records_updated_at();

alter table public.court_records enable row level security;

grant select, insert, update on public.court_records to anon, authenticated;

drop policy if exists "Public can read shared records" on public.court_records;
create policy "Public can read shared records"
  on public.court_records for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can insert shared records" on public.court_records;
create policy "Public can insert shared records"
  on public.court_records for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Public can update shared records" on public.court_records;
create policy "Public can update shared records"
  on public.court_records for update
  to anon, authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table public.court_records;

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
