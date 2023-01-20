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
  PFP_USD_DECIMALS,
} from "../test-helpers/constants";
import {
  usdToUSDC,
  ethToWei,
  purposeWithDecimals,
  monthsLater,
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

describe("PFP Protocol - Deposits", function () {
  let pfp: PFP;
  let purposeToken: PurposeToken;
  let genesisPurposeEscrow: GenesisPurposeEscrow;
  let ethUsdPriceConsumer: PriceConsumerV3;
  let mockTestPFPConfig: MockContract<TestPFPConfig>;
  let mockUSDC: MockERC20;
  let mockV3Aggregator: MockV3Aggregator;
  let owner: SignerWithAddress;
  let contributor1: SignerWithAddress;
  let contributor2: SignerWithAddress;
  let endowmentFund: SignerWithAddress;
  let foundationFund: SignerWithAddress;
  let roleManager: SignerWithAddress;
  let pauser: SignerWithAddress;

  beforeEach(async () => {
    [
      owner,
      contributor1,
      contributor2,
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
      .grantRole(await genesisPurposeEscrow.ADMIN_ROLE(), owner.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.ADMIN_ROLE(), owner.address);
    await pfp
      .connect(roleManager)
      .grantRole(await pfp.BREAK_GLASS_ROLE(), pauser.address);
  });

  describe("Protocol", () => {
    it("should accept small and large Ether deposits", async () => {
      // eth price = $2000 (set in beforeEach)
      // set interest rate to 0 (for easier calculations)
      const endowmentBalance = await ethers.provider.getBalance(
        endowmentFund.address
      );
      const foundationBalance = await ethers.provider.getBalance(
        foundationFund.address
      );

      // deposit large amount
      expect(
        await pfp
          .connect(contributor1)
          .depositEth(true, 0, { value: ethToWei(500) })
      );
      //    check balances
      const largeDep = purposeWithDecimals(BigNumber.from(100 * 10 ** 6));
      expect(await purposeToken.balanceOf(contributor1.address)).to.equal(0);
      expect(await purposeToken.balanceOf(genesisPurposeEscrow.address)).to.eq(
        largeDep
      );
      expect(await ethers.provider.getBalance(endowmentFund.address)).to.equal(
        endowmentBalance.add(ethToWei(500).mul(85).div(100))
      );
      expect(await ethers.provider.getBalance(foundationFund.address)).to.equal(
        foundationBalance.add(ethToWei(500).mul(15).div(100))
      );
      let treasury = BigNumber.from(500)
        .mul(2000)
        .mul(85)
        .div(100)
        .mul(10 ** PFP_USD_DECIMALS);
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(treasury);
      //    check account state
      let accountState = await pfp.getAccountDetails(contributor1.address);
      expect(accountState.purposeStaked).to.eq(largeDep);
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(1);
      let txn = accountState.transactions[0];
      expect(txn.schedule.initBalance).to.eq(largeDep);
      expect(txn.schedule.isAccelerated).to.be.false;   // eslint-disable-line
      expect(txn.schedule.withdrawnBalance).to.eq(0);
      //      tranches
      let startDate = new Date(
        txn.schedule.vestStartingDate.mul(1000).toNumber()
      ); // js time is in ms; solidity is in s
      expect(txn.tranches.length).to.eq(5);
      expect(txn.tranches[0].amountAvailable).to.eq(largeDep.mul(10).div(100));
      expect(txn.tranches[0].dateAvailable).to.eq(startDate.getTime() / 1000);
      expect(txn.tranches[1].amountAvailable).to.eq(largeDep.mul(25).div(100));
      expect(txn.tranches[1].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 6).getTime()).div(1000),
        86400 * 2 // solidity dates in utc, js date add includes current tz; check for 2 day diff
      );
      expect(txn.tranches[2].amountAvailable).to.eq(largeDep.mul(50).div(100));
      expect(txn.tranches[2].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 12).getTime()).div(1000),
        86400 * 2
      );
      expect(txn.tranches[3].amountAvailable).to.eq(largeDep.mul(75).div(100));
      expect(txn.tranches[3].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 18).getTime()).div(1000),
        86400 * 2
      );
      expect(txn.tranches[4].amountAvailable).to.eq(largeDep);
      expect(txn.tranches[4].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 24).getTime()).div(1000),
        86400 * 2
      );
      //    check purpose price with $850k in treasury
      expect(await pfp.getPurposePrice()).to.eq(18500);

      // deposit small amount ($2000 at $0.0185)
      expect(
        await pfp
          .connect(contributor2)
          .depositEth(false, 0, { value: ethToWei(1) })
      );
      //    check balances
      const smallDep = BigNumber.from("108108108108108108108108");
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(0);
      expect(await purposeToken.balanceOf(genesisPurposeEscrow.address)).to.eq(
        largeDep.add(smallDep)
      );
      expect(await ethers.provider.getBalance(endowmentFund.address)).to.equal(
        endowmentBalance.add(ethToWei(501).mul(85).div(100))
      );
      expect(await ethers.provider.getBalance(foundationFund.address)).to.equal(
        foundationBalance.add(ethToWei(501).mul(15).div(100))
      );
      treasury = BigNumber.from(501)
        .mul(2000)
        .mul(85)
        .div(100)
        .mul(10 ** PFP_USD_DECIMALS);
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(treasury);
      //    check account state
      accountState = await pfp.getAccountDetails(contributor2.address);
      expect(accountState.purposeStaked).to.eq(smallDep);
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(1);
      txn = accountState.transactions[0];
      expect(txn.schedule.initBalance).to.eq(smallDep);
      expect(txn.schedule.isAccelerated).to.be.false;   // eslint-disable-line
      expect(txn.schedule.withdrawnBalance).to.eq(0);
      //      tranches
      startDate = new Date(txn.schedule.vestStartingDate.mul(1000).toNumber());
      expect(txn.tranches.length).to.eq(5);
      expect(txn.tranches[0].amountAvailable).to.eq(smallDep.mul(10).div(100));
      expect(txn.tranches[0].dateAvailable).to.eq(startDate.getTime() / 1000);
      expect(txn.tranches[1].amountAvailable).to.eq(smallDep.mul(25).div(100));
      expect(txn.tranches[1].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 6).getTime()).div(1000),
        86400 * 3
      );
      expect(txn.tranches[2].amountAvailable).to.eq(smallDep.mul(50).div(100));
      expect(txn.tranches[2].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 12).getTime()).div(1000),
        86400 * 3
      );
      expect(txn.tranches[3].amountAvailable).to.eq(smallDep.mul(75).div(100));
      expect(txn.tranches[3].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 18).getTime()).div(1000),
        86400 * 4
      );
      expect(txn.tranches[4].amountAvailable).to.eq(smallDep);
      expect(txn.tranches[4].dateAvailable).to.be.closeTo(
        BigNumber.from(monthsLater(startDate, 24).getTime()).div(1000),
        86400 * 5
      );
    });

    it("should accept usd-based stablecoin deposits", async () => {
      await pfp.connect(owner).addCoinAddr(mockUSDC.address);
      await mockUSDC.transfer(contributor1.address, usdToUSDC(3 * 10 ** 6));
      await mockUSDC.transfer(contributor2.address, usdToUSDC(5 * 10 ** 6));
      await mockUSDC
        .connect(contributor1)
        .approve(pfp.address, usdToUSDC(3 * 10 ** 6));
      await mockUSDC
        .connect(contributor2)
        .approve(pfp.address, usdToUSDC(5 * 10 ** 6));
      const endowmentBalance = await mockUSDC.balanceOf(endowmentFund.address);
      const foundationBalance = await mockUSDC.balanceOf(
        foundationFund.address
      );

      // Scenario:
      //  contributor1 deposits $2000 to test
      //  contributor1 prepares for $2M deposit
      //  contributor2 deposits $2M immediately after contributor1's $2k
      //  contributor1 tries to deposit $2M with old purpose price
      //  contributor1 deposits $2M at new price

      // contributor1: $2k at 0.01
      let contributor1Purpose = BigNumber.from(0);
      let contributor2Purpose = BigNumber.from(0);
      await pfp
        .connect(contributor1)
        .deposit(
          mockUSDC.address,
          usdToUSDC(2000),
          false,
          purposeWithDecimals(BigNumber.from(200000))
        );
      contributor1Purpose = contributor1Purpose.add(
        purposeWithDecimals(BigNumber.from(200000))
      );

      // contributor1 preps for large deposit
      let numPurposeExpected = await pfp.calculateTokensToMint(
        await pfp.getPurposePrice(),
        BigNumber.from(2 * 10 ** 6).mul(10 ** 6)
      );
      // contributor2: $2M at 0.010017
      await pfp
        .connect(contributor2)
        .deposit(
          mockUSDC.address,
          usdToUSDC(2 * 10 ** 6),
          false,
          numPurposeExpected
        );
      contributor2Purpose = contributor2Purpose.add(numPurposeExpected);

      // contributor1 FAIL: $2M expecting old num tokens
      await expect(
        pfp
          .connect(contributor1)
          .deposit(
            mockUSDC.address,
            usdToUSDC(2 * 10 ** 6),
            false,
            numPurposeExpected
          )
      ).to.be.revertedWith("PFP: Token amount < min.");

      // contributor1: $2M at 0.027017
      numPurposeExpected = await pfp.calculateTokensToMint(
        await pfp.getPurposePrice(),
        BigNumber.from(2 * 10 ** 6).mul(10 ** 6)
      );
      await pfp
        .connect(contributor1)
        .deposit(
          mockUSDC.address,
          usdToUSDC(2 * 10 ** 6),
          false,
          numPurposeExpected
        );
      contributor1Purpose = contributor1Purpose.add(numPurposeExpected);

      //  check balances
      expect(await purposeToken.balanceOf(contributor1.address)).to.equal(0);
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(0);
      expect(await purposeToken.balanceOf(genesisPurposeEscrow.address)).to.eq(
        contributor1Purpose.add(contributor2Purpose)
      );
      expect(await mockUSDC.balanceOf(endowmentFund.address)).to.eq(
        endowmentBalance.add(
          usdToUSDC(4 * 10 ** 6)
            .add(usdToUSDC(2 * 10 ** 3))
            .mul(85)
            .div(100)
        )
      );
      expect(await mockUSDC.balanceOf(foundationFund.address)).to.eq(
        foundationBalance.add(
          usdToUSDC(4 * 10 ** 6)
            .add(usdToUSDC(2 * 10 ** 3))
            .mul(15)
            .div(100)
        )
      );
      const treasury = BigNumber.from(4 * 10 ** 6)
        .add(2 * 10 ** 3)
        .mul(85)
        .div(100)
        .mul(10 ** PFP_USD_DECIMALS);
      expect(await pfp.totalEndowmentContributionsInUsd()).to.eq(treasury);

      // check account state
      let accountState = await pfp.getAccountDetails(contributor1.address);
      expect(accountState.purposeStaked).to.eq(contributor1Purpose);
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(2);
      accountState = await pfp.getAccountDetails(contributor2.address);
      expect(accountState.purposeStaked).to.eq(contributor2Purpose);
      expect(accountState.purposeHeld).to.eq(0);
      expect(accountState.transactions.length).to.eq(1);
    });

    it("should not accept deposits if protocol is paused", async () => {
      await pfp.connect(pauser).pauseProtocol();
      await expect(
        pfp.connect(contributor1).depositEth(true, 0, { value: ethToWei(500) })
      ).to.be.revertedWith("Pausable: paused");

      await pfp.connect(owner).addCoinAddr(mockUSDC.address);
      await expect(
        pfp
          .connect(contributor1)
          .deposit(
            mockUSDC.address,
            usdToUSDC(2000),
            false,
            purposeWithDecimals(BigNumber.from(200000))
          )
      ).to.be.revertedWith("Pausable: paused");
    });
  });
});
