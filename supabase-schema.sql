create extension if not exists pgcrypto;

create table if not exists public.farewells (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_path text not null,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  radius_meters integer not null default 45,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.farewells enable row level security;

create index if not exists farewells_user_recorded_idx
  on public.farewells (user_id, recorded_at desc);

create index if not exists farewells_user_lat_lng_idx
  on public.farewells (user_id, latitude, longitude);

drop policy if exists "Users can read their own farewells" on public.farewells;
drop policy if exists "Users can create their own farewells" on public.farewells;

create policy "Users can read their own farewells"
  on public.farewells
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own farewells"
  on public.farewells
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('farewell-videos', 'farewell-videos', false, 52428800, array['video/webm', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload their own farewell videos" on storage.objects;
drop policy if exists "Users can read their own farewell videos" on storage.objects;

create policy "Users can upload their own farewell videos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'farewell-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can read their own farewell videos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'farewell-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
