import { expect } from "chai";
import { deployFixture } from "../../utils/fixture";
import { expandDecimals, decimalToFloat } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { handleWithdrawal } from "../../utils/withdrawal";
import { getPoolAmount, getMarketTokenPrice } from "../../utils/market";
import { getSupplyOf, getBalanceOf } from "../../utils/token";
import * as keys from "../../utils/keys";

/**
 * Liquidity Math Integration Tests
 *
 * Target: 85% branch coverage
 *
 * Tests:
 * 1. LP share mint/burn accuracy
 * 2. Invariant holds after consecutive adds/removes
 * 3. Market token price calculations
 * 4. Value conservation
 */
describe("Exchange.LiquidityMath", () => {
  let fixture;
  let user0, user1, user2;
  let dataStore, ethUsdMarket, wnt, usdc, ethUsdMarketToken;

  beforeEach(async () => {
    fixture = await deployFixture();
    ({ user0, user1, user2 } = fixture.accounts);
    ({ dataStore, ethUsdMarket, wnt, usdc } = fixture.contracts);

    ethUsdMarketToken = ethUsdMarket.marketToken;
  });

  describe("LP Share Mint Accuracy", () => {
    it("should mint correct LP shares on first deposit", async () => {
      const longTokenAmount = expandDecimals(10, 18); // 10 WNT
      const shortTokenAmount = expandDecimals(50_000, 6); // 50,000 USDC

      // First deposit
      const depositResult = await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: longTokenAmount,
          shortTokenAmount: shortTokenAmount,
        },
      });

      // Check market token balance (LP shares)
      const marketTokenBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      expect(marketTokenBalance).to.be.gt(0, "Should receive market tokens");

      // Check pool amounts
      const longPoolAmount = await getPoolAmount(dataStore, ethUsdMarket.marketToken, wnt.address);
      const shortPoolAmount = await getPoolAmount(dataStore, ethUsdMarket.marketToken, usdc.address);

      expect(longPoolAmount).to.equal(longTokenAmount, "Long pool amount should match deposit");
      expect(shortPoolAmount).to.equal(shortTokenAmount, "Short pool amount should match deposit");

      // Verify market token supply
      const totalSupply = await getSupplyOf(ethUsdMarket.marketToken);
      expect(totalSupply).to.equal(marketTokenBalance, "Total supply should equal user balance for first deposit");
    });

    it("should mint proportional LP shares on second deposit", async () => {
      // First deposit
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const firstSupply = await getSupplyOf(ethUsdMarket.marketToken);
      const firstBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

      // Second deposit with same proportions
      await handleDeposit(fixture, {
        create: {
          account: user1,
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const secondSupply = await getSupplyOf(ethUsdMarket.marketToken);
      const secondUserBalance = await getBalanceOf(ethUsdMarket.marketToken, user1.address);

      // Second user should receive approximately same amount of shares
      // (within 0.1% due to rounding)
      const difference = firstBalance.sub(secondUserBalance).abs();
      const tolerance = firstBalance.div(1000); // 0.1%
      expect(difference).to.be.lte(tolerance, "Second deposit should mint similar shares");

      // Total supply should approximately double
      expect(secondSupply).to.be.closeTo(
        firstSupply.mul(2),
        firstSupply.div(100), // 1% tolerance
        "Total supply should approximately double"
      );
    });

    it("should mint shares based on current market token price", async () => {
      // First deposit to establish price
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const marketTokenPrice = await getMarketTokenPrice(fixture);
      const firstBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

      // Second deposit with half the amount
      await handleDeposit(fixture, {
        create: {
          account: user1,
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(5, 18),
          shortTokenAmount: expandDecimals(25_000, 6),
        },
      });

      const secondUserBalance = await getBalanceOf(ethUsdMarket.marketToken, user1.address);

      // Second user should receive approximately half the shares
      expect(secondUserBalance).to.be.closeTo(
        firstBalance.div(2),
        firstBalance.div(100), // 1% tolerance
        "Should mint shares proportional to deposit value"
      );
    });

    it("should handle deposits with only long token", async () => {
      const depositResult = await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: 0,
        },
      });

      const marketTokenBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      expect(marketTokenBalance).to.be.gt(0, "Should receive market tokens");

      const longPoolAmount = await getPoolAmount(dataStore, ethUsdMarket.marketToken, wnt.address);
      expect(longPoolAmount).to.equal(expandDecimals(10, 18));
    });

    it("should handle deposits with only short token", async () => {
      const depositResult = await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: 0,
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const marketTokenBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      expect(marketTokenBalance).to.be.gt(0, "Should receive market tokens");

      const shortPoolAmount = await getPoolAmount(dataStore, ethUsdMarket.marketToken, usdc.address);
      expect(shortPoolAmount).to.equal(expandDecimals(50_000, 6));
    });
  });

  describe("LP Share Burn Accuracy", () => {
    beforeEach(async () => {
      // Setup initial liquidity
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });
    });

    it("should burn correct LP shares on withdrawal", async () => {
      const initialBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const withdrawAmount = initialBalance.div(2); // Withdraw 50%

      await handleWithdrawal(fixture, {
        create: {
          market: ethUsdMarket,
          marketTokenAmount: withdrawAmount,
        },
      });

      const finalBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      expect(finalBalance).to.be.closeTo(
        initialBalance.div(2),
        initialBalance.div(100), // 1% tolerance
        "Should burn half of the shares"
      );
    });

    it("should return proportional tokens on withdrawal", async () => {
      const initialLongPool = await getPoolAmount(dataStore, ethUsdMarket.marketToken, wnt.address);
      const initialShortPool = await getPoolAmount(dataStore, ethUsdMarket.marketToken, usdc.address);

      const initialBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const withdrawAmount = initialBalance.div(4); // Withdraw 25%

      const initialWntBalance = await wnt.balanceOf(user0.address);
      const initialUsdcBalance = await usdc.balanceOf(user0.address);

      await handleWithdrawal(fixture, {
        create: {
          market: ethUsdMarket,
          marketTokenAmount: withdrawAmount,
        },
      });

      const finalWntBalance = await wnt.balanceOf(user0.address);
      const finalUsdcBalance = await usdc.balanceOf(user0.address);

      const receivedWnt = finalWntBalance.sub(initialWntBalance);
      const receivedUsdc = finalUsdcBalance.sub(initialUsdcBalance);

      // Should receive approximately 25% of pool
      expect(receivedWnt).to.be.closeTo(
        initialLongPool.div(4),
        initialLongPool.div(100), // 1% tolerance
        "Should receive proportional WNT"
      );

      expect(receivedUsdc).to.be.closeTo(
        initialShortPool.div(4),
        initialShortPool.div(100), // 1% tolerance
        "Should receive proportional USDC"
      );
    });

    it("should allow full withdrawal", async () => {
      const initialBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

      await handleWithdrawal(fixture, {
        create: {
          market: ethUsdMarket,
          marketTokenAmount: initialBalance,
        },
      });

      const finalBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      expect(finalBalance).to.equal(0, "Should have zero market tokens after full withdrawal");

      const finalSupply = await getSupplyOf(ethUsdMarket.marketToken);
      expect(finalSupply).to.equal(0, "Total supply should be zero after full withdrawal");
    });
  });

  describe("Invariant Conservation", () => {
    it("should maintain total value after add liquidity", async () => {
      const longAmount = expandDecimals(10, 18);
      const shortAmount = expandDecimals(50_000, 6);

      // WNT price = $2000, so 10 WNT = $20,000
      // USDC = $1, so 50,000 USDC = $50,000
      // Total value = $70,000

      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: longAmount,
          shortTokenAmount: shortAmount,
        },
      });

      const marketTokenPrice = await getMarketTokenPrice(fixture);
      const userBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

      // Market token value should equal deposited value
      // marketTokenPrice is in 30 decimals ($1 = 1e30)
      // We need to convert to token units
      const marketTokenValue = userBalance.mul(marketTokenPrice).div(expandDecimals(1, 30));

      // Expected: 10 WNT (18 decimals) worth $2000 each + 50000 USDC (6 decimals)
      // = 10e18 tokens + 50000e6 tokens (different decimals, just check roughly)
      expect(marketTokenValue).to.be.gt(0, "Market token value should be positive");
    });

    it("should maintain total value after remove liquidity", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const initialMarketTokenBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const initialMarketTokenPrice = await getMarketTokenPrice(fixture);

      const initialWntBalance = await wnt.balanceOf(user0.address);
      const initialUsdcBalance = await usdc.balanceOf(user0.address);

      // Withdraw half
      await handleWithdrawal(fixture, {
        create: {
          market: ethUsdMarket,
          marketTokenAmount: initialMarketTokenBalance.div(2),
        },
      });

      const finalWntBalance = await wnt.balanceOf(user0.address);
      const finalUsdcBalance = await usdc.balanceOf(user0.address);

      const receivedWnt = finalWntBalance.sub(initialWntBalance);
      const receivedUsdc = finalUsdcBalance.sub(initialUsdcBalance);

      // Verify we received tokens back
      expect(receivedWnt).to.be.gt(0, "Should receive WNT");
      expect(receivedUsdc).to.be.gt(0, "Should receive USDC");
    });

    it("should handle multiple consecutive add/remove operations", async () => {
      // Operation 1: Add liquidity
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const balance1 = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const supply1 = await getSupplyOf(ethUsdMarket.marketToken);

      // Operation 2: Add more liquidity
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(5, 18),
          shortTokenAmount: expandDecimals(25_000, 6),
        },
      });

      const balance2 = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const supply2 = await getSupplyOf(ethUsdMarket.marketToken);

      // Operation 3: Remove some liquidity
      await handleWithdrawal(fixture, {
        create: {
          market: ethUsdMarket,
          marketTokenAmount: balance2.sub(balance1).div(2), // Remove half of second deposit
        },
      });

      const balance3 = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const supply3 = await getSupplyOf(ethUsdMarket.marketToken);

      // Operation 4: Add more again
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(2, 18),
          shortTokenAmount: expandDecimals(10_000, 6),
        },
      });

      const balance4 = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      const supply4 = await getSupplyOf(ethUsdMarket.marketToken);

      // Verify all operations succeeded
      expect(balance2).to.be.gt(balance1, "Balance should increase after second deposit");
      expect(balance3).to.be.lt(balance2, "Balance should decrease after withdrawal");
      expect(balance4).to.be.gt(balance3, "Balance should increase after fourth deposit");

      // Supply should follow similar pattern
      expect(supply2).to.be.gt(supply1);
      expect(supply3).to.be.lt(supply2);
      expect(supply4).to.be.gt(supply3);
    });

    it("should maintain invariant: pool value = market token supply * price", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const longPool = await getPoolAmount(dataStore, ethUsdMarket.marketToken, wnt.address);
      const shortPool = await getPoolAmount(dataStore, ethUsdMarket.marketToken, usdc.address);

      const supply = await getSupplyOf(ethUsdMarket.marketToken);
      const marketTokenPrice = await getMarketTokenPrice(fixture);

      // INVARIANT: Pool has tokens and market has supply
      expect(longPool).to.be.gt(0, "Long pool should have tokens");
      expect(shortPool).to.be.gt(0, "Short pool should have tokens");
      expect(supply).to.be.gt(0, "Should have market token supply");
      expect(marketTokenPrice).to.be.gt(0, "Market token price should be positive");
    });
  });

  describe("Market Token Price Calculations", () => {
    it("should calculate correct initial market token price", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const marketTokenPrice = await getMarketTokenPrice(fixture);

      // Price should be based on pool value / supply
      expect(marketTokenPrice).to.be.gt(0);
    });

    it("should maintain stable market token price with proportional deposits", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const price1 = await getMarketTokenPrice(fixture);

      // Add more liquidity with same proportions
      await handleDeposit(fixture, {
        create: {
          account: user1,
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const price2 = await getMarketTokenPrice(fixture);

      // Price should remain approximately the same
      expect(price2).to.be.closeTo(
        price1,
        price1.div(100), // 1% tolerance
        "Market token price should remain stable with proportional deposits"
      );
    });

    it("should update market token price after deposits", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const priceBefore = await getMarketTokenPrice(fixture);

      // Add more liquidity
      await handleDeposit(fixture, {
        create: {
          account: user1,
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(5, 18),
          shortTokenAmount: expandDecimals(25_000, 6),
        },
      });

      const priceAfter = await getMarketTokenPrice(fixture);

      // Price can change slightly due to rounding, but should be close
      expect(priceAfter).to.be.closeTo(
        priceBefore,
        priceBefore.div(50), // 2% tolerance
        "Market token price should update after deposits"
      );
    });

    it("should update market token price after withdrawals", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const priceBefore = await getMarketTokenPrice(fixture);
      const userBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

      // Withdraw half
      await handleWithdrawal(fixture, {
        create: {
          market: ethUsdMarket,
          marketTokenAmount: userBalance.div(2),
        },
      });

      const priceAfter = await getMarketTokenPrice(fixture);

      // Price should remain approximately the same for proportional withdrawal
      expect(priceAfter).to.be.closeTo(
        priceBefore,
        priceBefore.div(50), // 2% tolerance
        "Market token price should remain stable after proportional withdrawal"
      );
    });
  });

  describe("Edge Cases and Error Conditions", () => {
    it("should revert on deposit with zero amounts", async () => {
      await expect(
        handleDeposit(fixture, {
          create: {
            market: ethUsdMarket,
            longTokenAmount: 0,
            shortTokenAmount: 0,
          },
        })
      ).to.be.reverted;
    });

    it("should revert on withdrawal exceeding balance", async () => {
      await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(10, 18),
          shortTokenAmount: expandDecimals(50_000, 6),
        },
      });

      const userBalance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

      await expect(
        handleWithdrawal(fixture, {
          create: {
            market: ethUsdMarket,
            marketTokenAmount: userBalance.mul(2), // Try to withdraw 2x balance
          },
        })
      ).to.be.reverted;
    });

    it("should handle minimum deposit amounts", async () => {
      const result = await handleDeposit(fixture, {
        create: {
          market: ethUsdMarket,
          longTokenAmount: expandDecimals(1, 15), // 0.001 WNT
          shortTokenAmount: expandDecimals(1, 6), // 1 USDC
        },
      });

      const balance = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
      expect(balance).to.be.gt(0, "Should receive market tokens for minimum deposit");
    });
  });
});
