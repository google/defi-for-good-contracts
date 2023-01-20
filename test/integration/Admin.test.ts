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
  USDC_TOKEN_DECIMALS,
  CHAINLINK_USD_DECIMALS,
} from "../test-helpers/constants";
import { MockContract, smock } from "@defi-wonderland/smock";

import {
  PFP,
  PFP__factory,
  PurposeToken,
  PurposeToken__factory,
  TestPFPConfig,
  TestPFPConfig__factory,
  GenesisPurposeEscrow,
  GenesisPurposeEscrow__factory,
  PriceConsumerV3,
  PriceConsumerV3__factory,
  MockERC20,
  MockERC20__factory,
  MockV3Aggregator,
  MockV3Aggregator__factory,
} from "../../build/types";

use(smock.matchers);

describe("PFP", function () {
  let pfp: PFP;
  let purposeToken: PurposeToken;
  let genesisPurposeEscrow: GenesisPurposeEscrow;
  let ethUsdPriceConsumer: PriceConsumerV3;
  let mockTestPFPConfig: MockContract<TestPFPConfig>;
  let mockUSDC: MockERC20;
  let mockV3Aggregator: MockV3Aggregator;
  let owner: SignerWithAddress;
  let admin1: SignerWithAddress;
  let admin2: SignerWithAddress;
  let endowmentFund: SignerWithAddress;
  let foundationFund: SignerWithAddress;
  let roleManager: SignerWithAddress;
  let pauser: SignerWithAddress;

  beforeEach(async () => {
    [
      owner,
      admin1,
      admin2,
      roleManager,
      endowmentFund,
      foundationFund,
      pauser,
    ] = await ethers.getSigners();

    const mockUSDCFactory = (await ethers.getContractFactory(
      "MockERC20",
      owner
    )) as MockERC20__factory;
    mockUSDC = await mockUSDCFactory.deploy(
      "USDC Token",
      "USDC",
      BigNumber.from("10000000000"),
      USDC_TOKEN_DECIMALS
    );
    await mockUSDC.deployed();

    const mockV3AggregatorFactory = (await ethers.getContractFactory(
      "MockV3Aggregator",
      owner
    )) as MockV3Aggregator__factory;
    mockV3Aggregator = await mockV3AggregatorFactory.deploy(
      CHAINLINK_USD_DECIMALS,
      BigNumber.from(2000 * 10 ** CHAINLINK_USD_DECIMALS)
    );
    await mockV3Aggregator.deployed();

    const testPFPConfigfactory = await smock.mock<TestPFPConfig__factory>(
      "TestPFPConfig"
    );
    mockTestPFPConfig = await testPFPConfigfactory.deploy();
    await mockTestPFPConfig.deployed();
    mockTestPFPConfig.roleManager.returns(roleManager.address);
    mockTestPFPConfig.endowmentAddr.returns(endowmentFund.address);
    mockTestPFPConfig.foundationAddr.returns(foundationFund.address);

    const purposeTokenFactory = (await ethers.getContractFactory(
      "PurposeToken",
      owner
    )) as PurposeToken__factory;
    purposeToken = await purposeTokenFactory.deploy(mockTestPFPConfig.address);
    await purposeToken.deployed();

    const genesisPurposeEscrowFactory = (await ethers.getContractFactory(
      "GenesisPurposeEscrow",
      owner
    )) as GenesisPurposeEscrow__factory;
    genesisPurposeEscrow = await genesisPurposeEscrowFactory.deploy(
      purposeToken.address,
      mockTestPFPConfig.address
    );
    await genesisPurposeEscrow.deployed();

    const priceConsumerV3Factory = (await ethers.getContractFactory(
      "PriceConsumerV3",
      owner
    )) as PriceConsumerV3__factory;
    ethUsdPriceConsumer = await priceConsumerV3Factory.deploy(
      mockV3Aggregator.address
    );
    await ethUsdPriceConsumer.deployed();

    const pfpFactory = (await ethers.getContractFactory(
      "PFP",
      owner
    )) as PFP__factory;
    pfp = await pfpFactory.deploy(
      purposeToken.address,
      genesisPurposeEscrow.address,
      mockTestPFPConfig.address,
      ethUsdPriceConsumer.address
    );
    await pfp.deployed();

    // grant roles
    await purposeToken
      .connect(roleManager)
      .grantRole(await purposeToken.MINTER_ROLE(), pfp.address);
    await purposeToken
      .connect(roleManager)
      .grantRole(
        await purposeToken.MINTER_ROLE(),
        genesisPurposeEscrow.address
      );
    await genesisPurposeEscrow
      .connect(roleManager)
      .grantRole(await genesisPurposeEscrow.STAKER_ROLE(), pfp.address);
    await genesisPurposeEscrow
      .connect(roleManager)
      .grantRole(await genesisPurposeEscrow.WITHDRAWER_ROLE(), pfp.address);
    await genesisPurposeEscrow
      .connect(roleManager)
      .grantRole(await genesisPurposeEscrow.WITHDRAWER_ROLE(), owner.address);
    await genesisPurposeEscrow
      .connect(roleManager)
      .grantRole(await genesisPurposeEscrow.ADMIN_ROLE(), admin1.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.ADMIN_ROLE(), admin1.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.ADMIN_ROLE(), owner.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.BREAK_GLASS_ROLE(), pauser.address);
  });

  describe("Admin Functions", () => {
    it("should allow updates to roles", async () => {
      // role manager can't change
      await expect(
        pfp
          .connect(admin1)
          .revokeRole(await pfp.DEFAULT_ADMIN_ROLE(), roleManager.address)
      ).to.be.reverted;
      await expect(
        pfp
          .connect(owner)
          .revokeRole(await pfp.DEFAULT_ADMIN_ROLE(), roleManager.address)
      ).to.be.reverted;
      await expect(
        pfp
          .connect(pauser)
          .revokeRole(await pfp.DEFAULT_ADMIN_ROLE(), roleManager.address)
      ).to.be.reverted;

      // can add/remove/renounce admin
      await pfp
        .connect(roleManager)
        .grantRole(await pfp.ADMIN_ROLE(), admin2.address);
      await pfp.renounceRole(await pfp.ADMIN_ROLE(), owner.address);
      await pfp
        .connect(roleManager)
        .revokeRole(await pfp.ADMIN_ROLE(), admin2.address);

      await expect(pfp.updateMinimumDeposit(10)).to.be.reverted;
      await expect(pfp.connect(admin2).updateMinimumDeposit(10)).to.be.reverted;

      await expect(pfp.updateAcceleratedVestAllowed(true)).to.be.reverted;
      await expect(pfp.connect(admin2).updateAcceleratedVestAllowed(true)).to.be
        .reverted;

      // can add/remove/renounce break glass
      await pfp
        .connect(roleManager)
        .grantRole(await pfp.BREAK_GLASS_ROLE(), admin2.address);
      await pfp
        .connect(pauser)
        .renounceRole(await pfp.BREAK_GLASS_ROLE(), pauser.address);
      await pfp
        .connect(roleManager)
        .revokeRole(await pfp.BREAK_GLASS_ROLE(), admin2.address);

      await expect(pfp.connect(pauser).pauseProtocol()).to.be.reverted;
      await expect(pfp.connect(admin2).pauseProtocol()).to.be.reverted;

      // only role manager can remove role manager role
      await pfp
        .connect(roleManager)
        .renounceRole(await pfp.DEFAULT_ADMIN_ROLE(), roleManager.address);
    });

    it("should be callable by admins", async () => {
      await genesisPurposeEscrow.connect(admin1).updateInterestRate(11111111);

      await pfp.connect(admin1).addCoinAddr(mockUSDC.address);
      await pfp.connect(admin1).removeCoinAddr(mockUSDC.address);
      await pfp.connect(admin1).updateMinimumDeposit(10);
      await pfp.connect(admin1).updateAcceleratedVestAllowed(true);

      await pfp.connect(pauser).pauseProtocol();
      await pfp.connect(admin1).unpauseProtocol();
    });
  });
});
