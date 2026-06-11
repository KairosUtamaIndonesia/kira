ALTER TABLE sessions ADD COLUMN root_kind TEXT NOT NULL DEFAULT 'project_folder' CHECK (root_kind IN ('project_folder', 'worktree'));
ALTER TABLE sessions ADD COLUMN worktree_path TEXT NULL;
ALTER TABLE sessions ADD COLUMN branch_name TEXT NULL;

CREATE UNIQUE INDEX sessions_project_id_name_idx ON sessions(project_id, name);
CREATE UNIQUE INDEX sessions_worktree_path_idx ON sessions(worktree_path) WHERE worktree_path IS NOT NULL;
