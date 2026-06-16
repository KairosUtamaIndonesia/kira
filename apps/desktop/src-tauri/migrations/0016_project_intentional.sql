-- Intentional projects are explicitly created by the user from the Cowork
-- sidebar. Non-intentional projects are auto-created on first message and
-- exist only to hold their thread — they stay hidden from the Projects
-- section in the sidebar.
ALTER TABLE projects ADD COLUMN intentional INTEGER NOT NULL DEFAULT 0;
