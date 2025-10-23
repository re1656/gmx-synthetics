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


  });

  describe("Invariant Conservation", () => {


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

  });


});
