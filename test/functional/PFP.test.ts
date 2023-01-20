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
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  PFP,
  PFP__factory,
  PurposeToken,
  GenesisPurposeEscrow,
  GenesisPurposeEscrow__factory,
  TestPFPConfig,
  PriceConsumerV3,
  MockERC20,
  MockERC20__factory,
} from "../../build/types";
import {
  USDC_TOKEN_DECIMALS,
  CHAINLINK_USD_DECIMALS,
  PFP_USD_DECIMALS,
  PURPOSE_TOKEN_DECIMALS,
  ZERO_ADDRESS,
  INTEREST_RATE_20APY,
} from "../test-helpers/constants";
import {
  usdToUSDC,
  ethToWei,
  purposeWithDecimals,
} from "../test-helpers/utils";
import { FakeContract, smock, MockContract } from "@defi-wonderland/smock";

use(smock.matchers);

describe("PFP", function () {
  let pfpContract: MockContract<PFP>;
  let fakeTestPFPConfig: FakeContract<TestPFPConfig>;
  let fakePurposeToken: FakeContract<PurposeToken>;
  let mockGenesisPurposeEscrow: MockContract<GenesisPurposeEscrow>;
  let fakePriceConsumerV3: FakeContract<PriceConsumerV3>;
  let mockUSDCToken: MockContract<MockERC20>;
  let owner: SignerWithAddress;
  let contributor: SignerWithAddress;
  let endowmentFund: SignerWithAddress;
  let foundationFund: SignerWithAddress;
  let roleManager: SignerWithAddress;

  beforeEach(async () => {
    [owner, contributor, endowmentFund, foundationFund, roleManager] =
      await ethers.getSigners();

    // setup fakes
    fakePurposeToken = await smock.fake<PurposeToken>("PurposeToken");
    fakePurposeToken.decimals.returns(18);
    fakePriceConsumerV3 = await smock.fake<PriceConsumerV3>("PriceConsumerV3");
    fakeTestPFPConfig = await smock.fake<TestPFPConfig>("TestPFPConfig");
    fakeTestPFPConfig.endowmentAddr.returns(endowmentFund.address);
    fakeTestPFPConfig.foundationAddr.returns(foundationFund.address);
    fakeTestPFPConfig.roleManager.returns(roleManager.address);

    // setup mocks
    const mockUSDCTokenfactory = await smock.mock<MockERC20__factory>(
      "MockERC20"
    );
    mockUSDCToken = await mockUSDCTokenfactory.deploy(
      "USDC Token",
      "USDC",
      BigNumber.from(200 * 10 ** 6), // $200M
      USDC_TOKEN_DECIMALS
    );
    await mockUSDCToken.deployed();

    const mockGenesisPurposeEscrowfactory =
      await smock.mock<GenesisPurposeEscrow__factory>(
        "GenesisPurposeEscrow",
        owner
      );
    mockGenesisPurposeEscrow = await mockGenesisPurposeEscrowfactory.deploy(
      fakePurposeToken.address,
      fakeTestPFPConfig.address
    );
    await mockGenesisPurposeEscrow.deployed();

    const pfpFactory = await smock.mock<PFP__factory>("PFP", owner);

    // unit tests for zero parameter check
    await expect(
      pfpFactory.deploy(
        ZERO_ADDRESS,
        mockGenesisPurposeEscrow.address,
        fakeTestPFPConfig.address,
        fakePriceConsumerV3.address
      )
    ).to.be.revertedWith("PFP: zero address");

    await expect(
      pfpFactory.deploy(
        fakePurposeToken.address,
        ZERO_ADDRESS,
        fakeTestPFPConfig.address,
        fakePriceConsumerV3.address
      )
    ).to.be.revertedWith("PFP: zero address");

    await expect(
      pfpFactory.deploy(
        fakePurposeToken.address,
        mockGenesisPurposeEscrow.address,
        fakeTestPFPConfig.address,
        ZERO_ADDRESS
      )
    ).to.be.revertedWith("PFP: zero address");

    pfpContract = await pfpFactory.deploy(
      fakePurposeToken.address,
      mockGenesisPurposeEscrow.address,
      fakeTestPFPConfig.address,
      fakePriceConsumerV3.address
    );
    await pfpContract.deployed();

    await pfpContract
      .connect(roleManager)
      .grantRole(await pfpContract.ADMIN_ROLE(), owner.address);
    await pfpContract
      .connect(roleManager)
      .grantRole(await pfpContract.BREAK_GLASS_ROLE(), owner.address);

    await mockGenesisPurposeEscrow
      .connect(roleManager)
      .grantRole(
        await mockGenesisPurposeEscrow.STAKER_ROLE(),
        pfpContract.address
      );
    await mockGenesisPurposeEscrow
      .connect(roleManager)
      .grantRole(
        await mockGenesisPurposeEscrow.WITHDRAWER_ROLE(),
        pfpContract.address
      );
  });

  describe("deploy", () => {
    it("should set config roleManager as Admin Role", async () => {
      expect(
        await pfpContract.hasRole(
          await pfpContract.DEFAULT_ADMIN_ROLE(),
          roleManager.address
        )
      ).to.eq(true);
    });
  });

  describe("depositEth", () => {
    const ethPrice = 1500;
    this.beforeEach(async () => {
      fakePriceConsumerV3.getLatestPrice.returns(
        BigNumber.from(ethPrice * 10 ** CHAINLINK_USD_DECIMALS)
      );

      // $1M in endowment, purpose price = 0.02
      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(10 ** 6).mul(10 ** PFP_USD_DECIMALS)
      );

      // accelerated vesting is allowed
      await pfpContract.updateAcceleratedVestAllowed(true);
    });

    it("should split deposit 85/15%", async () => {
      await expect(() =>
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(5) })
      ).to.changeEtherBalances(
        [contributor, endowmentFund, foundationFund],
        [ethToWei(-5), ethToWei(4.25), ethToWei(0.75)]
      );

      // deposit with decimals
      await expect(() =>
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(10.05) })
      ).to.changeEtherBalances(
        [contributor, endowmentFund, foundationFund],
        [ethToWei(-10.05), ethToWei(8.5425), ethToWei(1.5075)]
      );

      // large eth price
      fakePriceConsumerV3.getLatestPrice.returns(
        BigNumber.from(20000 * 10 ** CHAINLINK_USD_DECIMALS)
      );
      await expect(() =>
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(5) })
      ).to.changeEtherBalances(
        [contributor, endowmentFund, foundationFund],
        [ethToWei(-5), ethToWei(4.25), ethToWei(0.75)]
      );
    });

    it("should handle the case when deposit isn't evenly divisible by 85%", async () => {
      await expect(() =>
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: BigNumber.from("1000000000000000001") })
      ).to.changeEtherBalances(
        [contributor, endowmentFund, foundationFund],
        [
          BigNumber.from("-1000000000000000001"),
          BigNumber.from("850000000000000000"),
          BigNumber.from("150000000000000001"),
        ]
      );
    });

    it("should emit EndowmentIncreased event", async () => {
      const endowmentContrib = BigNumber.from(
        8.5 * ethPrice * 10 ** PFP_USD_DECIMALS
      );

      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(10) })
      )
        .to.emit(pfpContract, "EndowmentIncreased")
        .withArgs(
          contributor.address,
          endowmentFund.address,
          BigNumber.from(10 ** 6)
            .mul(10 ** PFP_USD_DECIMALS)
            .add(endowmentContrib),
          endowmentContrib,
          20000
        );
    });

    it("should emit EthDepositReceived event", async () => {
      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(10) })
      )
        .to.emit(pfpContract, "EthDepositReceived")
        .withArgs(
          contributor.address,
          endowmentFund.address,
          foundationFund.address,
          ethToWei(10)
        );
    });

    it("should call mint purpose function", async () => {
      // endowment has $1M, price = 2c
      await pfpContract
        .connect(contributor)
        .depositEth(true, 0, { value: ethToWei(10) });

      const purposeTokenDecimals = BigNumber.from(10).pow(
        PURPOSE_TOKEN_DECIMALS
      );
      expect(fakePurposeToken.mintPurpose).to.have.been.calledWith(
        mockGenesisPurposeEscrow.address,
        BigNumber.from((10 * ethPrice) / 0.02).mul(purposeTokenDecimals)
      );
    });

    it("should call stake purpose function", async () => {
      // endowment has $1M, price = 2c
      await pfpContract
        .connect(contributor)
        .depositEth(false, 0, { value: ethToWei(2000) });

      const purposeTokenDecimals = BigNumber.from(10).pow(
        PURPOSE_TOKEN_DECIMALS
      );
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledWith(
        contributor.address,
        BigNumber.from((2000 * ethPrice) / 0.02).mul(purposeTokenDecimals),
        false,
        20000,
        "ETH"
      );

      // endowment at $1M + $3M*85/100 = $3.55M, price = 0.0455c

      await pfpContract
        .connect(contributor)
        .depositEth(true, 0, { value: ethToWei(10) });

      expect(
        mockGenesisPurposeEscrow.stakePurpose.atCall(1)
      ).to.have.been.calledWith(
        contributor.address,
        BigNumber.from(10 * ethPrice)
          .mul(purposeTokenDecimals)
          .mul(10 ** 6)
          .div(45500),
        true,
        45500,
        "ETH"
      );
    });

    it("should mint Purpose according to bonding curve", async () => {
      // $0 in endowment, purpose price = 0.01
      await pfpContract.setVariable("totalEndowmentContributionsInUsd", 0);

      // $15K @0.01c => 1.5M Purpose Tokens
      await pfpContract
        .connect(contributor)
        .depositEth(false, 0, { value: ethToWei(10) });
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledWith(
        contributor.address,
        purposeWithDecimals(BigNumber.from(1.5 * 10 ** 6)),
        false,
        10000,
        "ETH"
      );

      // endowment = $12,750, price = 0.010127

      // $1500 * 63.33 ETH => ~9,380,369
      await pfpContract
        .connect(contributor)
        .depositEth(false, 0, { value: ethToWei(63.33) });
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledTwice; // eslint-disable-line
      expect(
        mockGenesisPurposeEscrow.stakePurpose.getCall(1).args[1]
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("9380369")),
        BigNumber.from(10).pow(18)
      );

      // endowment = $93,495.75, price = 0.010934

      // $1500 * 1000 ETH => ~137,186,756
      await pfpContract
        .connect(contributor)
        .depositEth(false, 0, { value: ethToWei(1000) });
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledThrice; // eslint-disable-line
      expect(
        mockGenesisPurposeEscrow.stakePurpose.getCall(2).args[1]
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("137186756")),
        BigNumber.from(10).pow(18)
      );

      // endowment = $1,368,495.75, price = 0.023684

      // $1500 * 2 ETH => ~126,667
      await pfpContract
        .connect(contributor)
        .depositEth(false, 0, { value: ethToWei(2) });
      expect(
        mockGenesisPurposeEscrow.stakePurpose.getCall(3).args[1]
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("126667")),
        BigNumber.from(10).pow(18)
      );
    });

    it("should override accelerated if acceleratedVestAllowed is false", async () => {
      await pfpContract.updateAcceleratedVestAllowed(false);

      // endowment has $1M, price = 2c
      await pfpContract
        .connect(contributor)
        .depositEth(false, 0, { value: ethToWei(2000) });

      const purposeTokenDecimals = BigNumber.from(10).pow(
        PURPOSE_TOKEN_DECIMALS
      );
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledWith(
        contributor.address,
        BigNumber.from((2000 * ethPrice) / 0.02).mul(purposeTokenDecimals),
        false,
        20000,
        "ETH"
      );

      // endowment at $1M + $3M*85/100 = $3.55M, price = 0.0455c

      await pfpContract
        .connect(contributor)
        .depositEth(true, 0, { value: ethToWei(10) });

      expect(
        mockGenesisPurposeEscrow.stakePurpose.atCall(1)
      ).to.have.been.calledWith(
        contributor.address,
        BigNumber.from(10 * ethPrice)
          .mul(purposeTokenDecimals)
          .mul(10 ** 6)
          .div(45500),
        false,
        45500,
        "ETH"
      );
    });

    it("should revert if price feed call fails", async () => {
      fakePriceConsumerV3.getLatestPrice.reverts();
      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(10) })
      ).to.be.reverted;
    });

    it("should revert if deposit is less than min deposit amount", async () => {
      const minDeposit = 10;
      await pfpContract.updateMinimumDeposit(minDeposit);

      fakePriceConsumerV3.getLatestPrice.returns(
        BigNumber.from((minDeposit - 1) * 10 ** CHAINLINK_USD_DECIMALS)
      );
      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(1) })
      ).to.be.revertedWith("PFP: Deposit value too low");
    });

    it("should revert if mint purpose fails", async () => {
      const gasPrice = await ethers.provider.getGasPrice();
      const functionGasFees = await pfpContract.estimateGas.depositEth(
        true,
        0,
        {
          value: ethToWei(100),
        }
      );
      const gas = gasPrice.mul(functionGasFees);
      const endowmentBalance = await ethers.provider.getBalance(
        endowmentFund.address
      );
      const foundationBalance = await ethers.provider.getBalance(
        foundationFund.address
      );
      const contributorBalance = await ethers.provider.getBalance(
        contributor.address
      );

      fakePurposeToken.mintPurpose.reverts();

      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(true, 0, { value: ethToWei(100) })
      ).to.be.reverted;

      // balances should not change except for contributor gas fees
      expect(await ethers.provider.getBalance(endowmentFund.address)).to.equal(
        endowmentBalance
      );
      expect(await ethers.provider.getBalance(foundationFund.address)).to.equal(
        foundationBalance
      );
      expect(
        await ethers.provider.getBalance(contributor.address)
      ).to.be.closeTo(contributorBalance, gas);
    });

    it("should revert if stake purpose fails", async () => {
      const gasPrice = await ethers.provider.getGasPrice();
      const functionGasFees = await pfpContract.estimateGas.depositEth(
        true,
        0,
        {
          value: ethToWei(200),
        }
      );
      const gas = gasPrice.mul(functionGasFees);
      const endowmentBalance = await ethers.provider.getBalance(
        endowmentFund.address
      );
      const foundationBalance = await ethers.provider.getBalance(
        foundationFund.address
      );
      const contributorBalance = await ethers.provider.getBalance(
        contributor.address
      );

      mockGenesisPurposeEscrow.stakePurpose.reverts();

      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(false, 0, { value: ethToWei(200) })
      ).to.be.reverted;

      // balances should not change except for contributor gas fees
      expect(await ethers.provider.getBalance(endowmentFund.address)).to.equal(
        endowmentBalance
      );
      expect(await ethers.provider.getBalance(foundationFund.address)).to.equal(
        foundationBalance
      );
      expect(
        await ethers.provider.getBalance(contributor.address)
      ).to.be.closeTo(contributorBalance, gas);
    });

    it("should revert if negative amount sent", async () => {
      await expect(
        pfpContract.connect(contributor).depositEth(true, 0, { value: -1000 })
      ).to.be.reverted;
    });

    it("should revert if the amount of purpose token received is less than the minimum specified", async () => {
      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(true, purposeWithDecimals(BigNumber.from(1000)), {
            value: ethToWei(0.004),
          })
      ).to.be.revertedWith("PFP: Token amount < min.");
    });

    it("should revert if protocol is paused", async () => {
      await pfpContract.pauseProtocol();
      await expect(
        pfpContract
          .connect(contributor)
          .depositEth(false, 0, { value: ethToWei(200) })
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("deposit", () => {
    beforeEach(async () => {
      await pfpContract.addCoinAddr(mockUSDCToken.address);
      await mockUSDCToken.transfer(
        contributor.address,
        usdToUSDC(150 * 10 ** 6)
      );
      await mockUSDCToken.transfer(endowmentFund.address, usdToUSDC(100000));
      await mockUSDCToken.transfer(foundationFund.address, usdToUSDC(100000));
      await mockUSDCToken
        .connect(contributor)
        .approve(pfpContract.address, usdToUSDC(200 * 10 ** 6));

      // $1M in endowment, purpose price = 0.02
      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(10 ** 6).mul(10 ** PFP_USD_DECIMALS)
      );
    });

    it("should split stablecoin deposit 85/15%", async () => {
      await expect(() =>
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, usdToUSDC(5000), true, 0)
      ).to.changeTokenBalances(
        mockUSDCToken,
        [contributor, endowmentFund, foundationFund],
        [usdToUSDC(-5000), usdToUSDC(4250), usdToUSDC(750)]
      );

      // deposit with decimals
      await expect(() =>
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, usdToUSDC(1000.1), true, 0)
      ).to.changeTokenBalances(
        mockUSDCToken,
        [contributor, endowmentFund, foundationFund],
        [usdToUSDC(-1000.1), usdToUSDC(850.085), usdToUSDC(150.015)]
      );
    });

    it("should handle the case when deposit isn't evenly divisible by 85%", async () => {
      await expect(() =>
        pfpContract
          .connect(contributor)
          .deposit(
            mockUSDCToken.address,
            BigNumber.from("100000000001"),
            true,
            0
          )
      ).to.changeTokenBalances(
        mockUSDCToken,
        [contributor, endowmentFund, foundationFund],
        [
          BigNumber.from("-100000000001"),
          BigNumber.from("85000000000"),
          BigNumber.from("15000000001"),
        ]
      );
    });

    it("should emit EndowmentIncreased event", async () => {
      const endowmentContrib = BigNumber.from(
        ((5000 * 85) / 100) * 10 ** PFP_USD_DECIMALS
      );

      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, usdToUSDC(5000), true, 0)
      )
        .to.emit(pfpContract, "EndowmentIncreased")
        .withArgs(
          contributor.address,
          endowmentFund.address,
          BigNumber.from(10 ** 6)
            .mul(10 ** PFP_USD_DECIMALS)
            .add(endowmentContrib),
          endowmentContrib,
          20000
        );
    });

    it("should emit CoinDepositReceived event", async () => {
      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, usdToUSDC(5000), true, 0)
      )
        .to.emit(pfpContract, "CoinDepositReceived")
        .withArgs(
          contributor.address,
          mockUSDCToken.address,
          endowmentFund.address,
          foundationFund.address,
          usdToUSDC(5000)
        );
    });

    it("should call mint purpose function", async () => {
      // endowment has $1M, price = 2c
      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(15000), true, 0);

      const purposeTokenDecimals = BigNumber.from(10).pow(
        PURPOSE_TOKEN_DECIMALS
      );
      expect(fakePurposeToken.mintPurpose).to.have.been.calledWith(
        mockGenesisPurposeEscrow.address,
        BigNumber.from(15000 / 0.02).mul(purposeTokenDecimals)
      );
    });

    it("should call stake purpose function", async () => {
      // endowment has $1M, price = 2c
      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(3 * 10 ** 6), false, 0);

      const purposeTokenDecimals = BigNumber.from(10).pow(
        PURPOSE_TOKEN_DECIMALS
      );
      const usdcSymbol = await mockUSDCToken.symbol();
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledWith(
        contributor.address,
        BigNumber.from((3 * 10 ** 6) / 0.02).mul(purposeTokenDecimals),
        false,
        20000,
        usdcSymbol
      );

      // endowment at $1M + $3M*85/100 = $3.55M, price = 0.0455c

      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(15000), true, 0);

      expect(
        mockGenesisPurposeEscrow.stakePurpose.atCall(1)
      ).to.have.been.calledWith(
        contributor.address,
        BigNumber.from(15000)
          .mul(purposeTokenDecimals)
          .mul(10 ** 6)
          .div(45500),
        true,
        45500,
        usdcSymbol
      );
    });

    it("should mint Purpose according to bonding curve", async () => {
      // $0 in endowment, purpose price = 0.01
      await pfpContract.setVariable("totalEndowmentContributionsInUsd", 0);

      // $15K @0.01c => 1.5M Purpose Tokens
      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(15000), false, 0);
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledWith(
        contributor.address,
        purposeWithDecimals(BigNumber.from(1.5 * 10 ** 6)),
        false,
        10000,
        "USDC"
      );

      // endowment = $12,750, price = 0.010127

      // $1.5M => ~148,118,890
      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(1.5 * 10 ** 6), false, 0);
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledTwice; // eslint-disable-line
      expect(
        mockGenesisPurposeEscrow.stakePurpose.getCall(1).args[1]
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("148118890")),
        BigNumber.from(10).pow(18)
      );

      // endowment = $1,287,750, price = 0.022877

      // $50M => ~2,185,601,258
      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(50 * 10 ** 6), false, 0);
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledThrice; // eslint-disable-line
      expect(
        mockGenesisPurposeEscrow.stakePurpose.getCall(2).args[1]
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("2185601258")),
        BigNumber.from(10).pow(18)
      );

      // endowment = $43,787,750, price = 0.447877

      // $1500  => ~3,349
      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(1500), false, 0);
      expect(
        mockGenesisPurposeEscrow.stakePurpose.getCall(3).args[1]
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("3349")),
        BigNumber.from(10).pow(18)
      );
    });

    it("should revert if invalid coin", async () => {
      const daiAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
      await expect(
        pfpContract.connect(contributor).deposit(daiAddress, 100, true, 0)
      ).to.be.reverted;
    });

    it("should revert if mint purpose fails", async () => {
      const endowmentBalance = await mockUSDCToken.balanceOf(
        endowmentFund.address
      );
      const foundationBalance = await mockUSDCToken.balanceOf(
        foundationFund.address
      );
      const contributorBalance = await mockUSDCToken.balanceOf(
        contributor.address
      );

      fakePurposeToken.mintPurpose.reverts();

      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, 100, true, 0)
      ).to.be.reverted;

      expect(await mockUSDCToken.balanceOf(endowmentFund.address)).to.equal(
        endowmentBalance
      );
      expect(await mockUSDCToken.balanceOf(foundationFund.address)).to.equal(
        foundationBalance
      );
      expect(await mockUSDCToken.balanceOf(contributor.address)).to.equal(
        contributorBalance
      );
    });

    it("should revert if stake purpose fails", async () => {
      const endowmentBalance = await mockUSDCToken.balanceOf(
        endowmentFund.address
      );
      const foundationBalance = await mockUSDCToken.balanceOf(
        foundationFund.address
      );
      const contributorBalance = await mockUSDCToken.balanceOf(
        contributor.address
      );

      mockGenesisPurposeEscrow.stakePurpose.reverts();

      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, 200, true, 0)
      ).to.be.reverted;

      expect(await mockUSDCToken.balanceOf(endowmentFund.address)).to.equal(
        endowmentBalance
      );
      expect(await mockUSDCToken.balanceOf(foundationFund.address)).to.equal(
        foundationBalance
      );
      expect(await mockUSDCToken.balanceOf(contributor.address)).to.equal(
        contributorBalance
      );
    });

    it("should revert if negative amount sent", async () => {
      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, -1000, true, 0)
      ).to.be.reverted;
    });

    it("should revert if deposit is less than $5", async () => {
      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, usdToUSDC(4), true, 0)
      ).to.be.revertedWith("PFP: Deposit value too low");
    });

    it("should not revert if deposit is exactly min deposit amount", async () => {
      const minDeposit = 4;
      await pfpContract.updateMinimumDeposit(minDeposit);

      await pfpContract
        .connect(contributor)
        .deposit(mockUSDCToken.address, usdToUSDC(minDeposit), true, 0);

      const purposeTokenDecimals = BigNumber.from(10).pow(
        PURPOSE_TOKEN_DECIMALS
      );
      expect(mockGenesisPurposeEscrow.stakePurpose).to.have.been.calledWith(
        contributor.address,
        BigNumber.from(minDeposit / 0.02).mul(purposeTokenDecimals),
        true,
        20000,
        "USDC"
      );
    });

    it("should revert if the amount of purpose token received is less than the minimum specified", async () => {
      // endowment has $1M, price = 2c
      await expect(
        pfpContract
          .connect(contributor)
          .deposit(
            mockUSDCToken.address,
            usdToUSDC(5),
            true,
            purposeWithDecimals(BigNumber.from(1000))
          )
      ).to.be.revertedWith("PFP: Token amount < min.");
    });

    it("should revert if protocol is paused", async () => {
      await pfpContract.pauseProtocol();
      await expect(
        pfpContract
          .connect(contributor)
          .deposit(mockUSDCToken.address, 200, true, 0)
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("getPurposePrice", () => {
    it("should be $0.01 if contributions are 0", async () => {
      await pfpContract.setVariable("totalEndowmentContributionsInUsd", 0);
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(10000));
    });

    it("should increase by $0.01 every $1M", async () => {
      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(10 ** 6).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(20000));

      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(51 * 10 ** 6).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(520000));

      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(77 * 10 ** 6).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(780000));

      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from("10000000011111111")
      );
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(100010000));
    });

    it("should follow line equation increase", async () => {
      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from("20022058").mul(10 ** PFP_USD_DECIMALS)
      );
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(210220));

      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from("9272379512").mul(10 ** (PFP_USD_DECIMALS - 2))
      );
      expect(
        await pfpContract.connect(contributor).getPurposePrice()
      ).to.be.equal(BigNumber.from(937237));
    });

    it("should be $1.01 if contributions are $100M", async () => {
      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(100 * 10 ** 6).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await pfpContract.connect(contributor).getPurposePrice()).to.be.eq(
        BigNumber.from(1010000)
      );
    });

    it("should be $10.01 if contributions are $1B", async () => {
      await pfpContract.setVariable(
        "totalEndowmentContributionsInUsd",
        BigNumber.from(10 ** 9).mul(10 ** PFP_USD_DECIMALS)
      );
      expect(await pfpContract.connect(contributor).getPurposePrice()).to.be.eq(
        BigNumber.from(10010000)
      );
    });
  });

  describe("calculateTokensToMint", () => {
    it("should be 100M tokens given $1M with price at $0.01", async () => {
      expect(
        await pfpContract
          .connect(contributor)
          .calculateTokensToMint(
            0.01 * 10 ** 6,
            BigNumber.from(10 ** 6 * 10 ** 6)
          )
      ).to.be.eq(purposeWithDecimals(BigNumber.from(100 * 10 ** 6)));
    });

    it("should be 1M tokens given $1M with price at $1", async () => {
      expect(
        await pfpContract
          .connect(contributor)
          .calculateTokensToMint(1 * 10 ** 6, BigNumber.from(10 ** 6 * 10 ** 6))
      ).to.be.eq(purposeWithDecimals(BigNumber.from(1 * 10 ** 6)));
    });

    it("should work with irregular price and deposit amounts", async () => {
      expect(
        await pfpContract
          .connect(contributor)
          .calculateTokensToMint(1001796, BigNumber.from("44902").mul(10 ** 6))
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("44821")),
        BigNumber.from(10).pow(18)
      );

      expect(
        await pfpContract
          .connect(contributor)
          .calculateTokensToMint(210879, BigNumber.from("2949").mul(10 ** 6))
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from("13984")),
        BigNumber.from(10).pow(18)
      );
    });

    it("should return 0 if deposit is 0", async () => {
      expect(
        await pfpContract
          .connect(contributor)
          .calculateTokensToMint(0.1 * 10 ** 6, 0)
      ).to.be.equal(0);
    });

    it("should revert if price is 0", async () => {
      await expect(
        pfpContract.connect(contributor).calculateTokensToMint(0, 1)
      ).to.be.revertedWith("PFP: price <= 0");
    });
  });

  describe("withdrawGenesisPurpose", () => {
    beforeEach(async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // setup fake purpose token so that we don't need to deal with supply
      fakePurposeToken.transfer.returns(true);

      // contributor.0: 2M purpose for 6m, staked 7m ago, nothing withdrawn
      // contributor.1: 5M purpose for 12m, staked 25m ago, 25% withdrawn
      await mockGenesisPurposeEscrow.setVariables({
        vestSchedules: {
          [contributor.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("2000000")),
              createdAt: now - 86400 * 212,
              isAccelerated: true,
              purposePrice: 50000,
              interestRate: 10000000,
              vestStartingDate: now - 86400 * 30,
            },
            1: {
              initBalance: purposeWithDecimals(BigNumber.from("5000000")),
              createdAt: now - 86400 * (365 * 2 + 30),
              isAccelerated: false,
              purposePrice: 10000,
              interestRate: 10000000,
              vestStartingDate: now - 86400 * 365,
              withdrawnBalance: purposeWithDecimals(BigNumber.from("1250000")),
            },
          },
        },
        numVestSchedules: {
          [contributor.address]: 2,
        },
      });
    });

    it("should withdraw purpose and rewards", async () => {
      await pfpContract.connect(contributor).withdrawGenesisPurpose(0);

      expect(mockGenesisPurposeEscrow.withdrawPurpose).to.have.been.calledWith(
        contributor.address,
        0,
        purposeWithDecimals(BigNumber.from("200000"))
      );

      expect(mockGenesisPurposeEscrow.claimReward).to.have.been.calledOnce;   // eslint-disable-line
      expect(mockGenesisPurposeEscrow.claimReward.getCall(0).args[0]).to.eq(
        contributor.address
      );
      expect(mockGenesisPurposeEscrow.claimReward.getCall(0).args[1]).to.eq(0);
      expect(mockGenesisPurposeEscrow.claimReward.getCall(0).args[2]).to.be.gt(
        0
      );
    });

    it("should withdraw next tranche of purpose and no rewards", async () => {
      // contributor.1: 5M purpose for 12m, staked 25m ago, 25% withdrawn
      // calc rewards and update internal vest schedule with rewards withdrawn
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      const rewards = await mockGenesisPurposeEscrow.calcTotalReward(
        contributor.address,
        1,
        now
      );
      await mockGenesisPurposeEscrow.setVariables({
        vestSchedules: {
          [contributor.address]: {
            1: {
              paidReward: rewards,
            },
          },
        },
      });

      await pfpContract.connect(contributor).withdrawGenesisPurpose(1);

      expect(mockGenesisPurposeEscrow.withdrawPurpose).to.have.been.calledWith(
        contributor.address,
        1,
        purposeWithDecimals(BigNumber.from("1250000"))
      );

      expect(mockGenesisPurposeEscrow.claimReward).to.have.callCount(0);
    });

    it("should withdraw rewards only if staked amount already withdrawn", async () => {
      // contributor.0: 2M purpose for 6m, staked 7m ago, 10% staked purpose withdrawn
      // calc rewards and update internal vest schedule with rewards withdrawn
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;
      const rewards = await mockGenesisPurposeEscrow.calcTotalReward(
        contributor.address,
        0,
        now
      );
      await mockGenesisPurposeEscrow.setVariables({
        vestSchedules: {
          [contributor.address]: {
            0: {
              withdrawnBalance: purposeWithDecimals(BigNumber.from("200000")),
            },
          },
        },
      });

      await pfpContract.connect(contributor).withdrawGenesisPurpose(0);

      expect(mockGenesisPurposeEscrow.withdrawPurpose).to.have.callCount(0);

      expect(mockGenesisPurposeEscrow.claimReward).to.have.been.calledWith(
        contributor.address,
        0,
        rewards
      );
    });

    it("should revert if address hasn't minted purpose", async () => {
      await expect(
        pfpContract.connect(roleManager).withdrawGenesisPurpose(0)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert if unknown index", async () => {
      await expect(
        pfpContract.connect(contributor).withdrawGenesisPurpose(10)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert if protocol is paused", async () => {
      await pfpContract.pauseProtocol();
      await expect(
        pfpContract.connect(contributor).withdrawGenesisPurpose(1)
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("getAccountDetails", () => {
    beforeEach(async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor: withdrew 500k purpose
      fakePurposeToken.balanceOf.returns(
        purposeWithDecimals(BigNumber.from("500000"))
      );
      // contributor.0: 2M purpose for 6m, staked 12m ago, withdrawn 2 tranches
      // contributor.1: 1M purpose for 12m, staked today
      await mockGenesisPurposeEscrow.setVariables({
        vestSchedules: {
          [contributor.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from(2 * 10 ** 6)),
              createdAt: now - 86400 * 365,
              isAccelerated: true,
              purposePrice: 40000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now - 86400 * 182,
              withdrawnBalance: purposeWithDecimals(BigNumber.from("500000")),
              paidReward: purposeWithDecimals(BigNumber.from("80000")),
            },
            1: {
              initBalance: purposeWithDecimals(BigNumber.from(10 ** 6)),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: 3823671002,
              vestStartingDate: now + 86400 * 365,
            },
          },
        },
        numVestSchedules: {
          [contributor.address]: 2,
        },
      });
    });

    it("should return the account state", async () => {
      const accountState = await pfpContract.getAccountDetails(
        contributor.address
      );

      expect(accountState.purposeStaked).to.eq(
        purposeWithDecimals(
          BigNumber.from(2 * 10 ** 6)
            .sub(5 * 10 ** 5)
            .add(10 ** 6)
        )
      );
      expect(accountState.purposeHeld).to.eq(
        purposeWithDecimals(BigNumber.from(5 * 10 ** 5))
      );
      expect(accountState.rewardsPaid).to.eq(
        purposeWithDecimals(BigNumber.from("80000"))
      );

      expect(accountState.transactions.length).to.eq(2);

      // assert first transaction
      const firstTransaction = accountState.transactions[0];
      expect(firstTransaction.schedule.initBalance).to.eq(
        purposeWithDecimals(BigNumber.from(2 * 10 ** 6))
      );
      expect(firstTransaction.schedule.isAccelerated).to.be.true;   // eslint-disable-line
      expect(firstTransaction.schedule.withdrawnBalance).to.eq(
        purposeWithDecimals(BigNumber.from("500000"))
      );
      //    tranches
      let startDate = new Date(
        firstTransaction.schedule.vestStartingDate.mul(1000).toNumber()
      ); // js time is in ms; solidity is in s
      expect(firstTransaction.tranches.length).to.eq(5);
      expect(firstTransaction.tranches[0].amountAvailable).to.eq(0); // already withdrawn
      expect(firstTransaction.tranches[0].rewardAvailable).to.eq(0); // already withdrawn
      expect(firstTransaction.tranches[0].dateAvailable).to.eq(
        startDate.getTime() / 1000
      );
      expect(firstTransaction.tranches[1].amountAvailable).to.eq(0); // already withdrawn
      expect(firstTransaction.tranches[1].rewardAvailable).to.eq(0); // already withdrawn
      let nextTrancheDate = new Date(
        startDate.setMonth(startDate.getMonth() + 6)
      );
      expect(firstTransaction.tranches[1].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 3 // range of 3 days; might be leap year
      );
      expect(firstTransaction.tranches[2].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(5 * 10 ** 5))
      );
      expect(firstTransaction.tranches[2].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(
        nextTrancheDate.setMonth(nextTrancheDate.getMonth() + 6)
      );
      expect(firstTransaction.tranches[2].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 4
      );
      expect(firstTransaction.tranches[3].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(10 * 10 ** 5))
      );
      expect(firstTransaction.tranches[3].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(
        nextTrancheDate.setMonth(nextTrancheDate.getMonth() + 6)
      );
      expect(firstTransaction.tranches[3].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 4
      );
      expect(firstTransaction.tranches[4].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(15 * 10 ** 5))
      );
      expect(firstTransaction.tranches[4].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(
        nextTrancheDate.setMonth(nextTrancheDate.getMonth() + 6)
      );
      expect(firstTransaction.tranches[4].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 5
      );

      // assert second transaction
      const secondTransaction = accountState.transactions[1];
      expect(secondTransaction.schedule.initBalance).to.eq(
        purposeWithDecimals(BigNumber.from(10 ** 6))
      );
      expect(secondTransaction.schedule.isAccelerated).to.be.false;   // eslint-disable-line
      //    tranches
      startDate = new Date(
        secondTransaction.schedule.vestStartingDate.mul(1000).toNumber()
      ); // js time is in ms; solidity is in s
      expect(secondTransaction.tranches.length).to.eq(5);
      expect(secondTransaction.tranches[0].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(1 * 10 ** 5))
      );
      expect(secondTransaction.tranches[0].rewardAvailable).to.gt(0);
      expect(secondTransaction.tranches[0].dateAvailable).to.eq(
        startDate.getTime() / 1000
      );
      expect(secondTransaction.tranches[1].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(2.5 * 10 ** 5))
      );
      expect(secondTransaction.tranches[1].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(startDate.setMonth(startDate.getMonth() + 6));
      expect(secondTransaction.tranches[1].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 3 // range of 3 days; might be leap year
      );
      expect(secondTransaction.tranches[2].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(5 * 10 ** 5))
      );
      expect(secondTransaction.tranches[2].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(
        nextTrancheDate.setMonth(nextTrancheDate.getMonth() + 6)
      );
      expect(secondTransaction.tranches[2].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 4
      );
      expect(secondTransaction.tranches[3].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(7.5 * 10 ** 5))
      );
      expect(secondTransaction.tranches[3].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(
        nextTrancheDate.setMonth(nextTrancheDate.getMonth() + 6)
      );
      expect(secondTransaction.tranches[3].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 4
      );
      expect(secondTransaction.tranches[4].amountAvailable).to.eq(
        purposeWithDecimals(BigNumber.from(10 * 10 ** 5))
      );
      expect(secondTransaction.tranches[4].rewardAvailable).to.gt(0);
      nextTrancheDate = new Date(
        nextTrancheDate.setMonth(nextTrancheDate.getMonth() + 6)
      );
      expect(secondTransaction.tranches[4].dateAvailable).to.be.closeTo(
        BigNumber.from(nextTrancheDate.getTime()).div(1000),
        86400 * 5
      );
    });

    it("should revert if address hasn't minted purpose", async () => {
      await expect(
        pfpContract.getAccountDetails(roleManager.address)
      ).to.be.revertedWith("Escrow: Address not found");
    });
  });
});
