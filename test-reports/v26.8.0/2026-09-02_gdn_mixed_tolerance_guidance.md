# v26.8.0 GDN BF16 混合容差精度标准改进建议

> **结论：建议将逐元素 `matched_ratio` 从唯一验收条件调整为 dtype、输出类型和数值尺度感知的混合判定。** 在相同 200 个泛化用例中，输入范围为 `[-1, 1]` 时出现大量逐点误报；缩小到 `[-0.1, 0.1]` 后，200 个用例全部执行成功，199 个通过，唯一失败为 `dg` 的边界数值误差。

## 1. 背景

v26.6.0 GDN 总体验证报告已经说明：BF16 在 1 附近的相邻可表示数间隔为 `0.0078125`，unit roundoff 为 `0.00390625`；NPU 与 CPU/Triton 的 tiling、归约顺序和最终量化顺序不同，即使数学公式等价，也不要求逐元素二进制一致。

报告还指出，`ct viz` 的 `0.001` 红点阈值只用于定位误差点，不是 BF16 验收标准；最终结论应结合全量相对 L2、余弦相似度、finite 检查和具体模型标准。

参考：[v26.6.0 A2 GDN 总体验证报告](https://github.com/weinachuan/flash-linear-attention-npu-io/blob/main/test-reports/v26.6.0/2026-07-29_gdn_a2_total_validation.md)

## 2. 误报机制

### 2.1 BF16 量化台阶与归约顺序

`dk`、`dg`、`dbeta` 包含跨 token、K/V 维度或反向分支的乘加归约。不同后端的加法树不同，浮点加法不满足结合律，最后一次 BF16 舍入可能相差 1～2 ULP。这个差异属于实现路径的数值误差，不等价于索引、布局或公式错误。

### 2.2 近零值放大逐点相对误差

若逐点相对误差使用 `abs(real-expect)/abs(expect)`，当 `expect` 接近 0 时，单个 BF16 ULP 也会产生很大的相对误差。`[-1, 1]` 输入会扩大归约中间值和梯度的动态范围，触发更多边界量化点，导致 `matched_ratio=0.99` 对少量近零元素过于敏感。

### 2.3 观测结果

在保持 shape、模板组合和随机种子不变的 200 个泛化用例中：

| 输入范围 | 执行成功 | 精度通过 | 主要现象 |
|---|---:|---:|---|
| `[-1, 1]` | 200/200 | 0/200 | `dq/dv` 通过，`dk/dbeta/dg` 逐点匹配大量失败 |
| `[-0.1, 0.1]` | 200/200 | 199/200 | 仅 case 14 的 `dg` 为 `0.982031`，低于 `0.99` |

失败样本的 CT 散点保持在 `y=x` 附近，没有观察到转置、索引错位或整片区域偏移；误差应按数值精度问题处理，而不是按结构性计算错误处理。

## 3. 混合容差标准建议

### 3.1 逐元素判定

建议使用绝对误差、相对误差和 ULP 三者的混合条件，并对近零分母设置尺度下限：

```text
scale = max(abs(expect), scale_floor(dtype, output_type))
pass = abs_error <= abs_tol(dtype, output_type)
    or abs_error <= rel_tol(dtype, output_type) * scale
    or ulp_distance(real, expect) <= ulp_tol(dtype, output_type)
```

其中 `abs_tol`、`rel_tol`、`ulp_tol` 按输出 dtype 和算子输出类型配置；`dk`、`dg`、`dbeta` 等归约密集型梯度不与 `dq/dv` 共用同一组逐点阈值。

### 3.2 张量级判定

逐点 `matched_ratio` 不应作为唯一通过条件。建议同时检查：

- 全量相对 L2；
- 余弦相似度；
- 最大绝对误差和分位数绝对误差；
- finite/non-finite；
- 有效区和无效区分别统计；
- 逐元素结果仅作为诊断项，不直接替代张量级结论。

### 3.3 双标杆和复检语义

`accuracy_lt` 必须要求双标杆指示字段完整存在。缺失 `new_benchmark_indicate` 时，应输出“无法进行双标杆聚合”，不得将所有样本标记为无效后直接汇总为精度 FAIL。对归约密集型输出，建议固定 shape 和 layout，仅随机化输入数值，使用多轮统计结果判断误差是否稳定。

### 3.4 报告呈现

报告应同时保留严格逐点结果和模型级数值结果，并明确区分：

1. 执行错误或卡死；
2. 结构性计算错误；
3. 非二进制等价导致的数值误差；
4. 双标杆数据不完整导致的不可判定。

## 4. 验证结果

- 200 个泛化用例，覆盖 BF16/FP32 scalar、Q/K L2Norm 开关、beta sigmoid 开关、dense/varlen 和多种 GVA 比例；
- `[-0.1, 0.1]` 下 NPU/CPU 执行成功率均为 200/200；
- 输出通过数：`dq 200/200`、`dk 200/200`、`dv 200/200`、`dbeta 200/200`、`dg 199/200`；
- 唯一失败为 `dg` 的 `matched_ratio=0.982031`，未发现结构性布局错误。

## 5. 关联

本报告关联公开 issue [#2](https://github.com/weinachuan/flash-linear-attention-npu-io/issues/2)。
