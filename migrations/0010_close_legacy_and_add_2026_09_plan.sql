-- The original 61 tasks were confirmed complete on their committed dates.
UPDATE tasks
SET status = 'done',
    risk = '低',
    done_date = CASE
      WHEN TRIM(COALESCE(recommit_date, '')) <> '' THEN recommit_date
      ELSE end_date
    END,
    updated_at = '2026-09-10T08:30:00.000Z'
WHERE id IN (
  't01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10',
  't11', 't12', 't13', 't14', 't15', 't16', 't17', 't18', 't19', 't20',
  't21', 't22', 't23', 't24', 't25', 't26', 't27', 't28', 't29', 't30',
  't31', 't32', 't33', 't34', 't36', 't38', 't39', 't40', 't41',
  't42-dqkwg-regbase', 't42-dv-local-regbase', 't42-wy-da-regbase',
  't42-fwd-h-regbase', 't42-fwd-o-regbase', 't42-dhu-regbase', 't42-recompute-regbase',
  'task-99783b7d-9', 'task-c68c51bd-5', 'task-e55bdf4f-a', 'task-eb990424-0',
  'task-82c8d5b4-6', 'task-ec636b65-5', 'task-3f99a94a-1', 'task-ca923fc4-9',
  'task-1d143d79-6', 'task-a38b0ff5-5', 'task-1a90ffa7-3', 'task-51c759bd-0',
  'task-37e61f4f-4', 'task-1c185a99-5', 'task-1c46c247-8'
)
AND NOT EXISTS (
  SELECT 1 FROM tasks
  WHERE id = 'plan-20260915-gdn-fwd-a23'
);

INSERT OR IGNORE INTO groups(id, title, due_date, start_date, end_date, position) VALUES
  ('group-2026-09-15', '09-15转测', '2026-09-15', '2026-09-15', '2026-09-15', 7),
  ('group-2026-09-22', '09-22转测', '2026-09-22', '2026-09-22', '2026-09-22', 8),
  ('group-2026-10-30', '10-30转测', '2026-10-30', '2026-10-30', '2026-10-30', 9),
  ('group-2026-11-15', '11-15转测', '2026-11-15', '2026-11-15', '2026-11-15', 10),
  ('group-2026-11-30', '11-30转测', '2026-11-30', '2026-11-30', '2026-11-30', 11),
  ('group-unscheduled', '待排期', '', '', '', 12);

INSERT OR IGNORE INTO people(id, name, position, placeholder, pl) VALUES
  ('person-chen-haowen', '陈昊文', 23, 0, '陈琳鑫'),
  ('person-li-zhuo', '李卓', 24, 0, '陈琳鑫'),
  ('person-liu-jie', '刘杰', 25, 0, '陈琳鑫');

UPDATE operators
SET aliases = '["chunk_gdr_fwd","gdr_fwd","gdn_fwd","chunk_gated_delta_rule_fwd"]'
WHERE id = 'chunk_gdr_fwd'
  AND NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE id = 'plan-20260915-gdn-fwd-a23'
  );

UPDATE operators
SET aliases = '["chunk_gdr_bwd","gdr_bwd","gdn_bwd","chunk_gated_delta_rule_bwd"]'
WHERE id = 'chunk_gdr_bwd'
  AND NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE id = 'plan-20260915-gdn-fwd-a23'
  );

INSERT OR IGNORE INTO operators(id, label, aliases, owner_rules, position, active) VALUES
  ('pre_process_fwd_kernel_merged', 'pre_process_fwd_kernel_merged', '["pre_process_fwd_kernel_merged"]', '[]', 16, 1),
  ('merge_fwd_bwd_kernel', 'merge_fwd_bwd_kernel', '["merge_fwd_bwd_kernel"]', '[]', 17, 1),
  ('pre_process_bwd_kernel_merged', 'pre_process_bwd_kernel_merged', '["pre_process_bwd_kernel_merged"]', '[]', 18, 1),
  ('chunk_fwd_h', 'chunk_fwd_h', '["chunk_fwd_h"]', '[]', 19, 1),
  ('chunk_gdn2_fwd', 'chunk_gdn2_fwd', '["chunk_gdn2_fwd","gdn2_fwd"]', '[]', 20, 1),
  ('chunk_gdn2_bwd', 'chunk_gdn2_bwd', '["chunk_gdn2_bwd","gdn2_bwd"]', '[]', 21, 1),
  ('fused_recurrent_gdn2', 'fused_recurrent_gdn2', '["fused_recurrent_gdn2","recurrent_gdn2"]', '[]', 22, 1);

INSERT OR IGNORE INTO tasks(
  id, title, scope, target, owner, status, risk, priority, group_id, special_id,
  start_date, end_date, evidence, dependencies, pr_required, pr_link, test_report, notes,
  recommit_date, done_date, task_type, operator_ids, position, created_at, updated_at
) VALUES
  ('plan-20260915-gdn-fwd-a23', 'GDN正向大融合算子 A2/A3', 'A2/A3', '', '陈昊文', 'doing', '高', 'P0', 'group-2026-09-15', 'special-d81ecad0-e', '2026-09-10', '2026-09-15', '[]', '[]', 1, '', '', '新阶段任务；旧阶段已按原承诺结项', '', '', 'operator', 'chunk_gdr_fwd', 62, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20260915-gdn-fwd-a5', 'GDN正向大融合算子 A5', 'A5', '', '李卓', 'doing', '高', 'P0', 'group-2026-09-15', 'special-d81ecad0-e', '2026-09-10', '2026-09-15', '[]', '[]', 1, '', '', '新阶段任务；旧阶段已按原承诺结项', '', '', 'operator', 'chunk_gdr_fwd', 63, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20260915-gdn-bwd-a5', 'GDN反向大融合算子 A5', 'A5', '', '张硕累', 'doing', '高', 'P0', 'group-2026-09-15', 'special-d81ecad0-e', '2026-09-10', '2026-09-15', '[]', '[]', 1, '', '', '新阶段任务；旧阶段已按原承诺结项', '', '', 'operator', 'chunk_gdr_bwd', 64, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20260922-kda-fwd-a5', 'KDA正向大融合算子 A5', 'A5', '', '魏纳川', 'doing', '中', 'P0', 'group-2026-09-22', 'special-d81ecad0-e', '2026-09-10', '2026-09-22', '[]', '[]', 1, '', '', '新阶段任务；旧阶段已按原承诺结项', '', '', 'operator', 'chunk_kda_fwd', 65, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20260922-kda-bwd-a5', 'KDA反向大融合算子 A5', 'A5', '', '吴雨舒', 'doing', '中', 'P0', 'group-2026-09-22', 'special-d81ecad0-e', '2026-09-10', '2026-09-22', '[]', '[]', 1, '', '', '新阶段任务；旧阶段已按原承诺结项', '', '', 'operator', 'chunk_kda_bwd', 66, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-unscheduled-atk-cases', 'ATK用例整改', '', '', '黄浚哲', 'todo', '高', 'P1', 'group-unscheduled', NULL, '2026-09-10', '', '[]', '[]', 1, '', '', 'DDL待定', '', '', 'engineering', '', 67, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-unscheduled-ci', 'CI整改', '', '', '黄浚哲', 'todo', '高', 'P1', 'group-unscheduled', NULL, '2026-09-10', '', '[]', '[]', 1, '', '', 'DDL待定', '', '', 'engineering', '', 68, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-unscheduled-readme', 'readme引导整改', '', '', '方梓阳', 'todo', '高', 'P1', 'group-unscheduled', NULL, '2026-09-10', '', '[]', '[]', 1, '', '', 'DDL待定', '', '', 'engineering', '', 69, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-unscheduled-ctypes', 'ctypes性能优化', '', '', '方梓阳', 'todo', '高', 'P1', 'group-unscheduled', NULL, '2026-09-10', '', '[]', '[]', 1, '', '', 'DDL待定', '', '', 'engineering', '', 70, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-unscheduled-release', 'release出包', '', '', '方梓阳', 'todo', '高', 'P1', 'group-unscheduled', NULL, '2026-09-10', '', '[]', '[]', 0, '', '', 'DDL待定', '', '', 'engineering', '', 71, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20260930-cp-sharding', 'CP切分', 'GDN/KDA共用', '', '魏纳川/张硕累', 'doing', '中', 'P0', 'group-946fc4c0-2', 'special-d81ecad0-e', '2026-09-10', '2026-09-30', '[]', '[]', 1, '', '', '关联三个GDN/KDA共用算子', '', '', 'operator', 'pre_process_fwd_kernel_merged/merge_fwd_bwd_kernel/pre_process_bwd_kernel_merged', 72, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20261030-gdn-fwd-perf-a23', 'GDN正向大融合算子性能优化 A2/A3', 'A2/A3', '0.4x H20', '刘杰', 'doing', '中', 'P0', 'group-2026-10-30', 'special-d81ecad0-e', '2026-09-10', '2026-10-30', '[]', '[]', 1, '', '', '', '', '', 'operator', 'chunk_gdr_fwd', 73, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20261115-gdn-bwd-perf-a23', 'GDN反向大融合算子性能优化 A2/A3', 'A2/A3', '0.4x H20', '刘杰', 'doing', '中', 'P0', 'group-2026-11-15', 'special-d81ecad0-e', '2026-09-10', '2026-11-15', '[]', '[]', 1, '', '', '', '', '', 'operator', 'chunk_gdr_bwd', 74, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20260930-solve-tril-a23', 'A2/A3 solve_tril性能优化', 'A2/A3', '性能优化', '陈昊文', 'doing', '中', 'P0', 'group-946fc4c0-2', NULL, '2026-09-10', '2026-09-30', '[]', '[]', 1, '', '', '', '', '', 'operator', 'solve_tril', 75, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20261030-chunk-fwd-h-cp-a23', 'A2/A3 chunk_fwd_h 核内CP切分方案', 'A2/A3', '核内CP切分', '待排人力', 'todo', '高', 'P0', 'group-2026-10-30', 'special-d81ecad0-e', '2026-09-10', '2026-10-30', '[]', '[]', 1, '', '', '责任人待定', '', '', 'operator', 'chunk_fwd_h', 76, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-20261130-chunk-fwd-h-cp-a5', 'A5 chunk_fwd_h 核内CP切分方案', 'A5', '核内CP切分', '待排人力', 'todo', '高', 'P0', 'group-2026-11-30', 'special-d81ecad0-e', '2026-09-10', '2026-11-30', '[]', '[]', 1, '', '', '责任人待定', '', '', 'operator', 'chunk_fwd_h', 77, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z'),
  ('plan-unscheduled-gdn2-all', 'GDN-2正反向 + recurrent A2/A3/A5', 'A2/A3/A5', '正向、反向及recurrent', '待排人力', 'todo', '高', 'P1', 'group-unscheduled', 'special-d81ecad0-e', '2026-09-10', '', '[]', '[]', 1, '', '', '责任人及DDL待定', '', '', 'operator', 'chunk_gdn2_fwd/chunk_gdn2_bwd/fused_recurrent_gdn2', 78, '2026-09-10T08:30:00.000Z', '2026-09-10T08:30:00.000Z');

INSERT OR IGNORE INTO task_segments(id, task_id, start_date, end_date, reason, position) VALUES
  ('seg-plan-20260915-gdn-fwd-a23-0', 'plan-20260915-gdn-fwd-a23', '2026-09-10', '2026-09-15', '', 0),
  ('seg-plan-20260915-gdn-fwd-a5-0', 'plan-20260915-gdn-fwd-a5', '2026-09-10', '2026-09-15', '', 0),
  ('seg-plan-20260915-gdn-bwd-a5-0', 'plan-20260915-gdn-bwd-a5', '2026-09-10', '2026-09-15', '', 0),
  ('seg-plan-20260922-kda-fwd-a5-0', 'plan-20260922-kda-fwd-a5', '2026-09-10', '2026-09-22', '', 0),
  ('seg-plan-20260922-kda-bwd-a5-0', 'plan-20260922-kda-bwd-a5', '2026-09-10', '2026-09-22', '', 0),
  ('seg-plan-20260930-cp-sharding-0', 'plan-20260930-cp-sharding', '2026-09-10', '2026-09-30', '', 0),
  ('seg-plan-20261030-gdn-fwd-perf-a23-0', 'plan-20261030-gdn-fwd-perf-a23', '2026-09-10', '2026-10-30', '', 0),
  ('seg-plan-20261115-gdn-bwd-perf-a23-0', 'plan-20261115-gdn-bwd-perf-a23', '2026-09-10', '2026-11-15', '', 0),
  ('seg-plan-20260930-solve-tril-a23-0', 'plan-20260930-solve-tril-a23', '2026-09-10', '2026-09-30', '', 0),
  ('seg-plan-20261030-chunk-fwd-h-cp-a23-0', 'plan-20261030-chunk-fwd-h-cp-a23', '2026-09-10', '2026-10-30', '', 0),
  ('seg-plan-20261130-chunk-fwd-h-cp-a5-0', 'plan-20261130-chunk-fwd-h-cp-a5', '2026-09-10', '2026-11-30', '', 0);

INSERT INTO audit_entries(ts, action, entity, entity_id, summary, detail, source)
SELECT
  '2026-09-10T08:30:00.000Z',
  'project.plan_refresh',
  'project',
  'plan-2026-09-10',
  '按承诺日期完成原61项任务，并新增17项当前计划',
  '{"completedTaskCount":61,"newTaskCount":17,"newOperatorCount":7,"newPeopleCount":3}',
  'd1-migration'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_entries
  WHERE entity = 'project'
    AND entity_id = 'plan-2026-09-10'
    AND action = 'project.plan_refresh'
);

INSERT OR IGNORE INTO project_meta(key, value)
VALUES ('stateVersion', '2026-09-10T08:30:00.000Z');

UPDATE project_meta
SET value = '2026-09-10T08:30:00.000Z'
WHERE key = 'stateVersion'
  AND value < '2026-09-10T08:30:00.000Z';
