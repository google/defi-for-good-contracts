//SPDX-License-Identifier: Apache-2.0

/// @title PurposeToken Token (a utility token)
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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./PFPConfig/IPFPConfig.sol";

contract PurposeToken is ERC20, AccessControl {
    /// @notice RBAC: accounts in this role are allowed to mint Purpose Tokens
    bytes32 public constant MINTER_ROLE = keccak256("PFP_MINTER_ROLE");
    /// @notice RBAC: accounts in this role are allowed to burn Purpose Tokens
    bytes32 public constant BURNER_ROLE = keccak256("PFP_BURNER_ROLE");
    IPFPConfig private pfpConfig;

    /**
     * @notice Emitted when Purpose tokens are minted
     * @param _addr address that owns tokens
     * @param _amount amount of tokens minted
     */
    event MintPurpose(address indexed _addr, uint256 _amount);
    /**
     * @notice Emitted when Purpose tokens are burned
     * @param _addr address that tokens we taken out of
     * @param _amount amount of tokens burned
     */
    event BurnPurpose(address indexed _addr, uint256 _amount);
    
    /**
     * @notice ERC20 utility token for PFP Protocol
     * @param _pfpConfigAddr address of pfp config contract
     */
    constructor(
        address _pfpConfigAddr
    ) ERC20("PURPOSE Token", "PURPOSE") {
        require(_pfpConfigAddr != address(0), "PurposeToken: zero address");

        pfpConfig = IPFPConfig(_pfpConfigAddr);

        // only roleManager will be able to grant/deny Minters
        _setupRole(DEFAULT_ADMIN_ROLE, pfpConfig.roleManager());
    }

    /**
     * @notice Function to burn Purpose tokens; used by protocol to manage token supply
     * @dev caller needs BURNER_ROLE
     * @param _addr address of account to burn from
     * @param _amount number of Purpose tokens to burn 
     */
    function burnPurpose(address _addr, uint256 _amount) 
        external 
        onlyRole(BURNER_ROLE)
        returns (bool) 
    {
        require(_amount <= balanceOf(_addr), "PurposeToken: not enough balance");

        _burn(_addr, _amount);
        
        emit BurnPurpose(_addr, _amount);
        return true;
    }

    /**
     * @notice Function to mint Purpose tokens
     * @dev caller needs MINTER_ROLE
     * @param _addr address of account to mint into
     * @param _amount number of Purpose tokens to mint 
     */
    function mintPurpose(address _addr, uint256 _amount)
      external
      onlyRole(MINTER_ROLE)
    {
        _mint(_addr, _amount);

        emit MintPurpose(_addr, _amount);
    }
}
