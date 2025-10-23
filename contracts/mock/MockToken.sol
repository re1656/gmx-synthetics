// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../oracle/IOracle.sol";
import "../price/Price.sol";
import "../data/DataStore.sol";
import "../event/EventEmitter.sol";
import "../oracle/OracleUtils.sol";

/**
 * @title MockToken
 * @dev Mock ERC20 token for testing
 */
contract MockToken is ERC20 {
    uint8 private _decimals;
    
    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }
    
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/**
 * @title MockOracle
 * @dev Mock oracle for testing price feeds
 */
contract MockOracle is IOracle {
    mapping(address => Price.Props) private prices;
    address[] private tokensWithPrices;
    uint256 private _minTimestamp;
    uint256 private _maxTimestamp;
    
    function setPrice(address token, uint256 price) external {
        prices[token] = Price.Props({
            min: price,
            max: price
        });
        
        // Add token to list if not already present
        bool found = false;
        for (uint256 i = 0; i < tokensWithPrices.length; i++) {
            if (tokensWithPrices[i] == token) {
                found = true;
                break;
            }
        }
        if (!found) {
            tokensWithPrices.push(token);
        }
    }
    
    function setPriceWithSpread(address token, uint256 minPrice, uint256 maxPrice) external {
        prices[token] = Price.Props({
            min: minPrice,
            max: maxPrice
        });
    }
    
    function minTimestamp() external view returns (uint256) {
        return _minTimestamp;
    }
    
    function maxTimestamp() external view returns (uint256) {
        return _maxTimestamp;
    }
    
    function dataStore() external view returns (DataStore) {
        return DataStore(address(0)); // Mock implementation
    }
    
    function eventEmitter() external view returns (EventEmitter) {
        return EventEmitter(address(0)); // Mock implementation
    }
    
    function validateSequencerUp() external view {
        // Mock implementation - always passes
    }
    
    function setPrices(OracleUtils.SetPricesParams memory params) external {
        // Mock implementation - set prices for all tokens
        require(params.tokens.length == params.providers.length, "Tokens and providers length mismatch");
        require(params.tokens.length == params.data.length, "Tokens and data length mismatch");
        
        for (uint256 i = 0; i < params.tokens.length; i++) {
            // For mock purposes, we'll set a default price
            // In real implementation, this would parse the data and set actual prices
            prices[params.tokens[i]] = Price.Props({
                min: 1000e18, // Default mock price
                max: 1000e18
            });
            
            // Add token to list if not already present
            bool found = false;
            for (uint256 j = 0; j < tokensWithPrices.length; j++) {
                if (tokensWithPrices[j] == params.tokens[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                tokensWithPrices.push(params.tokens[i]);
            }
        }
    }
    
    function setPricesForAtomicAction(OracleUtils.SetPricesParams memory params) external {
        // Mock implementation - same as setPrices for atomic actions
        require(params.tokens.length == params.providers.length, "Tokens and providers length mismatch");
        require(params.tokens.length == params.data.length, "Tokens and data length mismatch");
        
        for (uint256 i = 0; i < params.tokens.length; i++) {
            // For mock purposes, we'll set a default price
            // In real implementation, this would parse the data and set actual prices
            prices[params.tokens[i]] = Price.Props({
                min: 1000e18, // Default mock price
                max: 1000e18
            });
            
            // Add token to list if not already present
            bool found = false;
            for (uint256 j = 0; j < tokensWithPrices.length; j++) {
                if (tokensWithPrices[j] == params.tokens[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                tokensWithPrices.push(params.tokens[i]);
            }
        }
    }
    
    function setPrimaryPrice(address token, Price.Props memory price) external {
        prices[token] = price;
    }
    
    function setTimestamps(uint256 newMinTimestamp, uint256 newMaxTimestamp) external {
        _minTimestamp = newMinTimestamp;
        _maxTimestamp = newMaxTimestamp;
    }
    
    function clearAllPrices() external {
        // Mock implementation - clear all prices
    }
    
    function getTokensWithPricesCount() external view returns (uint256) {
        return tokensWithPrices.length;
    }
    
    function getTokensWithPrices(uint256 start, uint256 end) external view returns (address[] memory) {
        require(start <= end, "Invalid range");
        require(end <= tokensWithPrices.length, "End exceeds length");
        
        uint256 length = end - start;
        address[] memory result = new address[](length);
        
        for (uint256 i = 0; i < length; i++) {
            result[i] = tokensWithPrices[start + i];
        }
        
        return result;
    }
    
    function getPrimaryPrice(address token) external view returns (Price.Props memory) {
        return prices[token];
    }
    
    function validatePrices(
        OracleUtils.SetPricesParams memory params,
        bool forAtomicAction
    ) external returns (OracleUtils.ValidatedPrice[] memory) {
        // Mock implementation
        return new OracleUtils.ValidatedPrice[](0);
    }
}

/**
 * @title MockBank
 * @dev Mock bank for testing token transfers
 */
contract MockBank {
    mapping(address => mapping(address => uint256)) private balances;
    
    event TransferOut(address indexed token, address indexed receiver, uint256 amount, bool shouldUnwrapNativeToken);
    event TransferIn(address indexed token, address indexed sender, uint256 amount);
    
    function transferOut(
        address token,
        address receiver,
        uint256 amount,
        bool shouldUnwrapNativeToken
    ) external {
        // For mock purposes, check the actual token balance of this contract
        IERC20 tokenContract = IERC20(token);
        require(tokenContract.balanceOf(address(this)) >= amount, "Insufficient balance");
        
        // Update internal tracking - 在 mock 中，我们不需要跟踪 msg.sender 的余额
        // 因为代币已经被 mint 到这个合约本身
        balances[receiver][token] += amount;
        
        // Transfer tokens
        tokenContract.transfer(receiver, amount);
        
        emit TransferOut(token, receiver, amount, shouldUnwrapNativeToken);
    }
    
    function transferIn(
        address token,
        address sender,
        uint256 amount
    ) external {
        // Update balances
        balances[sender][token] -= amount;
        balances[msg.sender][token] += amount;
        
        // Transfer tokens (simplified mock)
        IERC20(token).transferFrom(sender, msg.sender, amount);
        
        emit TransferIn(token, sender, amount);
    }
    
    function getBalance(address account, address token) external view returns (uint256) {
        return balances[account][token];
    }
    
    function setBalance(address account, address token, uint256 amount) external {
        balances[account][token] = amount;
    }
}
