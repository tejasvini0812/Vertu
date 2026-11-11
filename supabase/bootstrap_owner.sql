-- Make the first owner. Run once in the Supabase SQL editor after creating your own user
-- (Authentication -> Users -> Add user, with "Auto confirm" on). Replace the email first.
insert into public.admin_users (user_id, role)
select id, 'owner' from auth.users where lower(email) = lower('you@yourdomain.com')
on conflict (user_id) do update set role = 'owner';

-- Check it worked (should return one row):
select u.email, a.role from public.admin_users a join auth.users u on u.id = a.user_id;
