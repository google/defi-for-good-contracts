//SPDX-License-Identifier: Apache-2.0

/// @title ProdPFPConfig
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

import "./IPFPConfig.sol";

contract ProdPFPConfig is IPFPConfig {
    /* solhint-disable const-name-snakecase */
    address override public constant endowmentAddr = 0x0000000000000000000000000000000000000000;
    address override public constant foundationAddr = 0x0000000000000000000000000000000000000000;
    address override public constant roleManager = 0x0000000000000000000000000000000000000000;
    /* solhint-enable const-name-snakecase */
}
