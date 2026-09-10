-- GDN and GDN-2 are separate operator families. Correct the legacy rows that
-- were swept into the 2026-09-10 bulk completion.
UPDATE tasks
SET task_type = 'operator',
    operator_ids = 'chunk_gdr_fwd',
    updated_at = '2026-09-10T11:56:00.000Z'
WHERE id = 'task-1a90ffa7-3'
  AND NOT EXISTS (
    SELECT 1 FROM audit_entries
    WHERE entity = 'project'
      AND entity_id = 'gdn2-separation-2026-09-10'
      AND action = 'project.gdn2_correction'
  );

UPDATE tasks
SET title = 'GDN-2正向大融合算子',
    task_type = 'operator',
    operator_ids = 'chunk_gdn2_fwd',
    updated_at = '2026-09-10T11:56:00.000Z'
WHERE id = 'task-37e61f4f-4'
  AND NOT EXISTS (
    SELECT 1 FROM audit_entries
    WHERE entity = 'project'
      AND entity_id = 'gdn2-separation-2026-09-10'
      AND action = 'project.gdn2_correction'
  );

UPDATE tasks
SET title = 'GDN-2反向大融合算子',
    status = 'todo',
    risk = '高',
    done_date = '',
    task_type = 'operator',
    operator_ids = 'chunk_gdn2_bwd',
    updated_at = '2026-09-10T11:56:00.000Z'
WHERE id = 'task-1c185a99-5'
  AND NOT EXISTS (
    SELECT 1 FROM audit_entries
    WHERE entity = 'project'
      AND entity_id = 'gdn2-separation-2026-09-10'
      AND action = 'project.gdn2_correction'
  );

INSERT INTO audit_entries(ts, action, entity, entity_id, summary, detail, source)
SELECT
  '2026-09-10T11:56:00.000Z',
  'project.gdn2_correction',
  'project',
  'gdn2-separation-2026-09-10',
  '区分 GDN 与 GDN-2，并撤销 GDN-2 反向的未来日期结项',
  '{"reopenedTaskId":"task-1c185a99-5","gdnOperators":["chunk_gdr_fwd","chunk_gdr_bwd"],"gdn2Operators":["chunk_gdn2_fwd","chunk_gdn2_bwd","fused_recurrent_gdn2"]}',
  'd1-migration'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_entries
  WHERE entity = 'project'
    AND entity_id = 'gdn2-separation-2026-09-10'
    AND action = 'project.gdn2_correction'
);

INSERT OR IGNORE INTO project_meta(key, value)
VALUES ('stateVersion', '2026-09-10T11:56:00.000Z');

UPDATE project_meta
SET value = '2026-09-10T11:56:00.000Z'
WHERE key = 'stateVersion'
  AND value < '2026-09-10T11:56:00.000Z';
