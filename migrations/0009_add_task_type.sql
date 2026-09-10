ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'unclassified'
  CHECK (task_type IN ('operator', 'engineering', 'unclassified'));

UPDATE tasks
SET task_type = 'operator'
WHERE TRIM(COALESCE(operator_ids, '')) <> '';

UPDATE tasks
SET task_type = 'engineering',
    operator_ids = ''
WHERE id IN ('t12', 't24', 't25')
   OR title IN ('ATK用例整改', 'CI整改', 'readme引导整改', 'README引导整改', 'ctypes性能优化', 'release出包');
