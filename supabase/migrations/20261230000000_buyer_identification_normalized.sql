-- SAN-103: normalised buyer identification for duplicate detection.
--
-- Buyers keep document_number / tax_id exactly as typed. Two generated columns hold the digits
-- only (NULL when there are none), so '30.111.222', '30111222' and '30 111 222' compare equal,
-- and so do a CUIT with and without dashes. Being generated, legacy rows are normalised by the
-- ALTER itself and every later insert/update (including the audited buyer_create/buyer_update
-- functions, which are unchanged) keeps them in sync. The duplicate warning is read-side
-- (repositories/parties.ts findBuyersByIdentification) and compares these columns.
-- The indexes are partial and NOT unique: duplicates stay a warning ("create anyway"), not an error.

alter table public.buyers
  add column document_number_normalized text
    generated always as (nullif(regexp_replace(coalesce(document_number, ''), '[^0-9]', '', 'g'), '')) stored,
  add column tax_id_normalized text
    generated always as (nullif(regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g'), '')) stored;

comment on column public.buyers.document_number_normalized is
  'document_number reduced to its digits (NULL when it has none). Generated; used for duplicate detection.';
comment on column public.buyers.tax_id_normalized is
  'tax_id reduced to its digits (NULL when it has none). Generated; used for duplicate detection.';

create index buyers_document_number_normalized_idx on public.buyers (document_number_normalized)
  where document_number_normalized is not null;
create index buyers_tax_id_normalized_idx on public.buyers (tax_id_normalized)
  where tax_id_normalized is not null;
