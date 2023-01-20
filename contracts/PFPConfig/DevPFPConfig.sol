//SPDX-License-Identifier: Apache-2.0

/// @title DevPFPConfig
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

import "./IPFPConfig.sol";

contract DevPFPConfig is IPFPConfig {
    /* solhint-disable const-name-snakecase */
    address override public constant endowmentAddr = 0x4Ef5ab360E1A04ef73C7A2309a605e5caf4BEEcb;
    address override public constant foundationAddr = 0xbc1ddCaC1555224Ee4F141e140ea7AeB58793eF8;
    address override public constant roleManager = 0xAF8285f1b52BfaC89569673A5bC0239CAd88a64F;
    /* solhint-enable const-name-snakecase */
}
