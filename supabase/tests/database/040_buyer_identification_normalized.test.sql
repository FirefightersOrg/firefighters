-- SAN-103: generated normalised document_number / tax_id columns and duplicate detection.
begin;
select plan(14);

insert into auth.users (id, email) values ('a6400000-0000-0000-0000-000000000001', 'norm-admin@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b6400000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000001',
  'Norm admin', 'norm-admin@example.com', 'active');
insert into public.user_roles (user_id, role_id)
select 'b6400000-0000-0000-0000-000000000001', id from public.roles where name = 'admin';

select set_config('request.jwt.claims',
  '{"sub":"a6400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- Schema
select has_column('public', 'buyers', 'document_number_normalized', 'document_number_normalized exists');
select has_column('public', 'buyers', 'tax_id_normalized', 'tax_id_normalized exists');
select has_index('public', 'buyers', 'buyers_document_number_normalized_idx', 'document index exists');
select has_index('public', 'buyers', 'buyers_tax_id_normalized_idx', 'tax id index exists');

-- Normalisation through the audited function (which trims, so " 30111222 " arrives as "30111222")
select public.buyer_create('individual', 'A', 'Dotted', null, '30.111.222', '30-11122233-4') ;
select public.buyer_create('individual', 'B', 'Plain', null, '30111222', '30111222334');
select public.buyer_create('individual', 'C', 'Spaced', null, '  30 111 222  ', null);
select public.buyer_create('business', null, null, 'Letters SA', 'ABC', 'CUIT s/n');
select public.buyer_create('individual', 'E', 'Empty', null, null, null);
select public.buyer_create('individual', 'F', 'Mixed', null, 'DNI 30.111.222', '30-11122233-4');

select is((select document_number_normalized from public.buyers where last_name = 'Dotted'),
  '30111222', 'dots are stripped from the document number');
select is((select tax_id_normalized from public.buyers where last_name = 'Dotted'),
  '30111222334', 'dashes are stripped from the tax id');
select is((select document_number_normalized from public.buyers where last_name = 'Spaced'),
  '30111222', 'spaces are stripped from the document number');
select is((select document_number from public.buyers where last_name = 'Dotted'),
  '30.111.222', 'the typed text is kept');
select is((select document_number_normalized from public.buyers where business_name = 'Letters SA'),
  null, 'a value without digits normalises to NULL');
select is((select tax_id_normalized from public.buyers where business_name = 'Letters SA'),
  null, 'a tax id without digits normalises to NULL');
select ok((select document_number_normalized is null and tax_id_normalized is null
  from public.buyers where last_name = 'Empty'), 'NULL stays NULL');

-- Duplicate detection across formats
select is((select count(*)::int from public.buyers where document_number_normalized = '30111222'), 4,
  'four formats of the same DNI match');
select is((select count(*)::int from public.buyers where tax_id_normalized = '30111222334'), 3,
  'CUIT with and without dashes match');

-- Updating the typed value re-normalises it
select public.buyer_update(
  (select id from public.buyers where last_name = 'Plain'), 'individual', 'B', 'Plain', null,
  '27-99.888.777', null, null, null, null, null,
  (select updated_at from public.buyers where last_name = 'Plain'));
select is((select document_number_normalized from public.buyers where last_name = 'Plain'),
  '2799888777', 'an update re-normalises the generated column');

select * from finish();
rollback;
