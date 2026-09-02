# v26.8.0 A5 GDN 混合容差精度验证报告

> **结论：当前算子执行稳定；`[-1,1]` 下的逐点混合容差会对 BF16 归约输出产生明显误报。将输入范围缩小到 `[-0.1,0.1]` 后，200 个泛化用例中 199 个通过，唯一失败为 `dg` 的边界数值误差。建议将逐元素 `matched_ratio` 从唯一验收条件调整为 dtype、输出类型和数值尺度感知的混合判定。**

## 1. 归档信息

| 项目 | 内容 |
|---|---|
| 测试日期 | 2026-09-02 |
| 报告版本 | v26.8.0 |
| 被测算子 | AscendC `chunk_gdn_bwd_finalize` |
| 硬件范围 | A5 Ascend950PR |
| 测试类型 | 200 个泛化用例、双标杆精度对比、失败 case 复核 |
| 精度口径 | ATK 原生 `accuracy`，NPU 为 real，CPU 为 expect |
| 输出顺序 | `dq, dk, dv, dbeta, dg` |
| 关联 issue | [#2](https://github.com/weinachuan/flash-linear-attention-npu-io/issues/2) |

报告格式和精度分析口径参考：[v26.6.0 A2 GDN 总体验证报告](https://github.com/weinachuan/flash-linear-attention-npu-io/blob/main/test-reports/v26.6.0/2026-07-29_gdn_a2_total_validation.md)。

## 2. 总结论

- `[-1,1]`：200/200 执行成功，但严格逐点精度通过数为 0/200；失败集中在 `dk/dbeta/dg`。
- `[-0.1,0.1]`：200/200 执行成功，199/200 case 通过；`dq/dk/dv/dbeta` 全部通过，`dg` 为 199/200。
- 所有算子调用均在 1 分钟内打印完成标记，无卡死、无运行时错误。
- CT 对代表性 dense/varlen、BF16/FP32 和模板组合进行 NPU=`real`、CPU=`expect` 对比，散点均紧贴 `y=x`，没有发现转置、索引错位、符号翻转或整片区域偏移。
- 当前失败表现为归约顺序、BF16 最终量化和近零值逐点相对误差共同造成的数值误差，不能直接判定为 kernel 公式或内存布局错误。

## 3. 环境与测试口径

### 3.1 测试矩阵

| 维度 | 覆盖 |
|---|---|
| 模板组合 | BF16/FP32 scalar × Q/K L2Norm 开关 × beta sigmoid 开关，共 8 组 |
| 每组数量 | 25 |
| layout | dense 180 条，varlen 20 条 |
| batch | B=1 119 条，B=2 81 条 |
| GVA 比例 | ratio 1/2/3/4 |
| 序列长度 | T=64、65、96、127、128、129、160、191、192、255、256 |
| 输入 dtype | q/k/v/v_new/do/du/h/dh/a 为 BF16；g/beta/beta_raw 为 BF16 或 FP32 |
| 输出 dtype | `dq/dk/dv` 为 BF16；`dbeta/dg` 跟随对应 scalar dtype |
| 输入范围 | `[-1,1]` 与 `[-0.1,0.1]` |
| 随机性 | 两轮保持相同 shape、模板组合、case 顺序和 seed |

### 3.2 判定流程

NPU 和 CPU 使用 ATK 双节点执行，精度标准来自 case 配置中的 `mixed_tolerance_bm`。每个 NPU case 在算子完成并执行同步后立即打印完成标记。精度失败按以下顺序复核：保存输出、使用 CT 检查结构性误差、区分执行错误与数值误差。

## 4. 术语与误差来源

| 术语 | 本报告含义 |
|---|---|
| matched ratio | 满足 ATK 逐点误差条件的元素比例 |
| 相对 L2 | `L2(real-expect) / L2(expect)`，衡量整体误差 |
| ULP | 当前浮点数附近相邻可表示数之间的间隔 |
| 归约密集型输出 | 跨 token、K/V 维度或多个反向分支累加得到的输出，如 `dk/dg/dbeta` |
| 有效区 | 参与当前 case 语义计算的 token、head 和布局区域 |

### 4.1 BF16 量化和归约顺序

v26.6.0 报告指出，BF16 在 1 附近的相邻可表示数间隔为 `0.0078125`，unit roundoff 为 `0.00390625`。NPU 与 CPU/Triton 的 tiling、归约树和最终 cast 顺序不同，浮点加法不满足结合律，因此数学等价的实现可能相差 1～2 ULP。

### 4.2 近零值的逐点相对误差放大

当参考值接近 0 时，`abs(real-expect)/abs(expect)` 的分母过小，单个 ULP 也会产生很大的逐点相对误差。`[-1,1]` 还会扩大归约中间值和梯度动态范围，使更多元素落在量化边界上，导致 `matched_ratio=0.99` 对少量近零元素过于敏感。

## 5. 精度验证

### 5.1 `[-1,1]` 基线

| 输出 | 通过 | 失败 |
|---|---:|---:|
| `dq` | 200 | 0 |
| `dk` | 2 | 198 |
| `dv` | 200 | 0 |
| `dbeta` | 4 | 196 |
| `dg` | 0 | 200 |

代表性失败 case 的整体相对 L2 约为 `0.3%～0.5%`，CT 散点保持在 `y=x` 附近，未发现结构性错误。

### 5.2 `[-0.1,0.1]` 泛化结果

| 输出 | 通过 | 失败 |
|---|---:|---:|
| `dq` | 200 | 0 |
| `dk` | 200 | 0 |
| `dv` | 200 | 0 |
| `dbeta` | 200 | 0 |
| `dg` | 199 | 1 |

case 14 的 `dg` 结果为：

```text
matched_ratio = 0.982031226
expected       = 0.99
```

该 case 单独保存输出后重新执行成功；CT 对比仍显示散点围绕 `y=x`，因此属于边界数值误差。

### 5.3 两个输入范围的对比

| 输入范围 | 执行成功 | case 通过 | 结论 |
|---|---:|---:|---|
| `[-1,1]` | 200/200 | 0/200 | 逐点标准对 BF16 归约输出产生大量误报 |
| `[-0.1,0.1]` | 200/200 | 199/200 | 误报显著减少，仍有一个 `dg` 边界 case |

输入范围改变没有改变算子接口、布局或执行路径；通过率的变化说明当前失败与数值尺度和判定口径高度相关。

## 6. 混合容差标准改进建议

### 6.1 逐元素判定

建议使用绝对误差、相对误差和 ULP 三者的混合条件，并对近零分母设置尺度下限：

```text
scale = max(abs(expect), scale_floor(dtype, output_type))
pass = abs_error <= abs_tol(dtype, output_type)
    or abs_error <= rel_tol(dtype, output_type) * scale
    or ulp_distance(real, expect) <= ulp_tol(dtype, output_type)
```

`abs_tol`、`rel_tol`、`ulp_tol` 应按输出 dtype 和输出类型配置。`dk/dg/dbeta` 等归约密集型梯度不应与 `dq/dv` 共用同一组逐点阈值。

### 6.2 张量级判定

逐点 `matched_ratio` 应作为诊断项，而非唯一验收条件。最终判定建议同时检查：

- 全量相对 L2；
- 余弦相似度；
- 最大绝对误差和分位数绝对误差；
- finite/non-finite；
- 有效区和无效区分别统计。

### 6.3 双标杆和复检语义

`accuracy_lt` 必须要求双标杆指示字段完整存在。缺失 `new_benchmark_indicate` 时，应输出“无法进行双标杆聚合”，不能将所有样本标记为无效后直接汇总为精度 FAIL。对归约密集型输出，建议固定 shape/layout，仅随机化输入数值并进行多轮统计。

### 6.4 报告分类

报告应明确区分执行错误或卡死、结构性计算错误、非二进制等价导致的数值误差，以及双标杆数据不完整导致的不可判定。

## 7. 关联

本报告对应公开 issue [#2](https://github.com/weinachuan/flash-linear-attention-npu-io/issues/2)，由 PR [#3](https://github.com/weinachuan/flash-linear-attention-npu-io/pull/3) 提交。
