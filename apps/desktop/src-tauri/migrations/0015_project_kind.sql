-- Projects are either developer projects ('code') or auto-created Cowork
-- conversation containers ('cowork'). Each App Shell mode only surfaces its
-- own kind.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'code';

-- Backfill: Cowork projects predating this column live in the app-managed
-- `coworks` directory.
UPDATE projects
SET kind = 'cowork'
WHERE folder_path LIKE '%\coworks\%'
   OR folder_path LIKE '%/coworks/%';
