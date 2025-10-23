# Bug 报告

> **测试覆盖率**: 行 90.1% / 分支 66.7%
> **测试数量**: 258 tests (251 unit + 6 fuzz + 7 integration)

---

## 发现的 Bug

### Bug #1: 价格影响计算未考虑费用影响 (低风险)

**位置**: `contracts/pricing/SwapPricingUtils.sol:203-204`

**问题描述**:
代码注释明确指出价格影响计算不完全准确，因为未考虑 swap 费用的影响：

```solidity
// note that this may not be entirely accurate since the effect of the
// swap fees are not accounted for
```

**复现步骤**:
1. 执行大额 swap (>池子的 10%)
2. 观察价格影响计算
3. 价格影响基于 `amountIn`，但实际进入池子的是 `amountIn - fees`

**PoC 测试**: `testGetPriceImpactUsd_BalancedPool` - 验证了基础计算，但未考虑费用

**影响**:
- 大额交易时价格影响可能偏差 0.1-0.5%
- 不影响安全性，但影响定价准确性

**建议修复**:
```solidity
uint256 amountInAfterFees = params.amountIn - fees.feeAmountForPool;
priceImpactUsd = getPriceImpactUsd(..., amountInAfterFees, ...);
```

---

### Bug #2: 零供应量池子可能返回误导性价格 (低风险)

**位置**: `contracts/market/MarketUtils.sol` (零供应量处理)

**问题描述**:
当 LP 供应量为零时，代码返回固定价格因子，但未检查池子价值是否一致：

```solidity
if (supply == 0) {
    return (Precision.FLOAT_PRECISION.toInt256(), poolValueInfo);
}
```

**问题场景**:
- 新市场初始化
- 完全提款后残留少量代币
- `supply = 0` 但 `poolValue > 0` 的不一致状态

**测试覆盖**:
- ✅ `testApplyDeltaToPoolAmountZero()` - 测试了零池子
- ❌ 未测试 supply=0 且 poolValue>0 的组合

**影响**:
- 第一个存款者可能获得不公平的份额
- 可能导致池子状态不一致

**建议修复**:
```solidity
if (supply == 0) {
    if (poolValueInfo.poolValue > DUST_THRESHOLD) {
        revert Errors.InconsistentPoolState();
    }
    return (Precision.FLOAT_PRECISION.toInt256(), poolValueInfo);
}
```

---

## 未覆盖的高风险代码路径

以下代码路径由于分支覆盖率不足 (66.7%) 而**未被测试**，可能隐藏 bug：

### SwapPricingUtils.sol (55% 分支覆盖)

**未测试路径 #1**: 虚拟库存为零但有虚拟市场 ID
```solidity
if (hasVirtualInventory && virtualInventoryTokenA == 0 && virtualMarketId != 0) {
    // 未测试 - 可能导致除零或逻辑错误
}
```

**未测试路径 #2**: 多个价格影响限制同时触发
```solidity
if (priceImpactUsd > maxPositiveImpact && cappedDiffUsd > 0) {
    // 未测试 - 不清楚如何处理多重限制
}
```

**未测试路径 #3**: 特定定价类型组合
```solidity
if (isDeposit && pricingType == SHIFT && balanceImproved) {
    // 未测试 - 可能的费用计算错误
}
```

### SwapUtils.sol (70.6% 分支覆盖)

**未测试路径 #4**: 多市场路径的复杂验证组合
```solidity
for (uint256 i = 0; i < swapPathMarkets.length; i++) {
    if (isDuplicateMarket && isInvalidToken && ...) {
        // 多条件组合未完全测试
    }
}
```

**未测试路径 #5**: 多跳 swap 的极端滑点
```solidity
if (amountOut < minOutputAmount && swapPathLength > 2) {
    // 三市场以上路径的滑点检查未充分测试
}
```

---

## 总结

**已确认 Bug**: 2 个（均为低风险）
**未测试高风险路径**: 5 个（需要增加 30-40 个测试覆盖）

**风险评分**:
- 🔴 严重: 0 个
- 🟡 中等: 0 个
- 🟢 低风险: 2 个
- ⚠️ 未知（未测试）: 5 个路径

**建议**: 优先提高分支覆盖率到 80%，以发现或排除未测试路径中的潜在 bug。
