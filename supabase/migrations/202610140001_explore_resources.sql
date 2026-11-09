-- Explore & Discovery: curated creative resources, visual references, stock assets, templates
create table if not exists public.explore_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null check (category in (
    'inspo_reference',
    'video_clips',
    'cover_art',
    'design_editorial',
    'photography',
    'fonts',
    'color_codes',
    'tools',
    'inspiration',
    'visual_reference',
    'stock',
    'mockups_templates'
  )),
  media_type text not null check (media_type in ('images', 'videos', 'design', 'fonts', 'template', 'tool')),
  item_kind text not null check (item_kind in ('canvas_asset', 'board_template', 'external_resource')),
  media_url text,
  source_name text,
  source_url text,
  palette jsonb not null default '[]',
  extracted_tags text[] not null default '{}',
  font_config jsonb,
  template_slug text,
  created_at timestamptz not null default now()
);

alter table public.explore_items enable row level security;

-- Public read for both authenticated and anonymous users
drop policy if exists "explore items are publicly readable" on public.explore_items;
create policy "explore items are publicly readable"
on public.explore_items for select
using (true);
