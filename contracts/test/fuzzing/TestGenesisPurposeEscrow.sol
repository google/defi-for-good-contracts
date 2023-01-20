//SPDX-License-Identifier: Apache-2.0

/// @title Echidna tests for withdrawing and claiming of rewards
/// @author Vara Prasad Bandaru, Trail of Bits
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

import "../../PFPConfig/IPFPConfig.sol";
import "../../test/MockERC20.sol";
import "../../test/MockPFPConfig.sol";
import "../../PurposeToken.sol";
import "../../GenesisPurposeEscrow.sol";

interface HEVMCheatCodes {
    function warp(uint256 x) external;
}

contract EchidnaGenesisPurposeEscrow {
    MockPFPConfig config;
    PurposeToken purpose;
    GenesisPurposeEscrow genesis;
    HEVMCheatCodes hevmCheatCodes;

    // Information about each testcase
    struct StakingInformation {
        uint8 numberOfTermsWithdrawn; // equal to 1 -> 10% has been withdrawn, = 2 -> 10% + 15% has been withdrawn
        bool claimedReward; // total reward has been claimed
        bool isAccelerated; // vest is accelerated
        uint256 depositedAmount; // initial amount deposited
        uint256 totalWithdrawnAmount; // amount withdrawn for this vest
        uint256 timestamp; // unscaled block.timestamp -> vest creation time
        uint32 indexInGenesisVestSchedules; // index of vest schedule in GenesisPurposeEscrow
    }

    // testcases
    mapping(address => StakingInformation[]) testVests;
    // store whether a address has been passed as argument to stakePurpose i.e there are vest schedules for these address.
    // created on the assumption -> it guides echidna to pass addresses for owner that are passed to stakePurpose.
    mapping(address => bool) ownerStaked;
    mapping(address => uint32) ownerStakingIndices;
    // withdraws percentage for each terms
    uint8[5] withdrawablePercentsByTerm = [10, 15, 25, 25, 25];
    uint256 private constant TOTAL_NUMBER_OF_TERMS = 5;
    int128 rewardPercentageAccelerated = ABDKMath64x64.divu(95, 10); // 9.5%
    int128 rewardPercentageUnaccelerated = ABDKMath64x64.divu(199, 10); // 19.9%

    // event InfoEvent(uint, uint, uint);
    // event PercentageEvent(int128, int128);
    constructor() {
        config = new MockPFPConfig(address(this));
        purpose = new PurposeToken(address(config));
        genesis = new GenesisPurposeEscrow(address(purpose), address(config));
        hevmCheatCodes = HEVMCheatCodes(
            address(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D)
        );
        purpose.grantRole(purpose.MINTER_ROLE(), address(this));
        purpose.grantRole(purpose.BURNER_ROLE(), address(this));
        purpose.grantRole(purpose.MINTER_ROLE(), address(genesis));
        purpose.grantRole(purpose.BURNER_ROLE(), address(genesis));
        genesis.grantRole(genesis.STAKER_ROLE(), address(this));
        genesis.grantRole(genesis.WITHDRAWER_ROLE(), address(this));
        genesis.grantRole(genesis.ADMIN_ROLE(), address(this));
    }

    function removeTestCaseAtIndex(
        StakingInformation[] storage _ownerTestCases,
        uint256 _index
    ) private {
        _ownerTestCases[_index] = _ownerTestCases[_ownerTestCases.length - 1];
        _ownerTestCases.pop();
    }

    function moveTimestamp(uint256 _depositTimestamp, uint256 _termsToMove)
        private
    {
        // Each term is 6 months. moveTimestamp updates timestamp to _depositTimestamp + _terms * (6 months).
        uint256 newTimestamp = BokkyPooBahsDateTimeLibrary.addMonths(
            _depositTimestamp,
            _termsToMove * 6
        );
        newTimestamp += 3600; // adds a day
        hevmCheatCodes.warp(newTimestamp);
    }

    function checkPercentage(
        uint256 amount,
        uint256 totalAmount,
        int128 percentage
    ) private returns (bool) {
        // verify that amount is greater than percentage % of totalAmount
        // => (amount * 100)/totalAmount > percentage
        int128 amountPercentage = ABDKMath64x64.divu(amount * 100, totalAmount);

        assert(amountPercentage >= percentage);
        return true;
    }

    function stakePurpose(
        address _owner,
        uint72 _amount,
        bool _isAccelerated
    ) public {
        require(_owner != address(0x0));
        require(_amount > type(uint32).max);
        require(_owner != address(genesis));
        StakingInformation memory info;
        info.numberOfTermsWithdrawn = 0;
        info.claimedReward = false;
        info.isAccelerated = _isAccelerated;
        info.depositedAmount = _amount;
        info.totalWithdrawnAmount = 0;
        info.timestamp = block.timestamp;
        info.indexInGenesisVestSchedules = ownerStakingIndices[_owner];
        testVests[_owner].push(info);
        ownerStakingIndices[_owner] += 1;
        if (!ownerStaked[_owner]) {
            ownerStaked[_owner] = true;
        }
        purpose.mintPurpose(address(genesis), _amount);
        genesis.stakePurpose(_owner, _amount, _isAccelerated, 1, "ETH");
    }

    function claimAndVerifyRewards(address _owner, uint32 _index) private {
        StakingInformation storage info = testVests[_owner][_index];
        // check availableReward > expected percentage of total deposit
        uint256 availableReward = genesis.calcAvailableReward(
            _owner,
            info.indexInGenesisVestSchedules,
            block.timestamp
        );
        int128 rewardPercentage = info.isAccelerated
            ? rewardPercentageAccelerated
            : rewardPercentageUnaccelerated;
        uint256 totalAmount = info.depositedAmount;
        uint256 purposeBalBefore = purpose.balanceOf(_owner);
        genesis.claimReward(
            _owner,
            info.indexInGenesisVestSchedules,
            availableReward
        );
        uint256 purposeBalAfter = purpose.balanceOf(_owner);
        assert(purposeBalAfter - purposeBalBefore == availableReward);
        info.claimedReward = true;
        info.totalWithdrawnAmount += availableReward;
    }

    // withdraw amount for **_terms** new terms.
    // e.g if 10% + 15% + 25% has been withdraw for a vest and _terms = 2,
    // then info.numberOfTermsWithdrawn == 3 and tries to withdraw amount for last two terms(4th and 5th).
    function testWithdrawPurpose(
        address _owner,
        uint32 _index,
        uint8 _terms
    ) public {
        require(ownerStaked[_owner]);
        require(testVests[_owner].length > 0);
        require(0 < _terms && _terms <= TOTAL_NUMBER_OF_TERMS);
        _index = uint32(_index % testVests[_owner].length);
        StakingInformation storage info = testVests[_owner][_index];
        if (info.numberOfTermsWithdrawn + _terms > TOTAL_NUMBER_OF_TERMS) {
            _terms = uint8(TOTAL_NUMBER_OF_TERMS - info.numberOfTermsWithdrawn);
        }
        uint256 withdrawAmountPercentage = 0;
        for (uint256 i = 0; i < _terms; i++) {
            withdrawAmountPercentage += withdrawablePercentsByTerm[
                info.numberOfTermsWithdrawn + i
            ];
        }
        uint256 numberOfTermsForFirstVesting = info.isAccelerated ? 0 : 1;
        uint256 numberOfTermsToMove = numberOfTermsForFirstVesting +
            info.numberOfTermsWithdrawn +
            _terms;
        moveTimestamp(info.timestamp, numberOfTermsToMove);
        uint256 withdrawableAmount = genesis.calcWithdrawableAmount(
            _owner,
            info.indexInGenesisVestSchedules,
            block.timestamp
        );
        uint256 totalAmount = info.depositedAmount;
        int128 percentage = ABDKMath64x64.fromUInt(
            withdrawAmountPercentage - 1
        );
        uint256 purposeBalBefore = purpose.balanceOf(_owner);
        genesis.withdrawPurpose(
            _owner,
            info.indexInGenesisVestSchedules,
            withdrawableAmount
        );
        uint256 purposeBalAfter = purpose.balanceOf(_owner);
        assert(purposeBalAfter - purposeBalBefore == withdrawableAmount);
        info.totalWithdrawnAmount += withdrawableAmount;
        info.numberOfTermsWithdrawn += _terms;
        if (!info.claimedReward) {
            claimAndVerifyRewards(_owner, _index);
        }
        if (info.numberOfTermsWithdrawn == TOTAL_NUMBER_OF_TERMS) {
            removeTestCaseAtIndex(testVests[_owner], _index);
        }
    }

    function testWithdrawPurposeAdmin(
        address _owner,
        uint32 _index,
        uint8 _terms
    ) public {
        require(ownerStaked[_owner]);
        require(testVests[_owner].length > 0);
        require(0 < _terms && _terms <= TOTAL_NUMBER_OF_TERMS);
        _index = uint32(_index % testVests[_owner].length);
        StakingInformation storage info = testVests[_owner][_index];
        if (info.numberOfTermsWithdrawn + _terms > TOTAL_NUMBER_OF_TERMS) {
            _terms = uint8(TOTAL_NUMBER_OF_TERMS - info.numberOfTermsWithdrawn);
        }
        uint256 numberOfTermsForFirstVesting = info.isAccelerated ? 0 : 1;
        uint256 numberOfTermsToMove = numberOfTermsForFirstVesting +
            info.numberOfTermsWithdrawn +
            _terms;
        moveTimestamp(info.timestamp, numberOfTermsToMove);
        uint256 purposeBalBefore = purpose.balanceOf(_owner);
        genesis.withdrawPurposeAdmin(_owner, info.indexInGenesisVestSchedules);
        uint256 purposeBalAfter = purpose.balanceOf(_owner);
        info.totalWithdrawnAmount += purposeBalAfter - purposeBalBefore;
        // check that total withdrawn purpose > deposited purpose
        assert(info.totalWithdrawnAmount >= info.depositedAmount);
        uint256 rewardAmount = info.totalWithdrawnAmount - info.depositedAmount;
        assert(rewardAmount >= 0);
        // remove testcase/vestschedule as total amount is withdrawn and verified.
        removeTestCaseAtIndex(testVests[_owner], _index);
    }
}
