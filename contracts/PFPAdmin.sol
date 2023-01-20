//SPDX-License-Identifier: Apache-2.0

/// @title PFPAdmin
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

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./PFPConfig/IPFPConfig.sol";


contract PFPAdmin is AccessControl, Pausable {
    /// @notice RBAC: accounts in this role are allowed to perform PFP Admin functions
    bytes32 public constant ADMIN_ROLE = keccak256("PFP_ADMIN_ROLE");
    /// @notice RBAC: accounts in this role are allowed to perform PFP Break Glass functions
    bytes32 public constant BREAK_GLASS_ROLE = keccak256("PFP_BREAK_GLASS_ROLE");

    mapping(address => bool) private allowedCoinList;
    uint256 internal minimumDepositInUsdNoDecimals;
    bool internal acceleratedVestAllowed;

    /**
     * @notice Emitted when admin adds a new allowed stablecoin
     * @param _coinAddr address of erc20 token/coin added
     */
    event AllowedCoinAdded(address indexed _coinAddr);
    /**
     * @notice Emitted when admin removes stablecoin from allowlist
     * @param _coinAddr address of erc20 token/coin removed
     */
    event AllowedCoinRemoved(address indexed _coinAddr);
    /**
     * @notice Emitted when admin updates minimum deposit amount
     * @param _amount new min deposit amount in USD (no decimals)
     */
    event MinimumDepositUpdated(uint256 _amount);
    /**
     * @notice Emitted when admin updates whether accelerated vest schedules are allowed
     * @param _allowed true to allow accelerated vesting, false to disallow
     */
    event AcceleratedVestAllowedUpdated(bool _allowed);

    /**
     * @notice Inherited by PFP; Used to house privileged admin functions
     * @param _pfpConfigAddr address of pfp config contract
     */
    constructor(address _pfpConfigAddr) {
        require(_pfpConfigAddr != address(0), "PFPAdmin: zero address");

        IPFPConfig pfpConfig = IPFPConfig(_pfpConfigAddr);

        // only roleManager will be able to grant/deny Admins
        _setupRole(DEFAULT_ADMIN_ROLE, pfpConfig.roleManager());

        minimumDepositInUsdNoDecimals = 5;
        acceleratedVestAllowed = false;
    }

    modifier isValidCoin(address _addr) {
        require(allowedCoinList[_addr], "PFPAdmin: invalid coin");
        _;
    }

    modifier isNotZeroAddr(address _addr) {
        require(_addr != address(0), "PFPAdmin: zero address");
        _;
    }

    /**
     * @notice Add USD-based stablecoin to allowlist
     * @dev caller needs ADMIN_ROLE
     * @param _coinAddr address of erc20 token/coin to add
     */
    function addCoinAddr(address _coinAddr)
        external
        onlyRole(ADMIN_ROLE)
        isNotZeroAddr(_coinAddr)
    {
        require(!allowedCoinList[_coinAddr], "PFPAdmin: coin addr registered");

        allowedCoinList[_coinAddr] = true;

        emit AllowedCoinAdded(_coinAddr);
    }

    /**
     * @notice Remove USD-based stablecoin from allowlist
     * @dev caller needs ADMIN_ROLE
     * @param _coinAddr address of erc20 token/coin to remove
     */
    function removeCoinAddr(address _coinAddr)
        external
        onlyRole(ADMIN_ROLE)
        isValidCoin(_coinAddr)
    {
        allowedCoinList[_coinAddr] = false;

        emit AllowedCoinRemoved(_coinAddr);
    }

    /**
     * @notice Update minimum deposit allowed (in USD)
     * @dev caller needs ADMIN_ROLE
     * @param _amountInUsd in usd with no decimals
     */
    function updateMinimumDeposit(uint256 _amountInUsd)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(minimumDepositInUsdNoDecimals != _amountInUsd, "PFPAdmin: value equals current");

        minimumDepositInUsdNoDecimals = _amountInUsd;
        emit MinimumDepositUpdated(_amountInUsd);
    }

    /**
     * @notice Update whether accelerated vest schedules are allowed or not
     * @dev caller needs ADMIN_ROLE
     * @param _allowed true to allow accelerated vesting, false to disallow
     */
    function updateAcceleratedVestAllowed(bool _allowed)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(acceleratedVestAllowed != _allowed, "PFPAdmin: value equals current");

        acceleratedVestAllowed = _allowed;
        emit AcceleratedVestAllowedUpdated(_allowed);
    }

    /**
     * @notice Pause deposit and withdrawal methods
     * @dev caller needs BREAK_GLASS_ROLE
     */
    function pauseProtocol()
        external
        onlyRole(BREAK_GLASS_ROLE)
    {
        _pause();
    }

    /**
     * @notice Unpause protocol, deposit and withdrawals are available
     * @dev caller needs ADMIN_ROLE
     */
    function unpauseProtocol()
        external
        onlyRole(ADMIN_ROLE)
    {
        _unpause();
    }
}
