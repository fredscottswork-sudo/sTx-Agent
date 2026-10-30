-- =====================================================================
-- UnderCover Media — core schema
-- Postgres / Supabase. Public content is readable by anon; all writes
-- require a row in public.staff (verified via is_staff()).
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- staff -----------------------------------------------------
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null default 'Editor',
  role text not null default 'editor' check (role in ('owner','editor','producer')),
  initials text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid() and s.active);
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

-- ---------- taxonomy --------------------------------------------------
create table if not exists public.sections (
  slug text primary key,
  name text not null,
  description text,
  blurb text,
  sort_order int not null default 0,
  in_nav boolean not null default true
);

create table if not exists public.authors (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  role text,
  bio text,
  initials text,
  email text,
  image_url text,
  created_at timestamptz not null default now()
);

-- ---------- stories ---------------------------------------------------
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  section_slug text references public.sections(slug) on update cascade on delete set null,
  kicker text,
  title text not null,
  deck text,
  body jsonb not null default '[]'::jsonb,
  author_slug text references public.authors(slug) on update cascade on delete set null,
  image_url text,
  image_caption text,
  image_credit text,
  location text,
  tags text[] not null default '{}',
  read_minutes int not null default 4,
  status text not null default 'draft' check (status in ('draft','review','published','archived')),
  is_lead boolean not null default false,
  is_top boolean not null default false,
  is_featured boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  views int not null default 0,
  seo_title text,
  seo_description text,
  created_by uuid
);
create index if not exists stories_status_idx on public.stories (status, published_at desc);
create index if not exists stories_section_idx on public.stories (section_slug, published_at desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists stories_touch on public.stories;
create trigger stories_touch before update on public.stories
for each row execute function public.touch_updated_at();

-- ---------- broadcast ------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  show_name text,
  section text,
  duration text,
  description text,
  image_url text,
  video_url text,
  published_at timestamptz not null default now(),
  status text not null default 'published' check (status in ('draft','published')),
  is_featured boolean not null default false
);

create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  tagline text,
  description text,
  host text,
  days text,
  start_time time,
  end_time time,
  image_url text,
  is_live boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  day_group text not null default 'Weekdays' check (day_group in ('Weekdays','Saturday','Sunday')),
  start_time text not null,
  title text not null,
  host text,
  show_slug text references public.shows(slug) on update cascade on delete set null,
  sort_order int not null default 0
);

create table if not exists public.podcasts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  show_name text,
  description text,
  duration text,
  audio_url text,
  image_url text,
  published_at timestamptz not null default now()
);

create table if not exists public.presenters (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  show_name text,
  initials text,
  bio text,
  image_url text,
  sort_order int not null default 0
);

create table if not exists public.ticker_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  text text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

-- ---------- site config / ops ---------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  label text,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  path text unique not null,
  url text not null,
  alt text,
  mime text,
  bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  source text default 'website',
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  topic text,
  body text not null,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id bigserial primary key,
  actor text,
  action text not null,
  entity text,
  detail text,
  created_at timestamptz not null default now()
);

-- ---------- RLS -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['staff','sections','authors','stories','videos','shows',
      'schedule_slots','podcasts','presenters','ticker_items','settings','media',
      'subscribers','messages','activity_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- public read of published content
drop policy if exists sections_read on public.sections;
create policy sections_read on public.sections for select using (true);

drop policy if exists authors_read on public.authors;
create policy authors_read on public.authors for select using (true);

drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories for select using (status = 'published');

drop policy if exists videos_read on public.videos;
create policy videos_read on public.videos for select using (status = 'published');

drop policy if exists shows_read on public.shows;
create policy shows_read on public.shows for select using (true);

drop policy if exists schedule_read on public.schedule_slots;
create policy schedule_read on public.schedule_slots for select using (true);

drop policy if exists podcasts_read on public.podcasts;
create policy podcasts_read on public.podcasts for select using (true);

drop policy if exists presenters_read on public.presenters;
create policy presenters_read on public.presenters for select using (true);

drop policy if exists ticker_read on public.ticker_items;
create policy ticker_read on public.ticker_items for select using (active);

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (is_public);

drop policy if exists media_read on public.media;
create policy media_read on public.media for select using (true);

-- staff write access on every content table
do $$
declare t text;
begin
  foreach t in array array['sections','authors','stories','videos','shows',
      'schedule_slots','podcasts','presenters','ticker_items','settings','media',
      'subscribers','messages','activity_log']
  loop
    execute format('drop policy if exists %I_staff_all on public.%I', t, t);
    execute format('create policy %I_staff_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t, t);
  end loop;
end $$;

drop policy if exists staff_self_read on public.staff;
create policy staff_self_read on public.staff for select to authenticated using (user_id = auth.uid() or public.is_staff());

drop policy if exists staff_manage on public.staff;
create policy staff_manage on public.staff for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- newsletter + contact: anonymous inserts only
drop policy if exists subscribers_insert on public.subscribers;
create policy subscribers_insert on public.subscribers for insert to anon, authenticated with check (true);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to anon, authenticated with check (true);

-- ---------- public counters ------------------------------------------
create or replace function public.increment_story_view(story_slug text) returns void
language sql security definer set search_path = public as $$
  update public.stories set views = views + 1 where slug = story_slug and status = 'published';
$$;
grant execute on function public.increment_story_view(text) to anon, authenticated;

-- ---------- storage ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media','media', true)
on conflict (id) do nothing;

drop policy if exists media_bucket_read on storage.objects;
create policy media_bucket_read on storage.objects for select using (bucket_id = 'media');

drop policy if exists media_bucket_write on storage.objects;
create policy media_bucket_write on storage.objects for all to authenticated
  using (bucket_id = 'media' and public.is_staff())
  with check (bucket_id = 'media' and public.is_staff());
