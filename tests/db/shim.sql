-- Atrapa elementów Supabase, których nie ma w czystym Postgresie.
-- Służy WYŁĄCZNIE testom lokalnym (PGlite). Nie trafia do produkcji.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);

-- auth.uid() / auth.role() czytają "claims" ustawiane przez testy,
-- tak jak PostgREST robi to na podstawie tokenu JWT.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/') $$;

-- pg_net: zamiast prawdziwych wywołań HTTP zapisujemy je w tabeli,
-- żeby testy mogły sprawdzić, czy trigger wysłał właściwe zdarzenie.
create schema net;
create table net._calls (id serial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}')
  returns bigint language plpgsql as $$
begin
  insert into net._calls(url, body, headers) values (url, body, headers);
  return 1;
end $$;

-- Supabase domyślnie nadaje te uprawnienia nowym obiektom w schemacie public.
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
