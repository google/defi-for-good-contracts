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

/* eslint-disable node/no-missing-import */
/* eslint-disable camelcase */
import { expect, use } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  PriceConsumerV3,
  PriceConsumerV3__factory,
  MockV3Aggregator,
  MockV3Aggregator__factory,
} from "../../build/types";
import { smock, MockContract } from "@defi-wonderland/smock";
import { ZERO_ADDRESS } from "../test-helpers/constants";

use(smock.matchers);

describe("PriceConsumerV3", function () {
  let priceConsumerV3: PriceConsumerV3;
  let mockV3Aggregator: MockContract<MockV3Aggregator>;
  let owner: SignerWithAddress;
  beforeEach(async () => {
    [owner] = await ethers.getSigners();

    const mockV3Aggregatorfactory = await smock.mock<MockV3Aggregator__factory>(
      "MockV3Aggregator"
    );
    mockV3Aggregator = await mockV3Aggregatorfactory.deploy(
      8,
      BigNumber.from("2000000000000000000")
    );
    await mockV3Aggregator.deployed();

    const priceConsumerV3Factory = (await ethers.getContractFactory(
      "PriceConsumerV3",
      owner
    )) as PriceConsumerV3__factory;

    // unit tests for zero parameter check
    await expect(
      priceConsumerV3Factory.deploy(ZERO_ADDRESS)
    ).to.be.revertedWith("PriceConsumerV3: zero address");

    priceConsumerV3 = await priceConsumerV3Factory.deploy(
      mockV3Aggregator.address
    );
    await priceConsumerV3.deployed();
  });

  describe("deploy", () => {
    it("should not throw any errors", async () => {});
  });

  describe("getLatestPrice", () => {
    it("should return the current price", async () => {
      expect(await priceConsumerV3.getLatestPrice()).to.equal(
        BigNumber.from("2000000000000000000")
      );
    });

    it("should return the latest price after update", async () => {
      await mockV3Aggregator.updateAnswer(
        BigNumber.from("1000000000000000000")
      );
      expect(await priceConsumerV3.getLatestPrice()).to.equal(
        BigNumber.from("1000000000000000000")
      );
    });

    it("should revert if price <= 0 ", async () => {
      await mockV3Aggregator.updateAnswer(0);
      await expect(priceConsumerV3.getLatestPrice()).to.be.revertedWith(
        "PriceConsumerV3: price <= 0"
      );

      await mockV3Aggregator.updateAnswer(-1);
      await expect(priceConsumerV3.getLatestPrice()).to.be.revertedWith(
        "PriceConsumerV3: price <= 0"
      );
    });
  });

  describe("getPriceFeed", () => {
    it("should return the price feed address", async () => {
      expect(await priceConsumerV3.getPriceFeed()).to.equal(
        mockV3Aggregator.address
      );
    });
  });
});
