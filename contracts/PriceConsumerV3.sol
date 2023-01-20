//SPDX-License-Identifier: Apache-2.0

/// @title The PriceConsumerV3 contract
/// @notice A wrapper contract for Chainlink Price Feeds
/// @author github.com/valynislives
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

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PriceConsumerV3 {
    AggregatorV3Interface internal immutable priceFeed;

    /**
     * @notice Wrapper for Chainlink price feeds
     * @param _priceFeed Price feed address
     */
    constructor(address _priceFeed) {
        require(_priceFeed != address(0), "PriceConsumerV3: zero address");

        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    /**
     * @notice Returns the latest price
     */
    function getLatestPrice()
        external
        view
        returns (uint256)
    {
        (
            /* uint80 roundID */,
            int256 price,
            /* uint256 startedAt */,
            /* uint256 timeStamp */,
            /* uint80 answeredInRound */
        ) = priceFeed.latestRoundData();

        require(price > 0, "PriceConsumerV3: price <= 0");
        return uint256(price);
    }

    /**
     * @notice Returns the Price feed address
     */
    function getPriceFeed()
        external
        view 
        returns (AggregatorV3Interface)
    {
        return priceFeed;
    }
}
