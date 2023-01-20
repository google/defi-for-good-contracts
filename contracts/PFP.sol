//SPDX-License-Identifier: Apache-2.0

/// @title PFP
/// @author github.com/billyzhang663
/// @author github.com/garthbrydon
/// @author github.com/valynislives
/// @author github.com/jpetrich

/*
 * Copyright 2022 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PFPAdmin.sol";
import "./PriceConsumerV3.sol";
import "./PurposeToken.sol";
import "./PFPConfig/IPFPConfig.sol";
import "./GenesisPurposeEscrow.sol";
import "./libraries/BokkyPooBahsDateTimeLibrary.sol";

contract PFP is PFPAdmin {
    using SafeERC20 for IERC20;

    PurposeToken public purposeToken;
    GenesisPurposeEscrow public genesisPurposeEscrow;
    IPFPConfig public pfpConfig;
    PriceConsumerV3 public ethUsdPriceConsumer;

    /// @notice Total contributions made to Endowment Fund (in USD with 6 decimals)
    uint256 public totalEndowmentContributionsInUsd;

    struct AccountState {
        // total Purpose staked in protocol
        uint256 purposeStaked;
        // total Purpose held in account (unstaked)
        uint256 purposeHeld;
        // total Rewards held in account (claimed)
        uint256 rewardsPaid;
        // array of staking transactions made
        AccountTransaction[] transactions;
    }

    struct AccountTransaction {
        // copy of vest schedule created when first staked
        GenesisPurposeEscrow.VestSchedule schedule;
        // reward at current point in time
        uint256 currentReward;
        // purpose withdrawable at current point in time
        uint256 currentAmount;
        // array of tranches that will vest after staking period
        TransactionTranche[] tranches;
    }

    struct TransactionTranche {
        // tranche date
        uint64 dateAvailable;
        // amount of Purpose available
        uint256 amountAvailable;
        // amount of Purpose Rewards available
        uint256 rewardAvailable;
    }

    /**
     * @notice Emitted when staker deposits Ether successfully
     * @param _addr staker's wallet address
     * @param _endowmentAddr the endowment address
     * @param _foundationAddr the foundation address
     * @param _amount the staked amount of ETH
     */
    event EthDepositReceived(address indexed _addr, address indexed _endowmentAddr, address indexed _foundationAddr, uint256 _amount);
    /**
     * @notice Emitted when staker deposits other coin successfully
     * @param _addr staker's wallet address
     * @param _coinAddr the coin address
     * @param _endowmentAddr the endowment address
     * @param _foundationAddr the foundation address
     * @param _amount the staked amount of coin
     */
    event CoinDepositReceived(address indexed _addr, address _coinAddr, address indexed _endowmentAddr, address indexed _foundationAddr, uint256 _amount);
    /**
     * @notice Emitted when total endowment contributions in usd increases
     * @param _addr staker's wallet address
     * @param _endowmentAddr the endowment address
     * @param _totalEndowment the total amount of endowment contributions in usd
     * @param _amount the increased amount of endowment contributions in usd
     * @param _purposePrice the price of purpose token
     */
    event EndowmentIncreased(address indexed _addr, address indexed _endowmentAddr, uint256 _totalEndowment, uint256 _amount, uint256 _purposePrice);

    /**
     * @dev Creates a PFP contract.
     * @param _purposeTokenAddr address of purpose token contract
     * @param _genesisPurposeEscrowAddr address of GenesisPurposeEscrow contract
     * @param _pfpConfigAddr address of IPFPConfig contract
     * @param _ethUsdPriceFeed address of PriceConsumerV3 contract
     */
    constructor(
        address _purposeTokenAddr,
        address _genesisPurposeEscrowAddr,
        address _pfpConfigAddr,
        address _ethUsdPriceFeed
    ) PFPAdmin(_pfpConfigAddr) {
        require(_purposeTokenAddr != address(0), "PFP: zero address");
        require(_genesisPurposeEscrowAddr != address(0), "PFP: zero address");
        require(_ethUsdPriceFeed != address(0), "PFP: zero address");
        
        purposeToken = PurposeToken(_purposeTokenAddr);
        genesisPurposeEscrow = GenesisPurposeEscrow(_genesisPurposeEscrowAddr);
        pfpConfig = IPFPConfig(_pfpConfigAddr);
        ethUsdPriceConsumer = PriceConsumerV3(_ethUsdPriceFeed);
        totalEndowmentContributionsInUsd = 0;
    }

    /**
     * @notice Deposit eth and mint purpose
     * @param _isAccelerated use accelerated vest schedule
     * @param _minPurposeReceived min Purpose that should be received; prevents minting unexpectedly lower purpose amount  
     */
    function depositEth(bool _isAccelerated, uint256 _minPurposeReceived)
        external
        payable
        whenNotPaused
    {
        uint256 ethUsdPrice = ethUsdPriceConsumer.getLatestPrice();
        require(validEthDepositAmount(msg.value, ethUsdPrice, minimumDepositInUsdNoDecimals), "PFP: Deposit value too low");

        address endowmentAddr = pfpConfig.endowmentAddr();
        address foundationAddr = pfpConfig.foundationAddr();
        uint256 purposePrice = getPurposePrice();
        uint256 endowmentAmount = msg.value * 85 / 100;
        // wei => ether, keep 6 decimals of ethUsdprice 
        uint256 amountInUsd = msg.value * ethUsdPrice / 1e20; 
        uint256 endowmentAmountInUsd = endowmentAmount * ethUsdPrice / 1e20; 

        // update total endowment contributions
        totalEndowmentContributionsInUsd += endowmentAmountInUsd;
        emit EndowmentIncreased(msg.sender, endowmentAddr, totalEndowmentContributionsInUsd, endowmentAmountInUsd, purposePrice);

        // transfer to funds
        (bool successEndowment, ) = payable(endowmentAddr).call{value: endowmentAmount}("");
        require(successEndowment, "PFP: Endowment transfer failed");
        (bool successFoundation, ) = payable(foundationAddr).call{value: msg.value - endowmentAmount}("");
        require(successFoundation, "PFP: Foundation transfer failed");
        emit EthDepositReceived(msg.sender, endowmentAddr, foundationAddr, msg.value);

        // mint and stake
        uint256 tokenAmountToMint = calculateTokensToMint(purposePrice, amountInUsd);
        require(tokenAmountToMint > 0, "PFP: Token amount <= 0.");
        require(tokenAmountToMint >= _minPurposeReceived, "PFP: Token amount < min.");
        purposeToken.mintPurpose(address(genesisPurposeEscrow), tokenAmountToMint);
        genesisPurposeEscrow.stakePurpose(
          msg.sender,
          tokenAmountToMint,
          acceleratedVestAllowed ? _isAccelerated : false,
          purposePrice,
          "ETH");
    }

    /**
     * @notice Deposit USD based erc20 stablecoin
     * @param _coinAddr address of allowlisted stablecoin
     * @param _amount amount to deposit and mint Purpose from
     * @param _isAccelerated use accelerated vest schedule
     * @param _minPurposeReceived min Purpose that should be received; prevents minting unexpectedly lower purpose amount  
     */
    function deposit(address _coinAddr, uint256 _amount, bool _isAccelerated, uint256 _minPurposeReceived)
        external
        isValidCoin(_coinAddr)
        whenNotPaused
    {
        uint decimals = ERC20(_coinAddr).decimals();
        string memory symbol = ERC20(_coinAddr).symbol();

        // We assume that the ERC20 coin is a dollar-based stablecoin. Violating this assumption will require new logic.
        require(_amount >= minimumDepositInUsdNoDecimals * 10**decimals, "PFP: Deposit value too low");
        
        uint256 endowmentAmount = _amount * 85 / 100;
        uint256 purposePrice = getPurposePrice();
        // keep 6 decimals of erc20 token
        uint256 amountInUsd = _amount / 10**(decimals - 6);
        uint256 endowmentAmountInUsd = endowmentAmount / 10**(decimals - 6); 

        // update total endowment contributions
        totalEndowmentContributionsInUsd += endowmentAmountInUsd;
        emit EndowmentIncreased(msg.sender, pfpConfig.endowmentAddr(), totalEndowmentContributionsInUsd, endowmentAmountInUsd, purposePrice);

        // transfer to funds
        IERC20(_coinAddr).safeTransferFrom(msg.sender, pfpConfig.endowmentAddr(), endowmentAmount);
        IERC20(_coinAddr).safeTransferFrom(msg.sender, pfpConfig.foundationAddr(), _amount - endowmentAmount);
        emit CoinDepositReceived(msg.sender, _coinAddr, pfpConfig.endowmentAddr(), pfpConfig.foundationAddr(), _amount);

        // mint and stake
        uint256 tokenAmountToMint = calculateTokensToMint(purposePrice, amountInUsd);
        require(tokenAmountToMint > 0, "PFP: Token amount <= 0.");
        require(tokenAmountToMint >= _minPurposeReceived, "PFP: Token amount < min.");
        purposeToken.mintPurpose(address(genesisPurposeEscrow), tokenAmountToMint);
        genesisPurposeEscrow.stakePurpose(
          msg.sender,
          tokenAmountToMint,
          acceleratedVestAllowed ? _isAccelerated : false,
          purposePrice,
          symbol);
    }

    /**
     * @notice Withdraws all available Purpose and any rewards
     * @param _index vesting schedule index
     */
    function withdrawGenesisPurpose(uint32 _index)
        external
        whenNotPaused
    {
      uint256 withdrawableAmount = genesisPurposeEscrow.calcWithdrawableAmount(msg.sender, _index, block.timestamp);
      if(withdrawableAmount > 0) {
          genesisPurposeEscrow.withdrawPurpose(msg.sender, _index, withdrawableAmount);
      }

      uint256 rewardsAmount = genesisPurposeEscrow.calcAvailableReward(msg.sender, _index, block.timestamp);
      if(rewardsAmount > 0) {
          genesisPurposeEscrow.claimReward(msg.sender, _index, rewardsAmount);
      }
    }


    /**
     * @notice Returns current price of Purpose in US dollars with 6 decimals.
     * @dev During bonding curve phase: every $1M contributed increases price by $0.01
     * @dev Price equation represented by line: y = (10^-8)x + (10^4), where x is total endowment contributions (with 6 decimals for x,y)
     * @return purposePrice current purpose price 
     */
    function getPurposePrice()
        public
        view
        returns (uint256 purposePrice)
    {
        // present price equation as y = mx+c with y as price ($) and x as endowment ($M)
        //    2 points on line: ($2M, $0.03) and ($1M, $0.02); y intercept at $0.01
        //    add 6 decimals to price and endowment
        //      m = (0.03*10^6 - 0.02*10^6) / (2M*10^6 - 1M*10^6) = 10^4 / 10^12 = 1/10^8;
        //      c = 0.01^10^6;
        //      y = x/10^8 + 10^4
        //    and multiply terms with denominator to perform division last
        //      y = (x + 10^12) / 10^8;
        purposePrice = (totalEndowmentContributionsInUsd + 1e12)/1e8;
    }

    /**
     * @notice Calculates tokens to mint based on Purpose price and deposit amount
     * @param _purposePrice purpose price in US Dollars with 6 decimals
     * @param _depositAmountUSD purpose price in US Dollars with 6 decimals
     * @return tokensToMint num tokens to mint (with token's 18 decimals)
     */
    function calculateTokensToMint(uint256 _purposePrice, uint256 _depositAmountUSD)
        public
        pure
       returns (uint256 tokensToMint)
    {
        require(_purposePrice > 0, "PFP: price <= 0");
        tokensToMint = _depositAmountUSD * 1e18 / _purposePrice;
    }

    /**
     * @notice Returns contributor account details
     * @param _owner address of the contributor
     */
    function getAccountDetails(address _owner) 
        external
        view
        returns (AccountState memory)
    {
        (GenesisPurposeEscrow.VestSchedule[] memory schedules, uint32 count) = genesisPurposeEscrow.getVestSchedules(_owner);
        AccountState memory accountState;
        accountState.transactions = new AccountTransaction[](count);

        uint256 totalPurposeInEscrow = 0;
        uint256 totalRewardsPaid = 0;
        for (uint32 i = 0; i < count; i++) {
            AccountTransaction memory transaction;
            
            transaction.currentReward = genesisPurposeEscrow.calcTotalReward(_owner, i, block.timestamp);
            transaction.currentAmount = genesisPurposeEscrow.calcWithdrawableAmount(_owner, i, block.timestamp);

            // tally purpose still in escrow
            uint256 initialPurposeStaked = schedules[i].initBalance;
            totalPurposeInEscrow += initialPurposeStaked - schedules[i].withdrawnBalance;
            totalRewardsPaid += schedules[i].paidReward;

            // vest schedule and tranches
            transaction.schedule = schedules[i];
            transaction.tranches = new TransactionTranche[](5);
            uint64 trancheDate = schedules[i].vestStartingDate;
            for (uint32 j = 0; j < 5; j++) {
                TransactionTranche memory tranche;
                tranche.dateAvailable = trancheDate;
                tranche.amountAvailable = genesisPurposeEscrow.calcWithdrawableAmount(_owner, i, trancheDate);
                tranche.rewardAvailable = genesisPurposeEscrow.calcAvailableReward(_owner, i, trancheDate);
                transaction.tranches[j] = tranche;

                trancheDate = uint64(BokkyPooBahsDateTimeLibrary.addMonths(trancheDate, 6));
            }

            accountState.transactions[i] = transaction;
        }

        accountState.purposeHeld = purposeToken.balanceOf(_owner);
        accountState.purposeStaked = totalPurposeInEscrow;
        accountState.rewardsPaid = totalRewardsPaid;

        return accountState;
    }

    function validEthDepositAmount(uint256 _depositValue, uint256 _ethUsdPrice, uint256 _minimumDepositInUsdNoDecimals)
        private
        pure
        returns (bool)
    {
        // 1 ether * 1e8 / ethUsdPrice is equal to 1USD in wei.
	      // Therefore, multiplying it by minimumDepositInUsd gives us the minimum deposit amount in wei.
        return _depositValue >= _minimumDepositInUsdNoDecimals * 1 ether * 1e8 / _ethUsdPrice;
    }
}
