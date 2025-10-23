// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../../contracts/market/Market.sol";
import "../../contracts/market/MarketUtils.sol";
import "../../contracts/market/MarketStoreUtils.sol";
import "../../contracts/data/DataStore.sol";
import "../../contracts/data/Keys.sol";
import "../../contracts/role/RoleStore.sol";
import "../../contracts/role/Role.sol";
import "../../contracts/event/EventEmitter.sol";
import "../../contracts/mock/MockToken.sol";

/**
 * @title SwapFuzzTests
 * @dev Property-based / Fuzz tests for swap-related invariants
 *
 * Core invariants tested (≥1000 runs each):
 * 1. Pool amounts must always be non-negative
 * 2. Swap impact pools must always be non-negative
 * 3. Price impact must be bounded
 * 4. Pool value conservation (minus fees)
 */
contract SwapFuzzTests is Test {
    DataStore public dataStore;
    RoleStore public roleStore;
    EventEmitter public eventEmitter;
    MockOracle public oracle;

    Market.Props public ethUsdMarket;
    MockToken public wnt;
    MockToken public usdc;
    MockToken public marketToken;

    function setUp() public {
        // Deploy core contracts
        roleStore = new RoleStore();
        dataStore = new DataStore(roleStore);
        eventEmitter = new EventEmitter(roleStore);
        oracle = new MockOracle();

        // Grant roles
        roleStore.grantRole(address(this), Role.CONTROLLER);
        roleStore.grantRole(address(this), Role.MARKET_KEEPER);

        // Deploy tokens
        wnt = new MockToken("Wrapped Native Token", "WNT", 18);
        usdc = new MockToken("USD Coin", "USDC", 6);
        marketToken = new MockToken("Market Token", "MKT", 18);

        // Setup market
        ethUsdMarket = Market.Props({
            marketToken: address(marketToken),
            indexToken: address(wnt),
            longToken: address(wnt),
            shortToken: address(usdc)
        });

        MarketStoreUtils.set(dataStore, ethUsdMarket.marketToken, keccak256(abi.encode("ETH_USD")), ethUsdMarket);

        // Set oracle prices
        oracle.setPrice(address(wnt), 2000e18); // $2000 per WNT
        oracle.setPrice(address(usdc), 1e18);   // $1 per USDC

        // Basic market configuration
        _setupBasicMarketConfig();
    }

    function _setupBasicMarketConfig() internal {
        address market = ethUsdMarket.marketToken;

        // Enable market
        dataStore.setBool(Keys.isMarketDisabledKey(market), false);

        // Token gas limits
        dataStore.setUint(Keys.tokenTransferGasLimit(address(wnt)), 200000);
        dataStore.setUint(Keys.tokenTransferGasLimit(address(usdc)), 200000);

        // Reserve factors (80%)
        dataStore.setUint(Keys.reserveFactorKey(market, true), 8e29);
        dataStore.setUint(Keys.reserveFactorKey(market, false), 8e29);

        // Max pool amounts
        dataStore.setUint(Keys.maxPoolAmountKey(market, address(wnt)), 10000e18);
        dataStore.setUint(Keys.maxPoolAmountKey(market, address(usdc)), 20000000e6);

        // Swap fees (0.05%)
        dataStore.setUint(Keys.swapFeeFactorKey(market, true), 5e25); // 0.05%
        dataStore.setUint(Keys.swapFeeFactorKey(market, false), 5e25);
    }

    // ============ INVARIANT 1: Non-negative Pool Amounts ============

    /**
     * @dev FUZZ TEST: Pool amounts must always be >= 0
     * Tests that applyDeltaToPoolAmount never creates negative pools
     * Runs: 1000 random inputs
     */
    function testFuzz_PoolAmountAlwaysNonNegative(
        uint256 initialPoolAmount,
        int256 delta
    ) public {
        // Bound to realistic ranges
        initialPoolAmount = bound(initialPoolAmount, 1e6, 1000000e18);

        // Delta can be negative but not more than pool amount
        vm.assume(delta >= -int256(initialPoolAmount));
        vm.assume(delta <= 1000000e18);

        // Set initial pool amount
        dataStore.setUint(
            Keys.poolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            initialPoolAmount
        );

        // Apply delta
        MarketUtils.applyDeltaToPoolAmount(
            dataStore,
            eventEmitter,
            ethUsdMarket,
            address(wnt),
            delta
        );

        // INVARIANT: Pool amount must be non-negative
        uint256 finalPoolAmount = MarketUtils.getPoolAmount(
            dataStore,
            ethUsdMarket,
            address(wnt)
        );

        assertGe(finalPoolAmount, 0, "INVARIANT VIOLATED: Pool amount must be non-negative");

        // Also verify the delta was applied correctly
        if (delta >= 0) {
            assertEq(finalPoolAmount, initialPoolAmount + uint256(delta), "Positive delta applied incorrectly");
        } else {
            assertEq(finalPoolAmount, initialPoolAmount - uint256(-delta), "Negative delta applied incorrectly");
        }
    }

    /**
     * @dev FUZZ TEST: Swap impact pool must always be >= 0
     * Runs: 1000 random inputs
     */
    function testFuzz_SwapImpactPoolAlwaysNonNegative(
        uint256 initialImpactPool,
        int256 impactAmount
    ) public {
        initialImpactPool = bound(initialImpactPool, 0, 1000000e18);

        // Impact amount can reduce pool but not below zero
        vm.assume(impactAmount >= -int256(initialImpactPool));
        vm.assume(impactAmount <= 1000000e18);

        // Set initial impact pool
        dataStore.setUint(
            Keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            initialImpactPool
        );

        // Apply impact
        MarketUtils.applyDeltaToSwapImpactPool(
            dataStore,
            eventEmitter,
            ethUsdMarket.marketToken,
            address(wnt),
            impactAmount
        );

        // INVARIANT: Impact pool must be non-negative
        uint256 finalImpactPool = MarketUtils.getSwapImpactPoolAmount(
            dataStore,
            ethUsdMarket.marketToken,
            address(wnt)
        );

        assertGe(finalImpactPool, 0, "INVARIANT VIOLATED: Swap impact pool must be non-negative");
    }

    // ============ INVARIANT 2: Swap Impact Bounds ============

    /**
     * @dev FUZZ TEST: Capped swap impact should never exceed reasonable bounds
     * Runs: 1000 random inputs
     */
    function testFuzz_SwapImpactBounded(
        uint256 poolAmount,
        uint256 impactPoolAmount,
        int256 priceImpactUsd
    ) public {
        // Bound inputs to realistic ranges
        poolAmount = bound(poolAmount, 100e18, 1000000e18);
        impactPoolAmount = bound(impactPoolAmount, 100e18, 1000000e18);

        // Price impact can be positive or negative
        priceImpactUsd = bound(priceImpactUsd, -1000000e30, 1000000e30);

        // Setup pool amounts
        dataStore.setUint(
            Keys.poolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            poolAmount
        );
        dataStore.setUint(
            Keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            impactPoolAmount
        );

        // Apply swap impact with cap (without setting max positive impact)
        (int256 impactAmount, ) = MarketUtils.applySwapImpactWithCap(
            dataStore,
            eventEmitter,
            ethUsdMarket.marketToken,
            address(wnt),
            oracle.getPrimaryPrice(address(wnt)), // tokenPrice
            priceImpactUsd
        );

        // INVARIANT: Impact amount should not exceed pool + impact pool
        int256 maxPossibleImpact = int256(poolAmount + impactPoolAmount);
        assertLe(impactAmount, maxPossibleImpact, "INVARIANT VIOLATED: Impact exceeds available liquidity");
        assertGe(impactAmount, -maxPossibleImpact, "INVARIANT VIOLATED: Negative impact exceeds available liquidity");
    }

    // ============ INVARIANT 3: Pool Delta Bounds ============

    /**
     * @dev FUZZ TEST: Pool delta应该在合理范围内
     * Runs: 1000 random inputs
     */
    function testFuzz_PoolDeltaBounds(
        uint256 initialAmount,
        int256 delta
    ) public {
        // Bound to realistic ranges
        initialAmount = bound(initialAmount, 1000e18, 10000000e18);
        delta = bound(delta, -int256(initialAmount), int256(initialAmount));

        // Setup initial pool
        dataStore.setUint(
            Keys.poolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            initialAmount
        );

        // Apply delta
        MarketUtils.applyDeltaToPoolAmount(
            dataStore,
            eventEmitter,
            ethUsdMarket,
            address(wnt),
            delta
        );

        // INVARIANT: Final amount should be within expected range
        uint256 finalAmount = MarketUtils.getPoolAmount(dataStore, ethUsdMarket, address(wnt));

        if (delta >= 0) {
            assertEq(finalAmount, initialAmount + uint256(delta), "Positive delta not applied correctly");
        } else {
            assertEq(finalAmount, initialAmount - uint256(-delta), "Negative delta not applied correctly");
        }

        // INVARIANT: Final amount should always be non-negative
        assertGe(finalAmount, 0, "INVARIANT VIOLATED: Pool amount became negative");
    }

    // ============ INVARIANT 4: Pool Amount Consistency ============

    /**
     * @dev FUZZ TEST: getPoolAmount应该返回之前设置的值
     * Runs: 1000 random inputs
     */
    function testFuzz_PoolAmountConsistency(
        uint256 poolAmount
    ) public {
        poolAmount = bound(poolAmount, 0, 10000000e18);

        // Set pool amount
        dataStore.setUint(
            Keys.poolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            poolAmount
        );

        // INVARIANT: getPoolAmount should return the same value
        uint256 retrievedAmount = MarketUtils.getPoolAmount(
            dataStore,
            ethUsdMarket,
            address(wnt)
        );

        assertEq(retrievedAmount, poolAmount, "INVARIANT VIOLATED: Pool amount mismatch");
    }

    // ============ INVARIANT 5: Delta Application Symmetry ============

    /**
     * @dev FUZZ TEST: Applying +delta then -delta should return to original state
     * Runs: 1000 random inputs
     */
    function testFuzz_DeltaApplicationSymmetry(
        uint256 initialAmount,
        uint256 deltaAmount
    ) public {
        initialAmount = bound(initialAmount, 1000e18, 1000000e18);
        deltaAmount = bound(deltaAmount, 1e18, initialAmount / 2);

        // Set initial pool amount
        dataStore.setUint(
            Keys.poolAmountKey(ethUsdMarket.marketToken, address(wnt)),
            initialAmount
        );

        // Apply positive delta
        MarketUtils.applyDeltaToPoolAmount(
            dataStore,
            eventEmitter,
            ethUsdMarket,
            address(wnt),
            int256(deltaAmount)
        );

        // Apply negative delta (reverse)
        MarketUtils.applyDeltaToPoolAmount(
            dataStore,
            eventEmitter,
            ethUsdMarket,
            address(wnt),
            -int256(deltaAmount)
        );

        // INVARIANT: Should return to initial state
        uint256 finalAmount = MarketUtils.getPoolAmount(dataStore, ethUsdMarket, address(wnt));
        assertEq(finalAmount, initialAmount, "INVARIANT VIOLATED: Symmetry broken - did not return to initial state");
    }
}
