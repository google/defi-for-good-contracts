//SPDX-License-Identifier: Apache-2.0

/// @title Echidna tests for withdrawing and claiming of rewards
/// @author Alexander Remie, Trail of Bits
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
import "../../PFP.sol";
import "../../GenesisPurposeEscrow.sol";

contract PriceConsumerV3Mock {
    int256 private price;

    function setPrice(int256 _newPrice) public {
        price = _newPrice;
    }

    function getLatestPrice() public view returns (int256) {
        return price;
    }
}

contract EchidnaPFP {
    MockPFPConfig config;
    PriceConsumerV3Mock oracle;
    MockERC20 stable;
    PurposeToken purpose;
    PFP pfp;
    GenesisPurposeEscrow genesis;
    uint256 private constant ORACLE_DECIMALS = 10**8; // chainlink has 8 decimals

    constructor() {
        oracle = new PriceConsumerV3Mock();
        stable = new MockERC20("USDC", "USDC", 100_000, 6);
        config = new MockPFPConfig(address(this));
        purpose = new PurposeToken(address(config));
        genesis = new GenesisPurposeEscrow(address(purpose), address(config));
        pfp = new PFP(
            address(purpose),
            address(genesis),
            address(config),
            address(oracle)
        );
        pfp.grantRole(pfp.ADMIN_ROLE(), address(this));
        pfp.addCoinAddr(address(stable));
        genesis.grantRole(genesis.STAKER_ROLE(), address(pfp));
        stable.approve(address(pfp), type(uint256).max);
        oracle.setPrice(int256(1_000 * ORACLE_DECIMALS)); // $1000 per 1 ETH
    }

    function test_depositEth_leftover(bool _isAccelerated) public payable {
        require(msg.value > 0);
        pfp.depositEth{value: msg.value}(_isAccelerated, 0);
        assert(address(pfp).balance == 0);
    }

    function test_depositEth_zeroOut(bool _isAccelerated) public payable {
        require(msg.value > 0);
        uint256 purposeBalBefore = purpose.balanceOf(address(genesis));
        pfp.depositEth{value: msg.value}(_isAccelerated, 0);
        uint256 purposeBalAfter = purpose.balanceOf(address(genesis));
        assert(purposeBalAfter > purposeBalBefore);
    }

    function test_depositEth_inNotActualIn(bool _isAccelerated) public payable {
        require(msg.value > 0);
        uint256 ethBalBeforeEndowment = config.endowmentAddr().balance;
        uint256 ethBalBeforeFoundation = config.foundationAddr().balance;
        pfp.depositEth{value: msg.value}(_isAccelerated, 0);
        uint256 ethBalAfterEndowment = config.endowmentAddr().balance;
        uint256 ethBalAfterFoundation = config.foundationAddr().balance;
        assert(
            msg.value ==
                (ethBalAfterEndowment -
                    ethBalBeforeEndowment +
                    ethBalAfterFoundation -
                    ethBalBeforeFoundation)
        );
    }

    function test_depositEth_zeroInPositiveOut(bool _isAccelerated) public {
        uint256 purposeBalBefore = purpose.balanceOf(address(genesis));
        pfp.depositEth{value: 0}(_isAccelerated, 0);
        uint256 purposeBalAfter = purpose.balanceOf(address(genesis));
        assert(purposeBalAfter == purposeBalBefore);
    }

    function test_deposit_leftover(bool _isAccelerated, uint256 _amount)
        public
    {
        require(_amount > 0);
        pfp.deposit(address(stable), _amount, _isAccelerated, 0);
        assert(purpose.balanceOf(address(pfp)) == 0);
    }

    function test_deposit_inNotActualIn(bool _isAccelerated, uint256 _amount)
        public
    {
        require(_amount > 0);
        uint256 stableBalBeforeEndowment = stable.balanceOf(
            config.endowmentAddr()
        );
        uint256 stableBalBeforeFoundation = stable.balanceOf(
            config.foundationAddr()
        );
        pfp.deposit(address(stable), _amount, _isAccelerated, 0);
        uint256 stableBalAfterEndowment = stable.balanceOf(
            config.endowmentAddr()
        );
        uint256 stableBalAfterFoundation = stable.balanceOf(
            config.foundationAddr()
        );
        assert(
            _amount ==
                (stableBalAfterEndowment -
                    stableBalBeforeEndowment +
                    stableBalAfterFoundation -
                    stableBalBeforeFoundation)
        );
    }

    function test_deposit_zeroOut(bool _isAccelerated, uint256 _amount) public {
        require(_amount > 0);
        uint256 purposeBalBefore = purpose.balanceOf(address(genesis));
        pfp.deposit(address(stable), _amount, _isAccelerated, 0);
        uint256 purposeBalAfter = purpose.balanceOf(address(genesis));
        assert(purposeBalAfter > purposeBalBefore);
    }

    function test_deposit_zeroInPositiveOut(bool _isAccelerated) public {
        uint256 purposeBalBefore = purpose.balanceOf(address(genesis));
        pfp.deposit(address(stable), 0, _isAccelerated, 0);
        uint256 purposeBalAfter = purpose.balanceOf(address(genesis));
        assert(purposeBalAfter == purposeBalBefore);
    }
}
