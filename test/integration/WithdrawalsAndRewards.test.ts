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
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  USDC_TOKEN_DECIMALS,
  CHAINLINK_USD_DECIMALS,
  PFP_USD_DECIMALS,
  INTEREST_RATE_20APY,
} from "../test-helpers/constants";
import { usdToUSDC, purposeWithDecimals } from "../test-helpers/utils";
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

describe("PFP Protocol - Withdrawals and Rewards", function () {
  let pfp: PFP;
  let purposeToken: PurposeToken;
  let genesisPurposeEscrow: GenesisPurposeEscrow;
  let ethUsdPriceConsumer: PriceConsumerV3;
  let mockTestPFPConfig: MockContract<TestPFPConfig>;
  let mockUSDC: MockERC20;
  let mockV3Aggregator: MockV3Aggregator;
  let owner: SignerWithAddress;
  let endowmentFund: SignerWithAddress;
  let foundationFund: SignerWithAddress;
  let roleManager: SignerWithAddress;
  let pauser: SignerWithAddress;
  let contributorA: SignerWithAddress;
  let contributorB: SignerWithAddress;
  let contributorC: SignerWithAddress;

  beforeEach(async () => {
    [
      owner,
      roleManager,
      endowmentFund,
      foundationFund,
      pauser,
      contributorA,
      contributorB,
      contributorC,
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
      .grantRole(await genesisPurposeEscrow.ADMIN_ROLE(), owner.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.ADMIN_ROLE(), owner.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.BREAK_GLASS_ROLE(), pauser.address);

    await genesisPurposeEscrow
      .connect(owner)
      .updateInterestRate(INTEREST_RATE_20APY);

    await pfp.connect(owner).updateAcceleratedVestAllowed(true);
  });

  describe("Protocol", () => {
    it("minting, bonding, interest multi-party scenario", async () => {
      // FROM: ~/docs/bonding-curve-scenario-test.pdf

      // setup
      await pfp.connect(owner).addCoinAddr(mockUSDC.address);
      await mockUSDC.transfer(contributorA.address, usdToUSDC(20 * 10 ** 3));
      await mockUSDC
        .connect(contributorA)
        .approve(pfp.address, usdToUSDC(20 * 10 ** 3));
      await mockUSDC.transfer(contributorB.address, usdToUSDC(2 * 10 ** 6));
      await mockUSDC
        .connect(contributorB)
        .approve(pfp.address, usdToUSDC(2 * 10 ** 6));
      await mockUSDC.transfer(contributorC.address, usdToUSDC(2 * 10 ** 6));
      await mockUSDC
        .connect(contributorC)
        .approve(pfp.address, usdToUSDC(2 * 10 ** 6));

      let currentPurposePrice = await pfp.getPurposePrice();

      // 1. Contributor A mints 15K USD
      await pfp
        .connect(contributorA)
        .deposit(
          mockUSDC.address,
          usdToUSDC(15000),
          false,
          purposeWithDecimals(BigNumber.from(15000).div(currentPurposePrice))
        );

      //    check protocol balances
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(
        BigNumber.from(12750).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await mockUSDC.balanceOf(endowmentFund.address)).to.eq(
        BigNumber.from(12750).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await mockUSDC.balanceOf(foundationFund.address)).to.eq(
        BigNumber.from(2250).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await purposeToken.balanceOf(genesisPurposeEscrow.address)).to.eq(
        BigNumber.from("1500000000000000000000000")
      );
      currentPurposePrice = await pfp.getPurposePrice();
      expect(currentPurposePrice).to.eq(10127);
      //    check Contributor A account state
      let accountState = await pfp.getAccountDetails(contributorA.address);
      expect(accountState.purposeStaked).to.eq(
        BigNumber.from("1500000000000000000000000")
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(1);

      // Time travel: 1 day; total days passed: 1
      await network.provider.send("evm_increaseTime", [3600 * 24]);
      await network.provider.send("evm_mine");

      // 2. Then, Contributor B mints 2M USD
      await pfp
        .connect(contributorB)
        .deposit(
          mockUSDC.address,
          usdToUSDC(2000000),
          true,
          purposeWithDecimals(BigNumber.from(2000000).div(currentPurposePrice))
        );

      //    check protocol balances
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(
        BigNumber.from("1712750").mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await mockUSDC.balanceOf(endowmentFund.address)).to.eq(
        BigNumber.from("1712750").mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await mockUSDC.balanceOf(foundationFund.address)).to.eq(
        BigNumber.from("302250").mul(10 ** PFP_USD_DECIMALS)
      );
      expect(
        await purposeToken.balanceOf(genesisPurposeEscrow.address)
      ).to.be.closeTo(
        BigNumber.from("1500000000000000000000000").add(
          BigNumber.from("197491853461045000000000000")
        ),
        BigNumber.from(10).pow(18)
      );
      currentPurposePrice = await pfp.getPurposePrice();
      expect(currentPurposePrice).to.eq(27127);
      //    check Contributor B account state
      accountState = await pfp.getAccountDetails(contributorB.address);
      expect(accountState.purposeStaked).to.be.closeTo(
        BigNumber.from("197491853461045000000000000"),
        BigNumber.from(10).pow(12)
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(1);

      // Time travel: 13 days; total days passed: 14
      await network.provider.send("evm_increaseTime", [3600 * 24 * 13]);
      await network.provider.send("evm_mine");

      // 3. Then, Contributor C mints 1.2M USD
      await pfp
        .connect(contributorC)
        .deposit(
          mockUSDC.address,
          usdToUSDC(1200000),
          true,
          purposeWithDecimals(BigNumber.from(1200000).div(currentPurposePrice))
        );

      //    check protocol balances
      const totalEndowmentContribAfterDeposits = BigNumber.from("2732750").mul(
        10 ** PFP_USD_DECIMALS
      );
      const endowmentFundAfterDeposits = BigNumber.from("2732750").mul(
        10 ** PFP_USD_DECIMALS
      );
      const foundationFundAfterDeposits = BigNumber.from("482250").mul(
        10 ** PFP_USD_DECIMALS
      );
      const escrowAfterDeposits = BigNumber.from("1500000000000000000000000")
        .add(BigNumber.from("197491853461045000000000000"))
        .add(BigNumber.from("44236369668595900000000000"));
      const purposePriceAfterDeposits = await pfp.getPurposePrice();
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(
        totalEndowmentContribAfterDeposits
      );
      expect(await mockUSDC.balanceOf(endowmentFund.address)).to.eq(
        endowmentFundAfterDeposits
      );
      expect(await mockUSDC.balanceOf(foundationFund.address)).to.eq(
        foundationFundAfterDeposits
      );
      expect(
        await purposeToken.balanceOf(genesisPurposeEscrow.address)
      ).to.be.closeTo(escrowAfterDeposits, BigNumber.from(10).pow(18));
      expect(purposePriceAfterDeposits).to.eq(37327);
      //    check Contributor C account state
      accountState = await pfp.getAccountDetails(contributorC.address);
      expect(accountState.purposeStaked).to.be.closeTo(
        BigNumber.from("44236369668595900000000000"),
        BigNumber.from(10).pow(12)
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(1);

      // Time travel: 17 days; total days passed: 31
      await network.provider.send("evm_increaseTime", [3600 * 24 * 17]);
      await network.provider.send("evm_mine");

      // 4. 31 days after contributing, Contributor A checks their unvested amount
      accountState = await pfp.getAccountDetails(contributorA.address);
      let transaction = accountState.transactions[0];
      expect(
        transaction.schedule.initBalance.add(transaction.currentReward)
      ).to.be.closeTo(
        BigNumber.from("1523408033977650000000000"),
        BigNumber.from(10).pow(12)
      );

      // Time travel: to Contributor B first vest date
      accountState = await pfp.getAccountDetails(contributorB.address);
      await network.provider.send("evm_setNextBlockTimestamp", [
        accountState.transactions[0].tranches[0].dateAvailable.toNumber(),
      ]);
      await network.provider.send("evm_mine");

      // 4. 6 months after contributing, Contributor B receives their first vest
      await pfp.connect(contributorB).withdrawGenesisPurpose(0);

      //    check protocol balances
      const escrowAfterDepositsAndWithdrawal = await purposeToken.balanceOf(
        genesisPurposeEscrow.address
      );
      const totalEndowmentContribAfterDepositsAndWithdrawal =
        await pfp.totalEndowmentContributionsInUsd();
      const endowmentFundAfterDepositsAndWithdrawal = await mockUSDC.balanceOf(
        endowmentFund.address
      );
      const foundationFundAfterDepositsAndWithdrawal = await mockUSDC.balanceOf(
        foundationFund.address
      );
      const purposePriceAfterDepositsAndWithdrawal =
        await pfp.getPurposePrice();
      expect(escrowAfterDepositsAndWithdrawal).to.be.lt(escrowAfterDeposits);
      expect(totalEndowmentContribAfterDepositsAndWithdrawal).to.eq(
        totalEndowmentContribAfterDeposits
      );
      expect(endowmentFundAfterDepositsAndWithdrawal).to.eq(
        endowmentFundAfterDeposits
      );
      expect(foundationFundAfterDepositsAndWithdrawal).to.eq(
        foundationFundAfterDeposits
      );
      expect(purposePriceAfterDepositsAndWithdrawal).to.eq(
        purposePriceAfterDeposits
      );
      //    check Contributor B account state
      accountState = await pfp.getAccountDetails(contributorB.address);
      transaction = accountState.transactions[0];
      let diff = BigNumber.from("21650364433579600000000000")
        .sub(accountState.purposeHeld)
        .div(BigNumber.from(10).pow(18));
      expect(diff.toNumber()).to.be.closeTo(0, 35000); // within 0.2%
      expect(accountState.purposeStaked).to.be.closeTo(
        BigNumber.from("197491853461045000000000000").sub(
          BigNumber.from("19749185346104500000000000")
        ),
        BigNumber.from(10).pow(19)
      );
      diff = BigNumber.from("21650364433579600000000000")
        .sub(BigNumber.from("19749185346104500000000000"))
        .sub(accountState.rewardsPaid)
        .div(BigNumber.from(10).pow(18));
      expect(diff.toNumber()).to.be.closeTo(0, 36000); // within 2%
      expect(transaction.tranches[0].amountAvailable).to.eq(0);
      expect(transaction.tranches[0].rewardAvailable).to.eq(0);

      // Time travel: to Contributor A first vest date
      accountState = await pfp.getAccountDetails(contributorA.address);
      await network.provider.send("evm_setNextBlockTimestamp", [
        accountState.transactions[0].tranches[0].dateAvailable.toNumber(),
      ]);
      await network.provider.send("evm_mine");

      // 5. 1 year after minting, Contributor A first vest should be available
      accountState = await pfp.getAccountDetails(contributorA.address);
      expect(accountState.purposeStaked).to.eq(
        BigNumber.from("1500000000000000000000000")
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.rewardsPaid).to.eq(0);
      transaction = accountState.transactions[0];
      expect(
        transaction.currentAmount.add(transaction.currentReward)
      ).to.be.closeTo(
        BigNumber.from("180000000000000000000000"),
        BigNumber.from(10).pow(18)
      );

      // 6. 1.5 years after minting, Contributor A second vest should be available
      await network.provider.send("evm_setNextBlockTimestamp", [
        accountState.transactions[0].tranches[1].dateAvailable.toNumber(),
      ]);
      await network.provider.send("evm_mine");
      accountState = await pfp.getAccountDetails(contributorA.address);
      expect(accountState.purposeStaked).to.eq(
        BigNumber.from("1500000000000000000000000")
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.rewardsPaid).to.eq(0);
      transaction = accountState.transactions[0];
      expect(
        transaction.currentAmount.add(transaction.currentReward)
      ).to.be.closeTo(
        BigNumber.from("475991874835462000000000"),
        BigNumber.from(10).pow(21)
      );

      // 7. 2 years after minting, Contributor A third vest should be available
      await network.provider.send("evm_setNextBlockTimestamp", [
        accountState.transactions[0].tranches[2].dateAvailable.toNumber(),
      ]);
      await network.provider.send("evm_mine");
      accountState = await pfp.getAccountDetails(contributorA.address);
      expect(accountState.purposeStaked).to.eq(
        BigNumber.from("1500000000000000000000000")
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.rewardsPaid).to.eq(0);
      transaction = accountState.transactions[0];
      expect(
        transaction.currentAmount.add(transaction.currentReward)
      ).to.be.closeTo(
        BigNumber.from("1015991874835460000000000"),
        BigNumber.from(10).pow(21)
      );

      // 8. 2.5 years after minting, Contributor A fourth vest should be available
      await network.provider.send("evm_setNextBlockTimestamp", [
        accountState.transactions[0].tranches[3].dateAvailable.toNumber(),
      ]);
      await network.provider.send("evm_mine");
      accountState = await pfp.getAccountDetails(contributorA.address);
      expect(accountState.purposeStaked).to.eq(
        BigNumber.from("1500000000000000000000000")
      );
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.rewardsPaid).to.eq(0);
      transaction = accountState.transactions[0];
      expect(
        transaction.currentAmount.add(transaction.currentReward)
      ).to.be.closeTo(
        BigNumber.from("1608271400834580000000000"),
        BigNumber.from(10).pow(22)
      );

      // Time travel: to Contributor A final vest date
      await network.provider.send("evm_setNextBlockTimestamp", [
        accountState.transactions[0].tranches[4].dateAvailable.toNumber(),
      ]);
      await network.provider.send("evm_mine");

      // 9. 3 years after minting, Contributor A receives heir full vest
      await pfp.connect(contributorA).withdrawGenesisPurpose(0);

      //    check protocol balances
      expect(
        await purposeToken.balanceOf(genesisPurposeEscrow.address)
      ).to.be.lt(
        escrowAfterDepositsAndWithdrawal // purpose in escrow decrease
      );
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(
        totalEndowmentContribAfterDepositsAndWithdrawal
      );
      expect(await mockUSDC.balanceOf(endowmentFund.address)).to.eq(
        endowmentFundAfterDepositsAndWithdrawal
      );
      expect(await mockUSDC.balanceOf(foundationFund.address)).to.eq(
        foundationFundAfterDepositsAndWithdrawal
      );
      expect(await pfp.getPurposePrice()).to.eq(
        purposePriceAfterDepositsAndWithdrawal
      );
      //    check Contributor A account state
      accountState = await pfp.getAccountDetails(contributorA.address);
      transaction = accountState.transactions[0];
      expect(accountState.purposeStaked).to.be.eq(0);
      expect(accountState.purposeHeld).to.be.closeTo(
        BigNumber.from("2256271400834580000000000"),
        BigNumber.from(10).pow(22)
      );
      expect(accountState.rewardsPaid).to.be.closeTo(
        BigNumber.from("2256271400834580000000000").sub(
          BigNumber.from("1500000000000000000000000")
        ),
        BigNumber.from(10).pow(22)
      );
      expect(transaction.tranches[4].amountAvailable).to.eq(0);
      expect(transaction.tranches[4].rewardAvailable).to.eq(0);
    });

    it("should allow withdrawals with rewards", async () => {
      expect(await pfp.connect(owner).addCoinAddr(mockUSDC.address));
      await mockUSDC.connect(owner).approve(pfp.address, usdToUSDC(15000));
      await pfp
        .connect(owner)
        .deposit(mockUSDC.address, usdToUSDC(10000), false, 0);
      expect(
        await purposeToken.balanceOf(genesisPurposeEscrow.address)
      ).to.be.eq(purposeWithDecimals(BigNumber.from(10 ** 6)));

      // +120 days; total = 120
      await network.provider.send("evm_increaseTime", [3600 * 24 * 120]);
      await network.provider.send("evm_mine");
      let blockNumber = ethers.provider.getBlockNumber();
      let now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      console.log("120 days increased");

      expect(
        (
          await genesisPurposeEscrow.calcTotalReward(owner.address, 0, now)
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(61774)),
        BigNumber.from(10).pow(18)
      );

      await expect(
        genesisPurposeEscrow
          .connect(owner)
          .claimReward(
            owner.address,
            0,
            purposeWithDecimals(BigNumber.from(50000))
          )
      ).to.be.revertedWith("Escrow: No withdrawable amount");

      expect(
        await genesisPurposeEscrow.calcWithdrawableAmount(owner.address, 0, now)
      ).to.eq(0);

      // +184 days; total = 304 days
      await network.provider.send("evm_increaseTime", [3600 * 24 * 184]);
      await network.provider.send("evm_mine");
      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      console.log("184 days increased");

      expect(
        (
          await genesisPurposeEscrow.calcTotalReward(owner.address, 0, now)
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(163987)),
        BigNumber.from(10).pow(18)
      );

      expect(
        await genesisPurposeEscrow.calcWithdrawableAmount(owner.address, 0, now)
      ).to.eq(0);

      // +120 days; total = 424 days
      await network.provider.send("evm_increaseTime", [3600 * 24 * 120]);
      await network.provider.send("evm_mine");
      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      console.log("120 days increased");

      expect(
        (
          await genesisPurposeEscrow.calcAvailableReward(owner.address, 0, now)
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(20000)),
        BigNumber.from(10).pow(18)
      );

      expect(
        (
          await genesisPurposeEscrow.calcWithdrawableAmount(
            owner.address,
            0,
            now
          )
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(100000)),
        BigNumber.from(10).pow(18)
      );

      // +214 days; total = 638 days
      await network.provider.send("evm_increaseTime", [3600 * 24 * 214]);
      await network.provider.send("evm_mine");
      console.log("214 days increased");

      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      expect(
        (
          await genesisPurposeEscrow.calcWithdrawableAmount(
            owner.address,
            0,
            now
          )
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(250000)),
        BigNumber.from(10).pow(18)
      );

      expect(
        await genesisPurposeEscrow
          .connect(owner)
          .withdrawPurpose(
            owner.address,
            0,
            purposeWithDecimals(BigNumber.from(100000))
          )
      );

      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      expect(
        (
          await genesisPurposeEscrow.calcWithdrawableAmount(
            owner.address,
            0,
            now
          )
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(150000)),
        BigNumber.from(10).pow(18)
      );

      expect(
        await genesisPurposeEscrow
          .connect(owner)
          .claimReward(
            owner.address,
            0,
            purposeWithDecimals(BigNumber.from(50000))
          )
      );

      const remainingReward = 67180 - 50000;
      expect(
        (
          await genesisPurposeEscrow.calcAvailableReward(owner.address, 0, now)
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(remainingReward)),
        BigNumber.from(10).pow(21)
      );

      // +335 days; total = 779 days
      await network.provider.send("evm_increaseTime", [3600 * 24 * 335]);
      await network.provider.send("evm_mine");
      console.log("335 days increased");

      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      expect(
        (
          await genesisPurposeEscrow.calcWithdrawableAmount(
            owner.address,
            0,
            now
          )
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(650000)),
        BigNumber.from(10).pow(18)
      );

      expect(
        await genesisPurposeEscrow
          .connect(owner)
          .withdrawPurpose(
            owner.address,
            0,
            purposeWithDecimals(BigNumber.from(100000))
          )
      );

      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      expect(
        (
          await genesisPurposeEscrow.calcWithdrawableAmount(
            owner.address,
            0,
            now
          )
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(550000)),
        BigNumber.from(10).pow(18)
      );

      expect(
        (
          await genesisPurposeEscrow.calcAvailableReward(owner.address, 0, now)
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(remainingReward + 110000 + 144360)),
        BigNumber.from(10).pow(21)
      );

      // +304 days; total = 1277 days
      await network.provider.send("evm_increaseTime", [3600 * 24 * 304]);
      await network.provider.send("evm_mine");
      console.log("304 days increased");

      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      expect(
        (
          await genesisPurposeEscrow.calcWithdrawableAmount(
            owner.address,
            0,
            now
          )
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(800000)),
        BigNumber.from(10).pow(18)
      );

      expect(
        (
          await genesisPurposeEscrow.calcAvailableReward(owner.address, 0, now)
        ).toString()
      ).to.be.closeTo(
        purposeWithDecimals(
          BigNumber.from(remainingReward + 110000 + 144360 + 182000)
        ),
        BigNumber.from(10).pow(21)
      );

      // Unavailable Index
      blockNumber = ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      await expect(
        genesisPurposeEscrow.calcWithdrawableAmount(owner.address, 1, now)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("initially 0% APY, update to 15%", async () => {
      // setup
      await pfp.connect(owner).addCoinAddr(mockUSDC.address);
      await mockUSDC.transfer(contributorA.address, usdToUSDC(20 * 10 ** 3));
      await mockUSDC
        .connect(contributorA)
        .approve(pfp.address, usdToUSDC(20 * 10 ** 3));
      await mockUSDC.transfer(contributorB.address, usdToUSDC(2 * 10 ** 6));
      await mockUSDC
        .connect(contributorB)
        .approve(pfp.address, usdToUSDC(2 * 10 ** 6));

      let currentPurposePrice = await pfp.getPurposePrice();

      // interest rate starts at 0% APY
      await genesisPurposeEscrow.connect(owner).updateInterestRate(0);

      // 1. Contributor A mints 10K USD (1M Purpose) with 12m vest
      await pfp
        .connect(contributorA)
        .deposit(
          mockUSDC.address,
          usdToUSDC(10000),
          false,
          purposeWithDecimals(BigNumber.from(10000).div(currentPurposePrice))
        );

      // Time travel: 6m
      await network.provider.send("evm_increaseTime", [3600 * 24 * 183]);
      await network.provider.send("evm_mine");

      // 2. update interest rate to 15% APY compounded daily
      await genesisPurposeEscrow.connect(owner).updateInterestRate(1398000000);

      // 3. Contributor B mints 20K USD (?M Purpose) with 6m vest
      currentPurposePrice = await pfp.getPurposePrice();
      await pfp
        .connect(contributorB)
        .deposit(
          mockUSDC.address,
          usdToUSDC(20000),
          true,
          purposeWithDecimals(BigNumber.from(20000).div(currentPurposePrice))
        );

      // 4. Contributor A mints another 10K USD with new APY and 6m vest
      currentPurposePrice = await pfp.getPurposePrice();
      await pfp
        .connect(contributorA)
        .deposit(
          mockUSDC.address,
          usdToUSDC(10000),
          true,
          purposeWithDecimals(BigNumber.from(10000).div(currentPurposePrice))
        );

      // Time travel: 6m
      await network.provider.send("evm_increaseTime", [3600 * 24 * 183]);
      await network.provider.send("evm_mine");

      // check Contributor A account state
      let accountState = await pfp.getAccountDetails(contributorA.address);
      expect(accountState.transactions.length).to.eq(2);

      //    first transaction should have no rewards
      let firstTransaction = accountState.transactions[0];
      expect(firstTransaction.tranches[0].rewardAvailable).to.eq(0);
      expect(firstTransaction.tranches[1].rewardAvailable).to.eq(0);
      expect(firstTransaction.tranches[2].rewardAvailable).to.eq(0);
      expect(firstTransaction.tranches[3].rewardAvailable).to.eq(0);
      expect(firstTransaction.tranches[4].rewardAvailable).to.eq(0);

      //    second transaction should have rewards
      const secondTransaction = accountState.transactions[1];
      expect(secondTransaction.tranches[0].rewardAvailable).to.gt(0);
      expect(secondTransaction.tranches[1].rewardAvailable).to.gt(0);
      expect(secondTransaction.tranches[2].rewardAvailable).to.gt(0);
      expect(secondTransaction.tranches[3].rewardAvailable).to.gt(0);
      expect(secondTransaction.tranches[4].rewardAvailable).to.gt(0);

      // check Contributor B account state
      accountState = await pfp.getAccountDetails(contributorB.address);
      expect(accountState.transactions.length).to.eq(1);

      //    first transaction should have rewards
      firstTransaction = accountState.transactions[0];
      expect(firstTransaction.tranches[0].rewardAvailable).to.gt(0);
      expect(firstTransaction.tranches[1].rewardAvailable).to.gt(0);
      expect(firstTransaction.tranches[2].rewardAvailable).to.gt(0);
      expect(firstTransaction.tranches[3].rewardAvailable).to.gt(0);
      expect(firstTransaction.tranches[4].rewardAvailable).to.gt(0);
    });
  });
});
