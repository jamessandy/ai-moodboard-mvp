alter table public.profiles
add column if not exists credits_balance int not null default 750;

alter table public.profiles drop constraint if exists profiles_credits_balance_nonnegative;
alter table public.profiles add constraint profiles_credits_balance_nonnegative check (credits_balance >= 0);

-- Preserve each existing user's unused welcome allowance during the move from
-- image counts to the unified wallet (75 credits per remaining image).
update public.profiles
set credits_balance = greatest(0, 10 - images_used) * 75
where credits_balance = 750;

create table if not exists public.credit_purchases (
  stripe_checkout_session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  credits int not null check (credits > 0),
  amount_total int not null check (amount_total >= 0),
  currency text not null default 'usd',
  created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null,
  balance_after int not null check (balance_after >= 0),
  kind text not null check (kind in ('purchase', 'reserve', 'refund', 'adjustment')),
  action_type text,
  action_id uuid,
  stripe_checkout_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists credit_ledger_action_kind_unique
on public.credit_ledger (action_id, kind) where action_id is not null;

alter table public.credit_purchases enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "users can read own credit purchases" on public.credit_purchases;
create policy "users can read own credit purchases" on public.credit_purchases for select using (auth.uid() = user_id);
drop policy if exists "users can read own credit ledger" on public.credit_ledger;
create policy "users can read own credit ledger" on public.credit_ledger for select using (auth.uid() = user_id);

create or replace function public.grant_purchased_credits(
  p_user_id uuid, p_stripe_checkout_session_id text, p_credits int,
  p_amount_total int, p_currency text default 'usd', p_metadata jsonb default '{}'::jsonb
)
returns table(credits_balance int, already_processed boolean)
language plpgsql security definer set search_path = public as $$
declare v_balance int;
begin
  if p_credits <= 0 then raise exception 'p_credits must be positive'; end if;
  insert into public.profiles (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.credit_purchases (stripe_checkout_session_id, user_id, credits, amount_total, currency)
  values (p_stripe_checkout_session_id, p_user_id, p_credits, p_amount_total, lower(p_currency))
  on conflict (stripe_checkout_session_id) do nothing;
  if not found then
    select p.credits_balance into v_balance from public.profiles p where p.user_id = p_user_id;
    return query select v_balance, true; return;
  end if;
  update public.profiles p set credits_balance = p.credits_balance + p_credits
  where p.user_id = p_user_id returning p.credits_balance into v_balance;
  insert into public.credit_ledger (user_id, amount, balance_after, kind, stripe_checkout_session_id, metadata)
  values (p_user_id, p_credits, v_balance, 'purchase', p_stripe_checkout_session_id, p_metadata);
  return query select v_balance, false;
end; $$;

create or replace function public.reserve_profile_credits(
  p_user_id uuid, p_amount int, p_action_id uuid, p_action_type text, p_metadata jsonb default '{}'::jsonb
)
returns table(reserved boolean, credits_balance int)
language plpgsql security definer set search_path = public as $$
declare v_balance int;
begin
  if p_amount <= 0 then raise exception 'p_amount must be positive'; end if;
  insert into public.profiles (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.profiles p set credits_balance = p.credits_balance - p_amount
  where p.user_id = p_user_id and p.credits_balance >= p_amount
  returning p.credits_balance into v_balance;
  if v_balance is null then
    select p.credits_balance into v_balance from public.profiles p where p.user_id = p_user_id;
    return query select false, coalesce(v_balance, 0); return;
  end if;
  insert into public.credit_ledger (user_id, amount, balance_after, kind, action_type, action_id, metadata)
  values (p_user_id, -p_amount, v_balance, 'reserve', p_action_type, p_action_id, p_metadata);
  return query select true, v_balance;
end; $$;

create or replace function public.refund_profile_credits(
  p_user_id uuid, p_amount int, p_action_id uuid, p_action_type text, p_metadata jsonb default '{}'::jsonb
)
returns table(credits_balance int)
language plpgsql security definer set search_path = public as $$
declare v_balance int;
begin
  if p_amount <= 0 then
    select p.credits_balance into v_balance from public.profiles p where p.user_id = p_user_id;
    return query select coalesce(v_balance, 0); return;
  end if;
  -- A refund for an action is idempotent.
  if exists (select 1 from public.credit_ledger l where l.action_id = p_action_id and l.kind = 'refund') then
    select p.credits_balance into v_balance from public.profiles p where p.user_id = p_user_id;
    return query select coalesce(v_balance, 0); return;
  end if;
  update public.profiles p set credits_balance = p.credits_balance + p_amount
  where p.user_id = p_user_id returning p.credits_balance into v_balance;
  insert into public.credit_ledger (user_id, amount, balance_after, kind, action_type, action_id, metadata)
  values (p_user_id, p_amount, v_balance, 'refund', p_action_type, p_action_id, p_metadata);
  return query select v_balance;
end; $$;

revoke all on function public.grant_purchased_credits(uuid,text,int,int,text,jsonb) from public, anon, authenticated;
revoke all on function public.reserve_profile_credits(uuid,int,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.refund_profile_credits(uuid,int,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.grant_purchased_credits(uuid,text,int,int,text,jsonb) to service_role;
grant execute on function public.reserve_profile_credits(uuid,int,uuid,text,jsonb) to service_role;
grant execute on function public.refund_profile_credits(uuid,int,uuid,text,jsonb) to service_role;
