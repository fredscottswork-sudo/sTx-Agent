-- =====================================================================
-- UnderCover Media — content importer
-- Takes the JSON produced by seed_export.py (public/assets/seed.json)
-- and fills the newsroom tables. Safe to run repeatedly: rows are
-- matched on slug, so edits made in the admin are preserved except for
-- the fields present in the file.
-- =====================================================================
create or replace function public.import_seed(j jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_sections int := 0; n_authors int := 0; n_stories int := 0; n_videos int := 0;
  n_shows int := 0; n_sched int := 0; n_pods int := 0; n_pres int := 0;
  n_tick int := 0; n_set int := 0;
begin
  if j is null or j->>'version' is null then
    raise exception 'not a seed document';
  end if;

  insert into public.sections (slug, name, description, blurb, sort_order, in_nav)
  select slug, name, description, blurb, sort_order, in_nav
  from jsonb_populate_recordset(null::public.sections, j->'sections')
  on conflict (slug) do update set name = excluded.name, description = excluded.description,
    blurb = excluded.blurb, sort_order = excluded.sort_order, in_nav = excluded.in_nav;
  get diagnostics n_sections = row_count;

  insert into public.authors (slug, name, role, bio, initials)
  select slug, name, role, bio, initials
  from jsonb_populate_recordset(null::public.authors, j->'authors')
  on conflict (slug) do update set name = excluded.name, role = excluded.role,
    bio = excluded.bio, initials = excluded.initials;
  get diagnostics n_authors = row_count;

  insert into public.stories (slug, section_slug, kicker, title, deck, body, author_slug,
    image_url, image_caption, image_credit, location, tags, read_minutes, status,
    is_lead, is_top, is_featured, published_at)
  select slug, section_slug, kicker, title, deck, body, author_slug, image_url,
    image_caption, image_credit, location, tags, read_minutes, status,
    is_lead, is_top, is_featured, published_at
  from jsonb_populate_recordset(null::public.stories, j->'stories')
  on conflict (slug) do update set section_slug = excluded.section_slug, kicker = excluded.kicker,
    title = excluded.title, deck = excluded.deck, body = excluded.body,
    author_slug = excluded.author_slug, image_url = excluded.image_url,
    image_caption = excluded.image_caption, image_credit = excluded.image_credit,
    location = excluded.location, tags = excluded.tags, read_minutes = excluded.read_minutes,
    status = excluded.status, is_lead = excluded.is_lead, is_top = excluded.is_top,
    is_featured = excluded.is_featured, published_at = excluded.published_at;
  get diagnostics n_stories = row_count;

  insert into public.videos (slug, title, show_name, section, duration, description,
    image_url, is_featured, status, published_at)
  select slug, title, show_name, section, duration, description, image_url, is_featured, status, published_at
  from jsonb_populate_recordset(null::public.videos, j->'videos')
  on conflict (slug) do update set title = excluded.title, show_name = excluded.show_name,
    section = excluded.section, duration = excluded.duration, description = excluded.description,
    image_url = excluded.image_url, is_featured = excluded.is_featured,
    status = excluded.status, published_at = excluded.published_at;
  get diagnostics n_videos = row_count;

  insert into public.shows (slug, name, tagline, description, host, days, start_time,
    end_time, image_url, is_live, sort_order)
  select slug, name, tagline, description, host, days, start_time, end_time, image_url, is_live, sort_order
  from jsonb_populate_recordset(null::public.shows, j->'shows')
  on conflict (slug) do update set name = excluded.name, tagline = excluded.tagline,
    description = excluded.description, host = excluded.host, days = excluded.days,
    start_time = excluded.start_time, end_time = excluded.end_time,
    image_url = excluded.image_url, is_live = excluded.is_live, sort_order = excluded.sort_order;
  get diagnostics n_shows = row_count;

  delete from public.schedule_slots;
  insert into public.schedule_slots (day_group, start_time, title, host, show_slug, sort_order)
  select day_group, start_time, title, host, show_slug, sort_order
  from jsonb_populate_recordset(null::public.schedule_slots, j->'schedule_slots');
  get diagnostics n_sched = row_count;

  insert into public.podcasts (slug, title, show_name, description, duration, audio_url, image_url, published_at)
  select slug, title, show_name, description, duration, audio_url, image_url, published_at
  from jsonb_populate_recordset(null::public.podcasts, j->'podcasts')
  on conflict (slug) do update set title = excluded.title, show_name = excluded.show_name,
    description = excluded.description, duration = excluded.duration, audio_url = excluded.audio_url,
    image_url = excluded.image_url, published_at = excluded.published_at;
  get diagnostics n_pods = row_count;

  insert into public.presenters (slug, name, show_name, initials, bio, sort_order)
  select slug, name, show_name, initials, bio, sort_order
  from jsonb_populate_recordset(null::public.presenters, j->'presenters')
  on conflict (slug) do update set name = excluded.name, show_name = excluded.show_name,
    initials = excluded.initials, bio = excluded.bio, sort_order = excluded.sort_order;
  get diagnostics n_pres = row_count;

  delete from public.ticker_items;
  insert into public.ticker_items (label, text, sort_order)
  select label, text, sort_order
  from jsonb_populate_recordset(null::public.ticker_items, j->'ticker_items');
  get diagnostics n_tick = row_count;

  insert into public.settings (key, value, label, is_public)
  select key, value, label, is_public
  from jsonb_populate_recordset(null::public.settings, j->'settings')
  on conflict (key) do update set value = excluded.value, label = excluded.label,
    is_public = excluded.is_public, updated_at = now();
  get diagnostics n_set = row_count;

  insert into public.activity_log (actor, action, entity, detail)
  values ('importer', 'seed.import', 'content',
          format('%s stories, %s videos, %s shows', n_stories, n_videos, n_shows));

  return jsonb_build_object(
    'sections', n_sections, 'authors', n_authors, 'stories', n_stories, 'videos', n_videos,
    'shows', n_shows, 'schedule', n_sched, 'podcasts', n_pods, 'presenters', n_pres,
    'ticker', n_tick, 'settings', n_set);
end $$;

revoke all on function public.import_seed(jsonb) from public, anon, authenticated;
