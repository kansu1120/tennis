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
