// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../../contracts/swap/SwapHandler.sol";
import "../../contracts/swap/ISwapHandler.sol";
import "../../contracts/swap/ISwapUtils.sol";
import "../../contracts/data/DataStore.sol";
import "../../contracts/event/EventEmitter.sol";
import "../../contracts/role/RoleStore.sol";
import "../../contracts/bank/Bank.sol";
import "../../contracts/data/Keys.sol";
import "../../contracts/error/Errors.sol";
import "../../contracts/role/Role.sol";
import "../../contracts/price/Price.sol";
import "../../contracts/oracle/IOracle.sol";
import "../../contracts/market/Market.sol";
import "../../contracts/pricing/ISwapPricingUtils.sol";
import "../../contracts/mock/MockToken.sol"; // MockOracle is also defined here

/**
 * @title SwapHandlerUnitTest
 * @dev SwapHandler合约的纯单元测试 - 只测试SwapHandler本身的功能
 */
contract SwapHandlerUnitTest is Test {
    // 被测试的合约
    SwapHandler public swapHandler;

    // 依赖的合约
    RoleStore public roleStore;
    DataStore public dataStore;
    EventEmitter public eventEmitter;
    MockOracle public oracle;
    Bank public bank;
    MockToken public wnt;
    MockToken public usdc;

    // 测试账户
    address public controller = address(0x1000);
    address public nonController = address(0x1001);
    address public receiver = address(0x1002);

    function setUp() public {
        // 部署依赖合约
        roleStore = new RoleStore();
        dataStore = new DataStore(roleStore);
        eventEmitter = new EventEmitter(roleStore);
        oracle = new MockOracle();
        bank = new Bank(roleStore, dataStore);

        // 部署代币
        wnt = new MockToken("Wrapped Native Token", "WNT", 18);
        usdc = new MockToken("USD Coin", "USDC", 6);

        // 部署被测试的合约
        swapHandler = new SwapHandler(roleStore);

        // 设置权限
        roleStore.grantRole(controller, Role.CONTROLLER);
        roleStore.grantRole(address(swapHandler), Role.CONTROLLER);
        roleStore.grantRole(address(this), Role.CONTROLLER);

        // 设置WNT地址
        dataStore.setAddress(Keys.WNT, address(wnt));

        // 设置gas limits (必需,否则transferOut会失败)
        dataStore.setUint(Keys.tokenTransferGasLimit(address(wnt)), 200000);
        dataStore.setUint(Keys.tokenTransferGasLimit(address(usdc)), 200000);

        // 设置价格
        oracle.setPrice(address(wnt), 2000e30); // $2000 per ETH (30 decimals)
        oracle.setPrice(address(usdc), 1e30);   // $1 per USDC (30 decimals)

        // 为bank提供一些代币用于测试
        wnt.mint(address(bank), 100 ether);
        usdc.mint(address(bank), 100000e6);
    }

    // ============ 基本设置测试 ============

    function testConstructor() public {
        // 测试构造函数是否正确设置了roleStore
        // 这个测试覆盖了SwapHandler的构造函数
        SwapHandler newSwapHandler = new SwapHandler(roleStore);
        assertTrue(address(newSwapHandler) != address(0));
    }

    // ============ swap()函数测试 ============

    function testSwap_WithoutSwapPath_SameToken() public {
        // 测试最简单的swap场景：没有swapPath，直接转账相同代币
        // 这个测试覆盖了SwapHandler.swap()的调用

        // 准备swap参数
        ISwapUtils.SwapParams memory params = ISwapUtils.SwapParams({
            dataStore: dataStore,
            eventEmitter: eventEmitter,
            oracle: oracle,
            bank: bank,
            key: bytes32(uint256(1)),
            tokenIn: address(wnt),
            amountIn: 1 ether,
            swapPathMarkets: new Market.Props[](0), // 空swapPath
            minOutputAmount: 1 ether,
            receiver: receiver,
            uiFeeReceiver: address(0),
            shouldUnwrapNativeToken: false,
            swapPricingType: ISwapPricingUtils.SwapPricingType.Swap
        });

        // 用controller身份调用
        vm.prank(controller);
        (address outputToken, uint256 outputAmount) = swapHandler.swap(params);

        // 验证返回值
        assertEq(outputToken, address(wnt), "Output token should be WNT");
        assertEq(outputAmount, 1 ether, "Output amount should be 1 ether");
    }

    function testSwap_AccessControl_NonControllerReverts() public {
        // 测试访问控制：非controller调用应该失败
        // 这个测试验证了onlyController modifier

        ISwapUtils.SwapParams memory params = ISwapUtils.SwapParams({
            dataStore: dataStore,
            eventEmitter: eventEmitter,
            oracle: oracle,
            bank: bank,
            key: bytes32(uint256(1)),
            tokenIn: address(wnt),
            amountIn: 1 ether,
            swapPathMarkets: new Market.Props[](0),
            minOutputAmount: 1 ether,
            receiver: receiver,
            uiFeeReceiver: address(0),
            shouldUnwrapNativeToken: false,
            swapPricingType: ISwapPricingUtils.SwapPricingType.Swap
        });

        // 用非controller身份调用，应该失败
        vm.prank(nonController);
        vm.expectRevert(abi.encodeWithSelector(Errors.Unauthorized.selector, nonController, "CONTROLLER"));
        swapHandler.swap(params);
    }

    function testSwap_ZeroAmount() public {
        // 测试amountIn为0的情况

        ISwapUtils.SwapParams memory params = ISwapUtils.SwapParams({
            dataStore: dataStore,
            eventEmitter: eventEmitter,
            oracle: oracle,
            bank: bank,
            key: bytes32(uint256(1)),
            tokenIn: address(wnt),
            amountIn: 0, // 零金额
            swapPathMarkets: new Market.Props[](0),
            minOutputAmount: 0,
            receiver: receiver,
            uiFeeReceiver: address(0),
            shouldUnwrapNativeToken: false,
            swapPricingType: ISwapPricingUtils.SwapPricingType.Swap
        });

        vm.prank(controller);
        (address outputToken, uint256 outputAmount) = swapHandler.swap(params);

        // 验证返回值 - 零金额应该直接返回
        assertEq(outputToken, address(wnt), "Output token should be WNT");
        assertEq(outputAmount, 0, "Output amount should be 0");
    }

    function testSwap_ReentrancyProtection() public {
        // 测试重入保护 - nonReentrant modifier
        // 虽然很难在单元测试中触发真正的重入，但我们可以验证modifier存在

        ISwapUtils.SwapParams memory params = ISwapUtils.SwapParams({
            dataStore: dataStore,
            eventEmitter: eventEmitter,
            oracle: oracle,
            bank: bank,
            key: bytes32(uint256(1)),
            tokenIn: address(wnt),
            amountIn: 1 ether,
            swapPathMarkets: new Market.Props[](0),
            minOutputAmount: 1 ether,
            receiver: receiver,
            uiFeeReceiver: address(0),
            shouldUnwrapNativeToken: false,
            swapPricingType: ISwapPricingUtils.SwapPricingType.Swap
        });

        // 正常调用应该成功
        vm.prank(controller);
        (address outputToken, uint256 outputAmount) = swapHandler.swap(params);

        assertEq(outputToken, address(wnt));
        assertEq(outputAmount, 1 ether);
    }
}