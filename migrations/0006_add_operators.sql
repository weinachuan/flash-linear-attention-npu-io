ALTER TABLE tasks ADD COLUMN operator_ids TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  owner_rules TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO operators(id, label, aliases, owner_rules, position, active) VALUES
  ('chunk_gated_delta_rule_fwd_h', 'chunk_gated_delta_rule_fwd_h', '["chunk_gated_delta_rule_fwd_h","fwd_h"]', '[{"owner":"方梓阳"}]', 0, 1),
  ('chunk_fwd_o', 'chunk_fwd_o', '["chunk_fwd_o","fwd_o"]', '[{"owner":"吴雨舒"}]', 1, 1),
  ('recompute_wu_fwd', 'recompute_wu_fwd', '["recompute_wu_fwd","recompute_w_u","recompute_wu","recompute"]', '[{"until":"2026-06-30","owner":"方梓阳"},{"owner":"周云飞"}]', 2, 1),
  ('chunk_bwd_dv_local', 'chunk_bwd_dv_local', '["chunk_bwd_dv_local","chunk_dv_local","dv_local"]', '[{"until":"2026-06-18","owner":"陈琳鑫"},{"owner":"叶倩雯"}]', 3, 1),
  ('chunk_bwd_dqkwg', 'chunk_bwd_dqkwg', '["chunk_bwd_dqkwg","dqkwg"]', '[{"until":"2026-06-30","owner":"黄浚哲"},{"owner":"李佳敏"}]', 4, 1),
  ('chunk_gated_delta_rule_bwd_dhu', 'chunk_gated_delta_rule_bwd_dhu', '["chunk_gated_delta_rule_bwd_dhu","dhu"]', '[{"owner":"方梓阳"}]', 5, 1),
  ('prepare_wy_repr_bwd_da', 'prepare_wy_repr_bwd_da', '["prepare_wy_repr_bwd_da","prepare_wy_bwd_da"]', '[{"owner":"杨子奇"}]', 6, 1),
  ('prepare_wy_repr_bwd_full', 'prepare_wy_repr_bwd_full', '["prepare_wy_repr_bwd_full","prepare_wy_bwd_full"]', '[{"until":"2026-06-30","owner":"张硕累"},{"owner":"周云飞"}]', 7, 1),
  ('causal_conv1d_fwd', 'causal_conv1d_fwd', '["causal_conv1d_fwd","causal_conv1d TND","TND 转 NTD"]', '[]', 8, 1),
  ('causal_conv1d_bwd', 'causal_conv1d_bwd', '["causal_conv1d_bwd","causal_conv1d bwd"]', '[]', 9, 1),
  ('solve_tril_npu', 'solve_tril_npu', '["solve_tril_npu","solve_tril","solve_tri"]', '[]', 10, 1),
  ('kimi_delta_attention_triton', 'kimi_delta_attention_triton', '["kimi_delta_attention","KDA triton","KDA"]', '[]', 11, 1);
