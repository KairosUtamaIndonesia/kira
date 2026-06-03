INSERT INTO terminal_panel_state (panel_id, working_directory, shell)
SELECT
  workspace_panels.id,
  projects.folder_path,
  NULL
FROM workspace_panels
INNER JOIN sessions ON sessions.id = workspace_panels.session_id
INNER JOIN projects ON projects.id = sessions.project_id
LEFT JOIN terminal_panel_state ON terminal_panel_state.panel_id = workspace_panels.id
WHERE workspace_panels.kind = 'terminal'
  AND terminal_panel_state.panel_id IS NULL;
