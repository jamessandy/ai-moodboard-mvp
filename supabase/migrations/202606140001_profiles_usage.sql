create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  images_used int not null default 0 check (images_used >= 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles for select
using (auth.uid() = user_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profiles on auth.users;
create trigger on_auth_user_created_profiles
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.reserve_profile_images(
  p_user_id uuid,
  p_count int,
  p_limit int default 10
)
returns table(images_used int, limit_reached boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_count <= 0 then
    raise exception 'p_count must be positive';
  end if;

  insert into public.profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  return query
  with updated as (
    update public.profiles profile
    set images_used = profile.images_used + p_count
    where profile.user_id = p_user_id
      and profile.images_used + p_count <= p_limit
    returning profile.images_used
  ),
  current_profile as (
    select profile.images_used
    from public.profiles profile
    where profile.user_id = p_user_id
  )
  select
    coalesce((select updated.images_used from updated), current_profile.images_used),
    not exists (select 1 from updated)
  from current_profile;
end;
$$;

create or replace function public.refund_profile_images(
  p_user_id uuid,
  p_count int
)
returns table(images_used int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_count <= 0 then
    return query
    select profile.images_used
    from public.profiles profile
    where profile.user_id = p_user_id;
    return;
  end if;

  return query
  update public.profiles profile
  set images_used = greatest(0, profile.images_used - p_count)
  where profile.user_id = p_user_id
  returning profile.images_used;
end;
$$;

revoke all on function public.reserve_profile_images(uuid, int, int) from public, anon, authenticated;
revoke all on function public.refund_profile_images(uuid, int) from public, anon, authenticated;
grant execute on function public.reserve_profile_images(uuid, int, int) to service_role;
grant execute on function public.refund_profile_images(uuid, int) to service_role;
