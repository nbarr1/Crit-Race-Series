-- Correct the spelling of the park name from "Connestee" to "Conestee".
-- The original venue row comes from 20261104000400_defaults.sql, which is
-- already applied, so this migration updates the stored data instead of
-- editing that file.

update public.venues
set name = replace(name, 'Connestee', 'Conestee')
where name like '%Connestee%';

update public.seasons
set name = replace(name, 'Connestee', 'Conestee')
where name like '%Connestee%';
