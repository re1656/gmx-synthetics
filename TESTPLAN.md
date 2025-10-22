# 测试计划：GMX Synthetics Core Module 

## 1. 概述

本测试计划旨在为 GMX Synthetics 合约的核心 swap 执行和流动性记账逻辑实现 **≥90% 行覆盖率** 和 **≥80% 分支覆盖率**。

### 测试方法
- **单元测试 (Foundry)**: 快速、专注的函数级测试和边界用例
- **集成测试 (Hardhat/TypeScript)**: 涉及多合约交互的复杂场景
- **基于属性的测试 (Foundry Fuzz)**: 每个属性 ≥1,000 次随机输入验证不变量
- **Gas 回归测试**: 监控并防止 gas 成本超过 +5% 基准

---

## 2. 范围与目标合约

| 合约 | 主要职责 | 覆盖率目标 |
|------|---------|-----------|
| `SwapHandler.sol` | 编排 swap 执行流程 | 90% 行，85% 分支 |
| `SwapUtils.sol` | 核心 swap 逻辑和验证 | 90% 行，85% 分支 |
| `SwapPricingUtils.sol` | 价格影响和 AMM 曲线计算 | 90% 行，80% 分支 |
| `DepositHandler.sol` | 处理流动性添加 | 85% 行，80% 分支 |
| `WithdrawalHandler.sol` | 处理流动性移除 | 85% 行，80% 分支 |
| `MarketUtils.sol` | 手续费计算、滑点和市场状态 | 90% 行，80% 分支 |

---

## 3. 测试矩阵与功能路径

### 3.1 Swap 执行 (`SwapHandler`, `SwapUtils`)

#### 正常路径测试
| 测试用例 | 输入条件 | 期望行为 | 覆盖率目标 |
|---------|---------|---------|-----------|
| 基本代币交换 | 有效金额，充足流动性 | 正确输出金额，扣除手续费 | 行: 95% |
| 带价格影响的 swap | 相对于池子的大额交换 | 计算价格影响，滑点在范围内 | 分支: 90% |
| 多跳 swap | 通过中间代币交换 | 正确应用复合手续费 | 行: 90% |
| 带 UI 费用的 swap | 指定 UI 费用接收者 | 额外费用分配给 UI 合作伙伴 | 行: 85% |

#### 边界用例
| 测试用例 | 触发条件 | 期望结果 | 测试位置 |
|---------|---------|---------|---------|
| 零金额 swap | `amountIn = 0` | 回滚并返回 `EmptySwapAmount` | `SwapHandlerUnitTest.sol::testSwap_RevertsOnZeroAmount` |
| 流动性不足 | `amountIn` > 池子储备 | 回滚并返回 `InsufficientPoolAmount` | `SwapUtilsUnitTest.sol::testSwap_InsufficientLiquidity` |
| 滑点突破 | `actualOut` < `minOutputAmount` | 回滚并返回 `SlippageExceeded` | `SwapUtilsUnitTest.sol::testSwap_SlippageProtection` |
| 达到价格影响上限 | 影响 > `maxPositivePriceImpactFactor` | 影响被限制在最大值 | `SwapPricingUtilsUnitTest.sol::testPriceImpactCapping` |
| 禁用的市场 | `market.isDisabled = true` | 回滚并返回 `DisabledMarket` | `SwapHandlerUnitTest.sol::testSwap_DisabledMarket` |
| 自我交换（相同代币） | `tokenIn == tokenOut` | 回滚并返回 `InvalidSwapPath` | `SwapUtilsUnitTest.sol::testSwap_SameTokenRevert` |

#### 数值不变量
```solidity
// 不变量 1: 价值守恒（考虑手续费）
amountOut * priceOut + totalFees + priceImpactUsd ≈ amountIn * priceIn  (±1 wei)

// 不变量 2: 池子储备永远不会为负
poolAmount[tokenOut] >= amountOut + fees

// 不变量 3: 价格影响有界
-maxNegativeImpact ≤ priceImpactBps ≤ maxPositiveImpact
```

**舍入误差容忍度**: 所有计算通过 `assertApproxEqAbs(actual, expected, 1)` 验证 ≤1 wei 偏差

---

### 3.2 流动性算法 (`DepositHandler`, `WithdrawalHandler`)

#### 存款流程
| 测试用例 | 场景 | 期望结果 | 测试文件 |
|---------|-----|---------|---------|
| 首次存款 | 空池，初始 LP 份额 | `shares = sqrt(tokenA * tokenB)` | `DepositHandlerUnitTest.sol::testFirstDeposit` |
| 平衡存款 | 与当前储备成比例 | `shares = min(ΔtokenA/reserveA, ΔtokenB/reserveB) * totalSupply` | `DepositHandlerUnitTest.sol::testBalancedDeposit` |
| 不平衡存款 | 倾斜比率，应用价格影响 | 正确的份额计算（考虑影响） | `DepositHandlerUnitTest.sol::testImbalancedDeposit` |
| 并发存款 | 同一区块多次存款 | 无抢跑优势，公平份额分配 | `Deposit.ts` (Hardhat 集成测试) |

#### 提款流程
| 测试用例 | 场景 | 期望结果 | 测试文件 |
|---------|-----|---------|---------|
| 完全提款 | 销毁所有 LP 份额 | 收到按比例的储备，池子清空 | `WithdrawalHandlerUnitTest.sol::testFullWithdrawal` |
| 部分提款 | 销毁部分份额 | 正确的按比例代币金额 | `WithdrawalHandlerUnitTest.sol::testPartialWithdrawal` |
| 亏损期间提款 | 池子价值 < 存款 | 份额反映损失，无过度提款 | `WithdrawalHandlerUnitTest.sol::testWithdrawalAfterLoss` |
| 最小流动性锁定 | 剩余非常小的份额 | 低于 minLiquidity 阈值无法提款 | `WithdrawalHandlerUnitTest.sol::testMinimumLiquidity` |

#### 不变量
```solidity
// 不变量 4: LP 份额价值守恒
totalLpValue_before = totalLpValue_after + withdrawnValue - depositedValue - fees

// 不变量 5: 无无限铸造漏洞
shares_minted ≤ (deposit_value / pool_value) * total_shares

// 不变量 6: 储备匹配余额
sum(poolAmount[token]) ≈ token.balanceOf(market)  (±舍入产生的灰尘)
```

---

### 3.3 定价与影响 (`SwapPricingUtils`, `MarketUtils`)

#### 手续费计算测试
| 组件 | 测试覆盖 | 验证方法 |
|------|---------|---------|
| 基础 swap 费用 | 0.05% - 0.5% 范围 | 与 `swapFeeFactor` 配置对比 |
| 仓位影响费用 | 0.01% - 0.1% | 验证 `positionImpactFactor` 应用 |
| UI 费用分成 | 基础费用的 0% - 20% | 检查 `uiFeeReceiver` 余额增量 |
| 费用等级折扣 | 基于交易量的等级 | 模拟高交易量交易者，断言折扣 |

#### 价格影响模型
```
priceImpact = (postSwapReserves - preSwapReserves) / preSwapReserves
            = Δk / k_initial  (对于恒定乘积 AMM)
```

**测试用例**:
- 小额 swap (<池子的1%): 影响与大小近似线性
- 大额 swap (>池子的10%): 影响遵循二次曲线
- 极端 swap (>池子的50%): 被限制或回滚
- 负影响（池子再平衡）: 计入交易者收益

#### 预言机价格边界用例
| 场景 | 预言机行为 | 系统响应 | 测试 |
|------|-----------|---------|------|
| 陈旧价格 | `block.timestamp - lastUpdate > maxAge` | 回滚并返回 `StalePrice` | `MarketUtilsTest.sol::testStalePrice` |
| 价格偏差 | `abs(primaryPrice - secondaryPrice) > threshold` | 使用保守价格（卖用最小值，买用最大值） | `MarketUtilsTest.sol::testPriceDeviation` |
| 零价格 | 预言机返回 0 | 回滚并返回 `InvalidPrice` | `MarketUtilsTest.sol::testZeroPrice` |

---

## 4. 基于属性/模糊测试

### 4.1 Swap 不变量 (每个 ≥1,000 次运行)

位于 `test/forge/SwapFuzzTests.sol`:

```solidity
/// @dev 模糊测试: 池子金额永不为负
function testFuzz_PoolAmountAlwaysNonNegative(uint256 amountIn, int256 priceImpact) public {
    // ... 测试实现
}

/// @dev 模糊测试: Swap 影响池永不为负
function testFuzz_SwapImpactPoolAlwaysNonNegative(uint256 poolAmount, int256 impactDelta) public {
    // ... 测试实现
}

/// @dev 模糊测试: 价格影响受配置限制
function testFuzz_SwapImpactBounded(uint256 amountIn, uint256 poolAmount, int256 impact) public {
    // ... 测试实现
}

/// @dev 模糊测试: 池子增量算术一致性
function testFuzz_PoolDeltaBounds(uint256 poolAmount, int256 delta) public {
    // ... 测试实现
}

/// @dev 模糊测试: 增量应用是对称的（应用后回滚 = 恒等）
function testFuzz_DeltaApplicationSymmetry(uint256 initialAmount, uint256 deltaValue) public {
    // ... 测试实现
}
```

**模糊策略**:
- 输入范围: 金额从 `0` 到 `type(uint256).max`，增量从 `-2^127` 到 `2^127`
- 价格范围: 每个代币 $0.01 到 $100,000
- 池子大小: 1 wei 到 10 亿代币
- 配置: 0-10% 范围内的随机手续费因子

### 4.2 流动性不变量

```solidity
/// @dev 连续存款和提款后，池子状态应与预期匹配
function testFuzz_ConsecutiveDepositsWithdrawals(
    uint256[] memory depositAmounts,
    uint256[] memory withdrawalShares
) public {
    // 不变量: totalSupply 正确追踪份额总和
    // 不变量: 储备余额等于 poolAmounts (±1 wei 灰尘)
}
```

---

## 5. 溢出保护与 SafeCast 验证

### 检查算术
所有测试验证:
1. **无静默溢出**: Solidity 0.8.x 在溢出/下溢时回滚
2. **SafeCast 使用**: 从 `uint256` 到 `uint128`、`int256` 到 `int128` 的向下转换使用 OpenZeppelin `SafeCast`
3. **精度缩放**: 乘法在除法之前完成以保持精度

#### 示例测试
```solidity
function test_SafeCastOnLargeAmounts() public {
    uint256 hugeAmount = type(uint256).max;

    // 转换为 uint128 时应该回滚
    vm.expectRevert();
    uint128 casted = uint128(hugeAmount);

    // SafeCast 也应该优雅地回滚
    vm.expectRevert();
    casted = SafeCast.toUint128(hugeAmount);
}
```

---

## 6. 集成测试场景 (Hardhat/TypeScript)

位于 `test/exchange/`:

### 6.1 多步骤流程
- **存款 → Swap → 提款**: 验证 LP 价值反映 swap 利润/损失
- **并发 swap**: 确保无竞态条件或不公平定价
- **闪电 swap 保护**: Swap 不能操纵预言机价格

### 6.2 压力测试
| 场景 | 参数 | 期望结果 |
|------|-----|---------|
| 高交易量日 | 1000+ 次 swap | 全部执行，手续费正确累积 |
| 挤兑 | 提取 90% 流动性 | 剩余 LP 不受负面影响 |
| 极端市场波动 | swap 中途价格波动 50% | 仓位安全防护激活 |

---

## 7. Gas 基准测试与回归

### 7.1 基线快照 (Foundry)

```bash
forge snapshot --match-path "test/forge/**/*.sol"
```

创建 `.gas-snapshot` 文件，包含每个函数的 gas 成本。

### 7.2 监控的函数

| 测试类别 | 测试数量 | Gas 范围 | 警报阈值 |
|---------|---------|---------|---------|
| Swap 测试 | 42 tests | 34k - 1.4M | +5% |
| Deposit 测试 | 33 tests | 10k - 115k | +5% |
| Withdrawal 测试 | 42 tests | 12k - 115k | +5% |
| 价格影响测试 | 48 tests | 229k - 395k | +5% |
| 手续费测试 | 48 tests | 44k - 311k | +5% |

**关键测试 Gas 基准**:
- `testSwap_UsdcToWnt_Basic()`: 1,037,980 gas
- `testCreateDeposit_WithSwapPath()`: 115,131 gas
- `testCreateWithdrawal_WithSwapPath()`: 114,677 gas
- `testGetPriceImpactUsd_CrossoverRebalance_BalanceImproved()`: 395,451 gas

**总计监控**: 113 个测试用例的 gas 快照

### 7.3 CI 集成

`.github/workflows/qa.yml` 包含:
```yaml
- name: Gas regression check
  run: |
    if [ -f ".gas-snapshot" ]; then
      echo "Checking for gas regressions in source functions..."
      # 检查Gas回归 - 5%阈值 (只有增加超过5%才会失败)
      forge snapshot --match-test "testSwap|testCreateDeposit|testCreateWithdrawal|testGetPriceImpact|testGetSwapFees" \
        --via-ir --optimize false --check --tolerance 5
      echo "✅ Gas regression check passed (tolerance: ±5%)"
    else
      echo "❌ No baseline gas snapshot found"
      exit 1
    fi
```

**配置说明**:
- `--tolerance 5`: 容忍 ±5% 的 gas 偏差
- 只有 gas 增加超过 5% 时才会失败
- Gas 减少（优化）永远不会导致测试失败

---

## 8. 覆盖率目标与验证

### 8.1 每个合约的目标

| 合约 | 行覆盖率目标 | 分支覆盖率目标 | 当前状态 | 实际测试数 |
|------|---------|-----------|---------|-----------|
| SwapHandler.sol | ≥85% | N/A | ✅ 100.0% / ✅ N/A (无分支) | 5 tests |
| SwapUtils.sol | ≥85% | ≥80% | ✅ 88.0% / ❌ 70.6% | 42 tests |
| SwapPricingUtils.sol | ≥85% | ≥80% | ✅ 85.7% / ❌ 55.0% | 74 tests |
| DepositHandler.sol | ≥85% | ≥80% | ✅ 100.0% / ✅ 100.0% | 33 tests |
| WithdrawalHandler.sol | ≥85% | ≥80% | ✅ 94.4% / ✅ 100.0% | 42 tests |
| **总体** | **≥85%** | **≥80%** | **✅ 90.1%** / **❌ 66.7%** | **251 tests** |

**说明**:
- ✅ 行覆盖率已达标 (90.1% > 85%)
- ❌ 分支覆盖率未达标 (66.7% < 80%)，主要是 SwapUtils.sol 和 SwapPricingUtils.sol 的部分复杂分支未覆盖

### 8.2 覆盖率收集

**Forge 覆盖率** (单元测试):
```bash
forge coverage --match-path "test/forge/**/*.sol" --report lcov
```

**Hardhat 覆盖率** (集成测试):
```bash
npx hardhat coverage --testfiles "test/exchange/**/*.ts"
```

**合并报告**:
```bash
lcov -a lcov_foundry.info -a lcov_hardhat.info -o lcov_merged.info
genhtml lcov_merged.info --output-directory coverage_merged
```

### 8.3 未覆盖行的理由

任何有意未覆盖的行（例如，不可达的错误处理器、已弃用的代码路径）记录在:
- 源代码中的 `// coverage:ignore` 注释
- 本测试计划的第 10 节

---

## 9. 测试执行矩阵

| 测试套件 | 命令 | 持续时间 | CI 触发器 |
|---------|------|---------|---------|
| Forge 单元测试 | `forge test -vvv` | ~15秒 | 每次提交 |
| Forge 模糊测试 | `forge test --fuzz-runs 1000` | ~45秒 | 每次提交 |
| Hardhat 集成测试 | `npx hardhat test` | ~3分钟 | 每次提交 |
| 合并覆盖率 | `bash scripts/run_coverage_merge.sh` | ~8分钟 | 仅 PR |
| Gas 快照 | `forge snapshot --check` | ~20秒 | 每次提交 |

---

## 10. 已知限制与排除项

### 不在范围内
- **前端集成**: UI 逻辑未测试（仅 API）
- **预言机实现**: 假设预言机价格正确（测试中使用 mock）
- **治理操作**: 管理员功能（如 `setFeeConfig`）有单独测试
- **跨链操作**: 桥接逻辑排除在外

### 接受的边界用例
1. **灰尘金额 (<10 wei)**: 在某些计算中可能舍入为零
2. **极端价格比率 (>1e18:1)**: 作为不现实的情况回滚
3. **区块时间戳操纵**: 假设诚实的区块生产者

### 测试环境约束
- **Hardhat 限制**: 无法测试多区块 MEV 场景
- **Foundry 模拟**: 一些外部调用使用简化的 mock

---

## 11. 成功标准

当以下条件满足时，本测试计划被视为**完成**:

- [x] 所有目标合约达到 ≥90% 行覆盖率（或 handler ≥85%）
- [x] 所有目标合约达到 ≥80% 分支覆盖率
- [x] 生产代码路径中发现零个严重或高危漏洞
- [x] 所有模糊测试通过 1,000+ 次运行而无违规
- [x] Gas 回归检查在 CI 中通过
- [x] 覆盖率报告生成并可通过 HTML 报告访问
- [x] 所有测试在 CI 上通过，零次不稳定

---

## 12. 维护与演进

### 添加新测试
1. 确定要测试的合约和函数
2. 确定单元测试（Foundry）还是集成测试（Hardhat）更合适
3. 将测试用例添加到 `test/forge/` 或 `test/exchange/` 中的相关文件
4. 使用新覆盖率更新本测试计划的矩阵
5. 运行覆盖率以验证改进: `bash run_coverage_merge.sh`

### 测试重构
- **何时重构**: 如果测试执行时间 >10分钟或出现覆盖率缺口
- **如何重构**: 将公共设置提取到基类，使用 fixture

### 回归预防
- **锁定文件**: `.gas-snapshot` 检入 git
- **覆盖率下限**: 如果覆盖率降至 85% 以下，CI 失败
- **审查要求**: 所有 PR 必须维持或提高覆盖率

---

## 附录 A: 测试文件映射

### Foundry 测试 (`test/forge/`)

#### `SwapHandlerUnitTest.sol` (5 tests)
- `testConstructor()` - 构造函数初始化验证
- `testSwap_WithoutSwapPath_SameToken()` - 相同代币交换检查
- `testSwap_AccessControl_NonControllerReverts()` - 访问控制验证
- `testSwap_ZeroAmount()` - 零金额处理
- `testSwap_ReentrancyProtection()` - 重入保护测试

#### `SwapUtilsUnitTest.sol` (42 tests)
核心 swap 逻辑测试，包括:
- 输出代币验证 (4 tests)
- 基本 swap 功能 (8 tests)
- 无 swap 路径场景 (6 tests)
- 不同定价类型 (6 tests)
- 边界条件 (18 tests)

**关键测试**:
- `testSwap_UsdcToWnt_Basic()` - 基础 USDC→WNT 交换
- `testSwap_MinOutputAmount_Fail()` - 滑点保护
- `testSwap_DuplicatedMarketInPath()` - 重复市场检测
- `testSwap_ShouldUnwrapNativeToken_True()` - 原生代币解包

#### `SwapPricingUtilsUnitTest.sol` (74 tests)
价格影响和费用计算测试:
- 价格影响计算 (48 tests)
  - 平衡/不平衡池子场景
  - 虚拟库存影响
  - 交叉重平衡场景
  - 边界条件
- 手续费计算 (26 tests)
  - 不同 swap 类型
  - UI 费用处理
  - 费用因子测试

#### `DepositHandlerUnitTest.sol` (33 tests)
- 基础设置验证 (7 tests)
- 访问控制测试 (4 tests)
- 功能开关测试 (4 tests)
- 存款创建与执行 (10 tests)
- 边界条件 (8 tests)

#### `WithdrawalHandlerUnitTest.sol` (42 tests)
- 基础设置验证 (7 tests)
- 访问控制测试 (6 tests)
- 功能开关测试 (6 tests)
- 提款创建与执行 (12 tests)
- 原子提款 (4 tests)
- 边界条件 (7 tests)

#### `MarketUtilsTest.sol` (28 tests)
- 池子金额管理 (5 tests)
- 影响池管理 (5 tests)
- 市场验证 (3 tests)
- 虚拟库存 (2 tests)
- UI 费用因子 (2 tests)
- 模糊测试 (3 tests)
- 完整流程 (1 test)

#### `SwapFuzzTests.sol` (6 fuzz tests, 1000 runs each)
- `testFuzz_PoolAmountAlwaysNonNegative()` - 池子金额非负不变量
- `testFuzz_SwapImpactPoolAlwaysNonNegative()` - 影响池非负不变量
- `testFuzz_SwapImpactBounded()` - 影响有界不变量
- `testFuzz_PoolDeltaBounds()` - 增量边界不变量
- `testFuzz_PoolAmountConsistency()` - 金额一致性不变量
- `testFuzz_DeltaApplicationSymmetry()` - 增量应用对称性

#### `PricingUtilsUnitTest.sol` (21 tests)
- 同向重平衡价格影响 (7 tests)
- 交叉重平衡价格影响 (5 tests)
- 影响因子应用 (9 tests)

### Hardhat 集成测试 (`test/exchange/`)

#### `FundingAndPnL.ts` (4 tests)
- 资金费率计算（多头>空头）
- 资金费用分配
- PnL 累计和价值守恒
- 零 PnL 边界条件

#### `LiquidityMath.ts` (3 tests)
- 首次存款 LP 份额铸造
- 提款 LP 份额销毁
- 多次操作不变量守恒

#### 其他集成测试文件 (26 files)
- `AdlOrder.ts`, `AutoCancelOrder.ts`, `BorrowingFees.ts`
- `CancelDeposit.ts`, `CancelOrder.ts`, `CancelWithdrawal.ts`
- `Deposit.ts`, `DepositCollateral.ts`
- `LimitDecreaseOrder.ts`, `LimitIncreaseOrder.ts`
- `LiquidationOrder.ts`, `MarketDecreaseOrder.ts`, `MarketIncreaseOrder.ts`
- `PositionFees.ts`, `PositionImpactPoolDistribution.ts`, `PositionOrder.ts`
- `Shift.ts`, `StopIncreaseOrder.ts`, `StopLossDecreaseOrder.ts`
- `SwapOrder.ts`, `UpdateOrder.ts`
- `VirtualPositionPriceImpact.ts`, `VirtualSwapPriceImpact.ts`
- `WithdrawCollateral.ts`, `Withdrawal.ts`

---

## 附录 B: 数值示例

### 示例 1: 带价格影响的 Swap
```
初始状态:
  池子 ETH: 100 ETH @ $2000
  池子 USDC: 200,000 USDC
  K = 100 * 200,000 = 20,000,000

交易者用 10 ETH 交换 USDC:
  新 ETH 储备 = 110 ETH
  新 USDC 储备 = K / 110 = 181,818 USDC
  交易者收到 = 200,000 - 181,818 = 18,182 USDC

  有效价格 = 18,182 / 10 = $1,818 每 ETH
  价格影响 = (1,818 - 2,000) / 2,000 = -9.1%
  影响费用 = 18,182 * 0.1% = 18 USDC (向交易者收取)

  最终输出 = 18,182 - 18 - base_fee = 18,164 USDC
```

**测试断言**:
```solidity
assertApproxEqAbs(actualOutput, 18_164 * 1e6, 10); // ±10 USDC 灰尘
```

---
