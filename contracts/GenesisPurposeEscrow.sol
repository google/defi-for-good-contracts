//SPDX-License-Identifier: Apache-2.0

/// @title GenesisPurposeEscrow
/// @author github.com/billyzhang663
/// @author github.com/garthbrydon

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

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./PurposeToken.sol";
import "./PFPConfig/IPFPConfig.sol";
import "./libraries/ABDKMath64x64.sol";
import "./libraries/BokkyPooBahsDateTimeLibrary.sol";

contract GenesisPurposeEscrow is AccessControl {
    using SafeERC20 for PurposeToken;

    bytes32 public constant ADMIN_ROLE = keccak256("PFP_ADMIN_ROLE");
    bytes32 public constant STAKER_ROLE = keccak256("GENESIS_STAKER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("GENESIS_WITHDRAWER_ROLE");
    IPFPConfig public pfpConfig;    
    PurposeToken public purposeToken;

    uint64 private interestRate;   // with 8 decimals

    struct VestSchedule {
        // initial balance that contributor deposits into the contract
        uint256 initBalance;
        // total amount of contributor withdrawal
        uint256 withdrawnBalance;
        // total amount of reward that contributor received
        uint256 paidReward;
        // price of purpose at deposit time
        uint256 purposePrice;
        // whether or not vesting is accelerated
        bool isAccelerated;
        // deposit time in sec
        uint64 createdAt;
        // time in sec of the last withdrawal
        uint64 vestStartingDate;
        // interest rate at time of deposit
        uint64 interestRate;
        // symbol of erc20 token or ETH
        string depositTokenSymbol;
    }

    // vest schedule storage variables
    mapping(address => mapping(uint32 => VestSchedule)) public vestSchedules;
    mapping(address => uint32) public numVestSchedules;

    uint8[5] public withdrawablePercents = [
        10,
        25,
        50,
        75,
        100
    ];

    uint8[5] public vestingStepPercents = [
        10,
        15,
        25,
        25,
        25
    ];

    // event definitions
    
    /**
     * @notice Emitted when admin updates interest rate amount
     * @param _amount new interest amount with 8 decimals
     */
    event InterestRateUpdated(uint64 _amount);
    /**
     * @notice Emitted when staker deposits purpose token successfully
     * @param _addr staker's wallet address
     * @param _amount the staked amount of purpose token
     */
    event PurposeStaked(address indexed _addr, uint256 _amount);
    /**
     * @notice Emitted when staker withdraws purpose token successfully
     * @param _addr staker's wallet address
     * @param _amount the withdrawn amount of purpose token
     */
    event PurposeWithdrawn(address indexed _addr, uint256 _amount);
    /**
     * @notice Emitted when staker withdraws reward purpose token successfully
     * @param _addr staker's wallet address
     * @param _amount the claimed reward amount of purpose token
     */
    event PurposeRewardWithdrawn(address indexed _addr, uint256 _amount);

    /**
     * @dev Creates a GenesisPurposeEscrow contract.
     * @param _purposeTokenAddr address of purpose token contract
     * @param _pfpConfigAddr address of IPFPConfig contract
     */
    constructor(address _purposeTokenAddr, address _pfpConfigAddr) {
        require(_purposeTokenAddr != address(0), "Escrow: zero address");
        require(_pfpConfigAddr != address(0), "Escrow: zero address");

        purposeToken = PurposeToken(_purposeTokenAddr);
        pfpConfig = IPFPConfig(_pfpConfigAddr);
        interestRate = 0;

        // only roleManager will be able to grant/deny Admins, Stakers
        _setupRole(DEFAULT_ADMIN_ROLE, pfpConfig.roleManager());
    }

    /**
     * @dev Reverts if vesting schedule index is unavailable
     * @param _owner address of contributor
     * @param _index vesting schedule index
     */
    modifier isIndexAvailable(address _owner, uint32 _index) {
        require(
            numVestSchedules[_owner] > _index,
            "Escrow: Unavailable index"
        );
        _;
    }

    /**
     * @dev Reverts if vesting schedule is unavailable in 6 or 12 months
     * @param _owner address of contributor
     * @param _index vesting schedule index
     */
    modifier isWithdrawable(address _owner, uint32 _index) {
        VestSchedule memory vestSchedule = vestSchedules[_owner][_index];
        require(
            block.timestamp > vestSchedule.vestStartingDate,
            "Escrow: No withdrawable amount"
        );
        _;
    }

    /**
     * @notice Creates a new vesting schedule by staking purpose
     * @param _owner address of the contributor
     * @param _amount total amount of tokens to be released at the end of the vesting
     * @param _isAccelerated whether the vesting is accelerated or not
     * @param _purposePrice the price of purpose token when the staker deposits token 
     */
    function stakePurpose(address _owner, uint256 _amount, bool _isAccelerated, uint256 _purposePrice, string memory _symbol)
      external
      onlyRole(STAKER_ROLE)
    {
        require(_amount > 0, "Escrow: Purpose amount <= 0.");

        uint32 vestScheduleCount = numVestSchedules[_owner];
        uint64 createdAt = uint64(block.timestamp);
        VestSchedule storage vestSchedule = vestSchedules[_owner][vestScheduleCount];
        vestSchedule.initBalance = _amount;
        vestSchedule.createdAt = createdAt;
        vestSchedule.isAccelerated = _isAccelerated;
        vestSchedule.purposePrice = _purposePrice;
        vestSchedule.interestRate = interestRate;
        vestSchedule.depositTokenSymbol = _symbol;

        // The vest schedule will start after 6/12 months
        vestSchedule.vestStartingDate = uint64(_isAccelerated ? BokkyPooBahsDateTimeLibrary.addMonths(block.timestamp, 6) : BokkyPooBahsDateTimeLibrary.addMonths(block.timestamp, 12));

        numVestSchedules[_owner] = vestScheduleCount + 1;
        emit PurposeStaked(_owner, _amount);
    }

    /**
     * @notice Withdraw the specified amount if possible.
     * @param _owner address of the contributor
     * @param _index vesting schedule index
     * @param _amount the amount to withdraw
     */
    function withdrawPurpose(address _owner, uint32 _index, uint256 _amount)
        external
        onlyRole(WITHDRAWER_ROLE)
        isIndexAvailable(_owner, _index)
        isWithdrawable(_owner, _index)
    {
        uint256 withdrawableAmount = calcWithdrawableAmount(_owner, _index, block.timestamp);
        VestSchedule storage vestSchedule = vestSchedules[_owner][_index];

        require(
            withdrawableAmount >= _amount,
            "Escrow: Insufficient amount"
        );

        // Update the total withdrawn balance
        vestSchedule.withdrawnBalance += _amount;

        // Transfer purpose to the contributor wallet address
        purposeToken.safeTransfer(_owner, _amount);
        emit PurposeWithdrawn(_owner, _amount);
    }

    /**
     * @notice Withdraw the specified amount if possible.
     * @dev Should be able to withdraw all purpose staked after 6/12 months. Withdraw should include rewards
     * @param _owner the contributor address
     * @param _index vesting schedule index
     */
    function withdrawPurposeAdmin(address _owner, uint32 _index)
        external
        onlyRole(ADMIN_ROLE)
        isIndexAvailable(_owner, _index)
        isWithdrawable(_owner, _index)
    {
        VestSchedule storage vestSchedule = vestSchedules[_owner][_index];
        uint256 amount = vestSchedule.initBalance - vestSchedule.withdrawnBalance;
        require(
             amount > 0,
            "Escrow: Insufficient amount"
        );

        //  Calculate remaining balance
        uint256 rewardBalance = calcAvailableReward(_owner, _index, block.timestamp);
        
        // Update the total withdrawn balance
        vestSchedule.withdrawnBalance = vestSchedule.initBalance;

        // Transfer staked purpose + rewards to the contributor wallet address
        if (rewardBalance > 0) {
            purposeToken.mintPurpose(address(this), rewardBalance);
        }
        purposeToken.safeTransfer(_owner, amount + rewardBalance);
        
        emit PurposeWithdrawn(_owner, amount + rewardBalance);
    }

    /**
     * @dev Claims reward if possible
     * @param _owner the contributor address
     * @param _index vesting schedule index
     * @param _amount claim reward amount
     */
    function claimReward(address _owner, uint32 _index, uint256 _amount)
        external
        onlyRole(WITHDRAWER_ROLE)
        isIndexAvailable(_owner, _index)
        isWithdrawable(_owner, _index)
    {
        uint256 rewardBalance = calcAvailableReward(_owner, _index, block.timestamp);
        VestSchedule storage vestSchedule = vestSchedules[_owner][_index];

        require(rewardBalance >= _amount, "Escrow: No available reward");

        vestSchedule.paidReward += _amount;

        // Mint purpose to the contributor wallet address
        purposeToken.mintPurpose(_owner, _amount);
        emit PurposeRewardWithdrawn(_owner, _amount);
    }

    /**
     * @notice Updates interest rate for APY
     * @dev caller needs ADMIN_ROLE
     * @dev max interest rate = 100%
     * @param _interestRate new interest rate to use (use 8 decimals)
     */
    function updateInterestRate(uint64 _interestRate)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(interestRate != _interestRate, "Escrow: new value equals current");
        require(_interestRate <= 10000000000, "Escrow: max 100% interest");

        interestRate = _interestRate;
        emit InterestRateUpdated(_interestRate);
    }

    /**
     * @dev Calculates the amount of Purpose that's withdrawable.
     * @return withdrawableAmount available amount
     * @param _owner address of contributor
     * @param _index vesting schedule index
     * @param _timestamp time at which to calculate for
     */
    function calcWithdrawableAmount(address _owner, uint32 _index, uint _timestamp)
        public
        view
        isIndexAvailable(_owner, _index)
        returns (uint256 withdrawableAmount)
    {
        VestSchedule memory vestSchedule = vestSchedules[_owner][_index];
        if (vestSchedule.vestStartingDate > _timestamp) {
          withdrawableAmount = 0;
        }
        else {
          uint256 amount = vestSchedule.initBalance;
        
          // The withdrawable percent will change every 6 months. 
          uint256 halfYearOffset = BokkyPooBahsDateTimeLibrary.diffMonths(vestSchedule.vestStartingDate, _timestamp) / 6;
        
          // Withdrawable percent will always be 100% after vestingScheduleStartingDate + 5 * 6 months
          // So it should be 0 <= WithdrawStepIndex < 5
          uint256 withdrawStepIndex = (halfYearOffset > 4 ? 4 : halfYearOffset);
          uint256 withdrawablePercent = withdrawablePercents[withdrawStepIndex];
          uint256 vestedAmount = (amount * withdrawablePercent) / 100;

          // The previously withdrawn amount should be deducted
          withdrawableAmount = vestSchedule.withdrawnBalance > vestedAmount ? 0 : vestedAmount - vestSchedule.withdrawnBalance;
        }
    }

    /**
     * @dev Returns available reward
     * @return rewardBalance total reward value
     * @param _index vesting schedule index
     * @param _timestamp time at which to calculate for
     */
    function calcAvailableReward(address _owner, uint32 _index, uint _timestamp)
        public
        view
        isIndexAvailable(_owner, _index)
        returns (uint256 rewardBalance)
    {
        VestSchedule storage vestSchedule = vestSchedules[_owner][_index];
        if (vestSchedule.vestStartingDate > _timestamp) {
          rewardBalance = 0;
        }
        else {
          // The previously paid reward amount should be deducted
          uint256 totalReward = calcTotalReward(_owner, _index, _timestamp);
          if(vestSchedule.paidReward > totalReward) {
            rewardBalance = 0;
          }
          else {
            rewardBalance = totalReward - vestSchedule.paidReward; 
          }
        }
    }

    /**
     * @dev Calculates and returns total available reward
     * @return rewardBalance total reward value
     * @param _owner address of contributor
     * @param _index vesting schedule index
     */
    function calcTotalReward(address _owner, uint32 _index, uint _timestamp)
        public
        view
        isIndexAvailable(_owner, _index)
        returns (uint256)
    {
        VestSchedule memory vestSchedule = vestSchedules[_owner][_index];

        if (_timestamp < vestSchedule.vestStartingDate) {
            // Available Reward = Initial Amount * (1 + InterestRate / 365) ** days
            // InterstRate is percent value
            // To use the fixed float of interest rate, it times 1e8
            // So it should be devided by 1e8 * 1e2 = 1e10
            uint256 availableDays = BokkyPooBahsDateTimeLibrary.diffDays(vestSchedule.createdAt, _timestamp);
            uint256 availableReward = ABDKMath64x64.mulu(
                                        ABDKMath64x64.pow(
                                            ABDKMath64x64.add(
                                                ABDKMath64x64.fromUInt(1),
                                                ABDKMath64x64.divu(vestSchedule.interestRate, 365 * 1e10)
                                            ),
                                            availableDays
                                        ),
                                        vestSchedule.initBalance
                                    );
            return availableReward - vestSchedule.initBalance;
        } else {
            uint256 diffMonthsToStartingDate = (vestSchedule.isAccelerated?6:12);
            // The maximum vest schedule steps is 5
            uint256 vestScheduleSteps = (BokkyPooBahsDateTimeLibrary.diffMonths(vestSchedule.createdAt, _timestamp) - diffMonthsToStartingDate) / 6 + 1;
            vestScheduleSteps = (vestScheduleSteps > 5?5:vestScheduleSteps);
            
            uint256 stepIndex = 0;
            uint256 stepLastTime = vestSchedule.vestStartingDate;
            uint256 sumReward = 0;
            uint256 sumStepAmount = 0;
            uint256 remainingPercent = 100;

            while (stepIndex < vestScheduleSteps) {
                uint256 stepPercent = (stepIndex==vestScheduleSteps?remainingPercent:vestingStepPercents[stepIndex]);
                uint256 stepAmount = vestSchedule.initBalance * stepPercent / 100;
                uint256 stepReward = ABDKMath64x64.mulu(
                                            ABDKMath64x64.pow(
                                                ABDKMath64x64.add(
                                                    ABDKMath64x64.fromUInt(1),
                                                    ABDKMath64x64.divu(vestSchedule.interestRate, 365 * 1e10)
                                                ),
                                                BokkyPooBahsDateTimeLibrary.diffDays(vestSchedule.createdAt, stepLastTime)
                                            ),
                                            stepAmount
                                    );
                sumReward += stepReward;
                sumStepAmount += stepAmount;

                remainingPercent -= vestingStepPercents[stepIndex];
                stepIndex++;
                if (BokkyPooBahsDateTimeLibrary.addMonths(stepLastTime, 6) > _timestamp) {
                    stepLastTime = _timestamp;
                } else {
                    stepLastTime = BokkyPooBahsDateTimeLibrary.addMonths(stepLastTime, 6);
                }
            }
            return sumReward - sumStepAmount;
        }
    }

    /**
     * @dev get the list of staker's vest schedules
     * @param _addr staker address
     */
    function getVestSchedules(address _addr)
        external
        view
        returns (VestSchedule[] memory, uint32) 
    {
        require(numVestSchedules[_addr] > 0, "Escrow: Address not found");

        uint32 count = numVestSchedules[_addr];
        VestSchedule[] memory schedules = new VestSchedule[](count);

        for (uint32 i = 0; i < count; i++) {
            schedules[i] = vestSchedules[_addr][i];
        }

        return (schedules, count);
    }
}
