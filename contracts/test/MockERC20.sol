//SPDX-License-Identifier: Apache-2.0

/// @title MockERC20
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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable mockDecimals;

    constructor(string memory _name, string memory _symbol,
      uint256 _initialSupply, uint8 _decimals) ERC20(_name, _symbol) {
        _mint(msg.sender, _initialSupply * 10**_decimals);
        mockDecimals = _decimals;
    }

    function decimals() public view override returns (uint8) {
		    return mockDecimals;
	  }
}