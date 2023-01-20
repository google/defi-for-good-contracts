//SPDX-License-Identifier: Apache-2.0

/// @title MockPFPConfig
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

contract MockPFPConfig {
    address public immutable endowmentAddr;
    address public immutable foundationAddr;
    address public immutable roleManager;

    constructor(address _acc) {
        endowmentAddr = 0x549451Db725F91eF47B5f2c365c02980329f1d99;
        foundationAddr = 0x4b187da1d5e1c3cd2b137a094aF89262C0756836;
        roleManager = _acc;
    }
}