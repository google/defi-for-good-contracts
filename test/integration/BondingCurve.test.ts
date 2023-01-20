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
import { expect, use, assert } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  USDC_TOKEN_DECIMALS,
  DAI_TOKEN_DECIMALS,
  CHAINLINK_USD_DECIMALS,
} from "../test-helpers/constants";
import {
  usdToUSDC,
  usdToDAI,
  purposeWithDecimals,
  ethToWei,
} from "../test-helpers/utils";
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

describe("PFP Bonding Curve", function () {
  let pfp: PFP;
  let purposeToken: PurposeToken;
  let mockTestPFPConfig: MockContract<TestPFPConfig>;
  let genesisPurposeEscrow: GenesisPurposeEscrow;
  let ethUsdPriceConsumer: PriceConsumerV3;
  let mockV3Aggregator: MockV3Aggregator;
  let mockUSDC: MockERC20;
  let mockDAI: MockERC20;
  let owner: SignerWithAddress;
  let contributorETH: SignerWithAddress;  // eslint-disable-line
  let contributorETH1: SignerWithAddress;
  let contributorUSDC: SignerWithAddress;
  let contributorDAI: SignerWithAddress;
  let roleManager: SignerWithAddress;

  beforeEach(async () => {
    [
      owner,
      contributorETH,
      contributorETH1,
      contributorUSDC,
      contributorDAI,
      roleManager,
    ] = await ethers.getSigners();

    const mockUSDCFactory = (await ethers.getContractFactory(
      "MockERC20",
      owner
    )) as MockERC20__factory;
    mockUSDC = await mockUSDCFactory.deploy(
      "USDC Token",
      "USDC",
      BigNumber.from(100 * 10 ** 6), // $100M
      USDC_TOKEN_DECIMALS
    );
    await mockUSDC.deployed();

    const mockDAIFactory = (await ethers.getContractFactory(
      "MockERC20",
      owner
    )) as MockERC20__factory;
    mockDAI = await mockDAIFactory.deploy(
      "DAI Token",
      "DAI",
      BigNumber.from(10 * 10 ** 6), // $10M
      DAI_TOKEN_DECIMALS
    );
    await mockDAI.deployed();

    const mockV3AggregatorFactory = (await ethers.getContractFactory(
      "MockV3Aggregator",
      owner
    )) as MockV3Aggregator__factory;
    mockV3Aggregator = await mockV3AggregatorFactory.deploy(
      CHAINLINK_USD_DECIMALS,
      BigNumber.from(2000 * 10 ** CHAINLINK_USD_DECIMALS)
    );

    const testPFPConfigfactory = await smock.mock<TestPFPConfig__factory>(
      "TestPFPConfig"
    );
    mockTestPFPConfig = await testPFPConfigfactory.deploy();
    await mockTestPFPConfig.deployed();
    mockTestPFPConfig.roleManager.returns(roleManager.address);

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
    await genesisPurposeEscrow
      .connect(roleManager)
      .grantRole(await genesisPurposeEscrow.STAKER_ROLE(), pfp.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.ADMIN_ROLE(), owner.address);

    await pfp.connect(owner).updateAcceleratedVestAllowed(true);
  });

  describe("when multiple contributors deposit USDC, DAI and ETH", () => {
    beforeEach(async () => {
      await pfp.addCoinAddr(mockUSDC.address);
      await pfp.addCoinAddr(mockDAI.address);
      await mockUSDC.transfer(
        contributorUSDC.address,
        usdToUSDC(100 * 10 ** 6)
      );
      await mockDAI.transfer(
        contributorDAI.address,
        usdToDAI(BigNumber.from(10 * 10 ** 6))
      );
      await mockUSDC
        .connect(contributorUSDC)
        .approve(pfp.address, usdToUSDC(100 * 10 ** 6));
      await mockDAI
        .connect(contributorDAI)
        .approve(pfp.address, usdToDAI(BigNumber.from(10 * 10 ** 6)));
    });

    it("purpose price should increase by 1c/$1M", async () => {
      const endowmentAddr = await mockTestPFPConfig.endowmentAddr();
      const foundationAddr = await mockTestPFPConfig.foundationAddr();

      // deposits: $2M usdc, $1M dai, $10M eth
      await pfp
        .connect(contributorUSDC)
        .deposit(mockUSDC.address, usdToUSDC(2 * 10 ** 6), true, 0);
      await pfp
        .connect(contributorDAI)
        .deposit(
          mockDAI.address,
          usdToDAI(BigNumber.from(1 * 10 ** 6)),
          false,
          0
        );
      await pfp
        .connect(contributorETH1)
        .depositEth(true, 0, { value: ethToWei(5000) });
      // $2M @0.01 = 200M tokens; treasury = $1.7M
      // $1M @0.027 = 37,037,037 tokens; treasury = $2,550,000
      // $10M @0.0355 = 281,690,140 tokens; treasury = $11,050,000
      let totalPurpose = await purposeToken.totalSupply();
      expect(totalPurpose).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("518727177")),
        BigNumber.from(10).pow(18)
      );
      expect(
        await purposeToken.balanceOf(genesisPurposeEscrow.address)
      ).to.equal(totalPurpose);
      expect(await pfp.getPurposePrice()).to.be.eq(BigNumber.from("120500"));

      // deposits: $70M usdc, $10M eth, $7M dai,
      await pfp
        .connect(contributorUSDC)
        .deposit(
          mockUSDC.address,
          usdToUSDC(BigNumber.from(70 * 10 ** 6)),
          true,
          0
        );
      await pfp
        .connect(contributorUSDC)
        .depositEth(true, 0, { value: ethToWei(5000) });
      await pfp
        .connect(contributorDAI)
        .deposit(
          mockDAI.address,
          usdToDAI(BigNumber.from(7 * 10 ** 6)),
          false,
          0
        );
      // $70M @0.1205 = 580,912,863 tokens; treasury = $70,550,000
      // $10M @0.7155 = 13,976,240 tokens; treasury = $79,050,000
      // $7M @0.8005 = 8,744,534 tokens; treasury = $85,000,000
      totalPurpose = await purposeToken.totalSupply();
      expect(totalPurpose).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("1122360814")),
        BigNumber.from(10).pow(20)
      );
      expect(
        await purposeToken.balanceOf(genesisPurposeEscrow.address)
      ).to.equal(totalPurpose);
      expect(await pfp.getPurposePrice()).to.be.eq(BigNumber.from("860000"));

      // check balances
      expect(await mockUSDC.balanceOf(endowmentAddr)).to.eq(
        usdToUSDC(BigNumber.from(61.2 * 10 ** 6))
      );
      expect(await mockDAI.balanceOf(endowmentAddr)).to.eq(
        usdToDAI(BigNumber.from(6.8 * 10 ** 6))
      );
      const endowmentEthBalance = await ethers.provider.getBalance(
        endowmentAddr
      );
      assert.equal(endowmentEthBalance.toString(), ethToWei(8500).toString());

      expect(await mockUSDC.balanceOf(foundationAddr)).to.eq(
        usdToUSDC(BigNumber.from(10.8 * 10 ** 6))
      );
      expect(await mockDAI.balanceOf(foundationAddr)).to.eq(
        usdToDAI(BigNumber.from(1.2 * 10 ** 6))
      );
      const foundationEthBalance = await ethers.provider.getBalance(
        foundationAddr
      );
      assert.equal(foundationEthBalance.toString(), ethToWei(1500).toString());

      expect(await purposeToken.balanceOf(contributorUSDC.address)).to.equal(0);
      expect(await purposeToken.balanceOf(contributorDAI.address)).to.equal(0);
      expect(await purposeToken.balanceOf(contributorETH1.address)).to.equal(0);
    });
  });
});
