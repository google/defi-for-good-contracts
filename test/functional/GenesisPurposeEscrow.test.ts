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
import { assert, expect, use } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  GenesisPurposeEscrow,
  GenesisPurposeEscrow__factory,
  PurposeToken,
  PurposeToken__factory,
  TestPFPConfig,
} from "../../build/types";

import { FakeContract, smock, MockContract } from "@defi-wonderland/smock";
import { purposeWithDecimals } from "../test-helpers/utils";
import { ZERO_ADDRESS, INTEREST_RATE_20APY } from "../test-helpers/constants";

use(smock.matchers);

describe("GenesisPurposeEscrow", function () {
  let escrowContract: MockContract<GenesisPurposeEscrow>;
  let purposeToken: MockContract<PurposeToken>;
  let fakeTestPFPConfig: FakeContract<TestPFPConfig>;
  let owner: SignerWithAddress;
  let contributor1: SignerWithAddress;
  let contributor2: SignerWithAddress;
  let roleManager: SignerWithAddress;
  let pfpContract: SignerWithAddress;
  let pfpAdmin: SignerWithAddress;

  beforeEach(async () => {
    [owner, contributor1, contributor2, roleManager, pfpContract, pfpAdmin] =
      await ethers.getSigners();

    fakeTestPFPConfig = await smock.fake<TestPFPConfig>("TestPFPConfig");
    fakeTestPFPConfig.roleManager.returns(roleManager.address);

    const purposeTokenFactory = await smock.mock<PurposeToken__factory>(
      "PurposeToken",
      owner
    );
    purposeToken = await purposeTokenFactory.deploy(fakeTestPFPConfig.address);
    await purposeToken.deployed();

    const escrowFactory = await smock.mock<GenesisPurposeEscrow__factory>(
      "GenesisPurposeEscrow",
      owner
    );

    // unit tests for zero parameter check
    await expect(
      escrowFactory.deploy(ZERO_ADDRESS, fakeTestPFPConfig.address)
    ).to.be.revertedWith("Escrow: zero address");

    await expect(
      escrowFactory.deploy(purposeToken.address, ZERO_ADDRESS)
    ).to.be.revertedWith("Escrow: zero address");

    escrowContract = await escrowFactory.deploy(
      purposeToken.address,
      fakeTestPFPConfig.address
    );

    await escrowContract.deployed();

    await escrowContract
      .connect(roleManager)
      .grantRole(await escrowContract.STAKER_ROLE(), pfpContract.address);
    await escrowContract
      .connect(roleManager)
      .grantRole(await escrowContract.WITHDRAWER_ROLE(), pfpContract.address);
    await escrowContract
      .connect(roleManager)
      .grantRole(await escrowContract.ADMIN_ROLE(), pfpAdmin.address);

    await purposeToken
      .connect(roleManager)
      .grantRole(await purposeToken.MINTER_ROLE(), escrowContract.address);
    await purposeToken
      .connect(roleManager)
      .grantRole(await purposeToken.MINTER_ROLE(), owner.address);

    // mint some purpose
    purposeToken.mintPurpose(
      escrowContract.address,
      purposeWithDecimals(BigNumber.from(10 * 10 ** 6))
    );
  });

  describe("deploy", () => {
    it("should set config roleManager as Admin Role", async () => {
      expect(
        await escrowContract.hasRole(
          await escrowContract.DEFAULT_ADMIN_ROLE(),
          roleManager.address
        )
      ).to.eq(true);
    });
  });

  describe("stakePurpose", () => {
    it("should create 6m Vest Schedule", async () => {
      await escrowContract.setVariables({
        interestRate: INTEREST_RATE_20APY,
      });

      await escrowContract
        .connect(pfpContract)
        .stakePurpose(
          contributor1.address,
          BigNumber.from(10 ** 6),
          true,
          10000,
          "ETH"
        );

      const blockNumber = ethers.provider.getBlockNumber();
      const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;

      const vestSchedule = await escrowContract.vestSchedules(
        contributor1.address,
        0
      );
      expect(vestSchedule.initBalance).to.eq(10 ** 6);
      expect(vestSchedule.isAccelerated).to.eq(true);
      expect(vestSchedule.withdrawnBalance).to.eq(0);
      expect(vestSchedule.paidReward).to.eq(0);
      expect(vestSchedule.purposePrice).to.eq(10000);
      expect(vestSchedule.depositTokenSymbol).to.eq("ETH");
      expect(vestSchedule.interestRate).to.eq(
        BigNumber.from(INTEREST_RATE_20APY)
      );
      expect(vestSchedule.createdAt).to.eq(timestamp);
      expect(vestSchedule.vestStartingDate).to.be.closeTo(
        BigNumber.from(timestamp + (86400 * 365) / 2),
        BigNumber.from(86400 * 2)
      );

      expect(await escrowContract.numVestSchedules(contributor1.address)).to.eq(
        1
      );
    });

    it("should create 12m Vest Schedule", async () => {
      await escrowContract
        .connect(pfpContract)
        .stakePurpose(
          contributor1.address,
          purposeWithDecimals(BigNumber.from(198 * 10 ** 6)),
          false,
          20000,
          "USDC"
        );

      const blockNumber = ethers.provider.getBlockNumber();
      const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;

      const vestSchedule = await escrowContract.vestSchedules(
        contributor1.address,
        0
      );
      expect(vestSchedule.initBalance).to.eq(
        purposeWithDecimals(BigNumber.from(198 * 10 ** 6))
      );
      expect(vestSchedule.isAccelerated).to.eq(false);
      expect(vestSchedule.withdrawnBalance).to.eq(0);
      expect(vestSchedule.paidReward).to.eq(0);
      expect(vestSchedule.purposePrice).to.eq(20000);
      expect(vestSchedule.interestRate).to.eq(0);
      expect(vestSchedule.createdAt).to.eq(timestamp);
      expect(vestSchedule.vestStartingDate).to.be.closeTo(
        BigNumber.from(timestamp + 86400 * 365),
        BigNumber.from(86400)
      );

      expect(await escrowContract.numVestSchedules(contributor1.address)).to.eq(
        1
      );
    });

    it("should store multiple Vest Schedules", async () => {
      await escrowContract
        .connect(pfpContract)
        .stakePurpose(contributor1.address, 1000, false, 10000, "DAI");
      await escrowContract
        .connect(pfpContract)
        .stakePurpose(contributor2.address, 1000, false, 20000, "USDC");
      await escrowContract
        .connect(pfpContract)
        .stakePurpose(contributor1.address, 2000, false, 30000, "ETH");

      expect(await escrowContract.numVestSchedules(contributor1.address)).to.eq(
        2
      );
      expect(await escrowContract.numVestSchedules(contributor2.address)).to.eq(
        1
      );

      let vestSchedule = await escrowContract.vestSchedules(
        contributor1.address,
        1
      );
      expect(vestSchedule.initBalance).to.eq(2000);
      expect(vestSchedule.purposePrice).to.eq(30000);

      vestSchedule = await escrowContract.vestSchedules(
        contributor2.address,
        0
      );
      expect(vestSchedule.initBalance).to.eq(1000);
      expect(vestSchedule.purposePrice).to.eq(20000);
    });

    it("should emit PurposeStaked event", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .stakePurpose(contributor1.address, 1000, false, 10000, "ETH")
      )
        .to.emit(escrowContract, "PurposeStaked")
        .withArgs(contributor1.address, 1000);
    });

    it("should revert if caller not in STAKER_ROLE", async () => {
      const stakerRole = await escrowContract.STAKER_ROLE();
      let errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${stakerRole}`;
      await expect(
        escrowContract.stakePurpose(
          contributor1.address,
          BigNumber.from(10 ** 6),
          true,
          10000,
          ""
        )
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${contributor1.address.toLocaleLowerCase()} is missing role ${stakerRole}`;
      await expect(
        escrowContract
          .connect(contributor1)
          .stakePurpose(
            contributor1.address,
            BigNumber.from(10 ** 6),
            true,
            10000,
            ""
          )
      ).to.be.revertedWith(errorMsg);
    });

    it("should revert if amount is 0", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .stakePurpose(contributor1.address, 0, true, 10000, "")
      ).to.be.revertedWith("Escrow: Purpose amount <= 0");
    });
  });

  describe("withdrawPurpose", () => {
    beforeEach(async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 1M purpose for 12m, staked today
      // contributor2: 2M purpose for 6m, staked 7m ago, nothing withdrawn
      // contributor2: 5M purpose for 12m, staked 25m ago, 50% withdrawn
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("1000000")),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              vestStartingDate: now + 86400 * 365,
            },
          },
          [contributor2.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("2000000")),
              createdAt: now - 86400 * 212,
              isAccelerated: true,
              purposePrice: 50000,
              vestStartingDate: now - 86400 * 30,
            },
            1: {
              initBalance: purposeWithDecimals(BigNumber.from("5000000")),
              createdAt: now - 86400 * (365 * 2 + 30),
              isAccelerated: false,
              purposePrice: 10000,
              vestStartingDate: now - 86400 * 365,
              withdrawnBalance: purposeWithDecimals(BigNumber.from("2500000")),
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 1,
          [contributor2.address]: 2,
        },
      });
    });

    it("should allow contributor to withdraw all available", async () => {
      // contributor2.0: 2M purpose for 6m, staked 7m ago, nothing withdrawn
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();
      const availablePurpose = purposeWithDecimals(BigNumber.from(2 * 10 ** 5));

      await escrowContract
        .connect(pfpContract)
        .withdrawPurpose(contributor2.address, 0, availablePurpose);

      // should not mint any new purpose (note: test setup calls mintPurpose initially)
      expect(purposeToken.mintPurpose).to.have.callCount(1);

      // should have called erc20 transfer method
      expect(purposeToken.transfer).to.have.been.calledWith(
        contributor2.address,
        availablePurpose
      );

      // purpose total supply does not increase
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);

      // contributor unstaked purpose
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance.add(availablePurpose)
      );
      // escrow purpose balance decreases
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance.sub(availablePurpose)
      );

      // withdrawing any more should fail
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(contributor2.address, 0, BigNumber.from("1000000"))
      ).to.be.revertedWith("Escrow: Insufficient amount");
    });

    it("should allow contributor to withdraw in chunks", async () => {
      // contributor2.0: 2M purpose for 6m, staked 7m ago, nothing withdrawn
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();

      // withdraw 100k of 200k available
      await escrowContract
        .connect(pfpContract)
        .withdrawPurpose(
          contributor2.address,
          0,
          purposeWithDecimals(BigNumber.from("100000"))
        );

      // withdraw 50k of 100k available
      await escrowContract
        .connect(pfpContract)
        .withdrawPurpose(
          contributor2.address,
          0,
          purposeWithDecimals(BigNumber.from("50000"))
        );

      // purpose total supply does not increase
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);

      // contributor unstaked purpose
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance.add(purposeWithDecimals(BigNumber.from("150000")))
      );
      // escrow purpose balance decreases
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance.sub(purposeWithDecimals(BigNumber.from("150000")))
      );

      // withdrawing more than 50k available should fail
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(
            contributor2.address,
            0,
            purposeWithDecimals(BigNumber.from("50001"))
          )
      ).to.be.revertedWith("Escrow: Insufficient amount");
    });

    it("should emit PurposeWithdrawn event", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(contributor2.address, 0, BigNumber.from("1000000"))
      )
        .to.emit(escrowContract, "PurposeWithdrawn")
        .withArgs(contributor2.address, BigNumber.from("1000000"));
    });

    it("should revert if trying to withdraw more than available", async () => {
      // contributor2.1: 5M purpose for 12m, staked 25m ago, 50% withdrawn
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(contributor2.address, 1, BigNumber.from("1000000"))
      ).to.be.revertedWith("Escrow: Insufficient amount");
    });

    it("should revert if no balance remains", async () => {
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor2.address]: {
            0: {
              withdrawnBalance: purposeWithDecimals(
                BigNumber.from(2 * 10 ** 6)
              ),
            },
          },
        },
      });

      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(
            contributor2.address,
            0,
            purposeWithDecimals(BigNumber.from("100000"))
          )
      ).to.be.revertedWith("Escrow: Insufficient amount");
    });

    it("should revert if transfer fails", async () => {
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();

      purposeToken.transfer.reverts();

      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(contributor2.address, 0, 1)
      ).to.be.reverted;

      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance
      );
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance
      );
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);
    });

    it("should revert before vest date", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(
            contributor1.address,
            0,
            purposeWithDecimals(BigNumber.from("100000"))
          )
      ).to.be.revertedWith("Escrow: No withdrawable amount");
    });

    it("should revert given unknown index", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(
            contributor1.address,
            110,
            purposeWithDecimals(BigNumber.from("100000"))
          )
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert given unknown address", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .withdrawPurpose(pfpContract.address, 0, 1)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert if caller not in WITHDRAWER_ROLE", async () => {
      const withdrawerRole = await escrowContract.WITHDRAWER_ROLE();
      let errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${withdrawerRole}`;
      await expect(
        escrowContract.withdrawPurpose(contributor1.address, 0, 1)
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${contributor1.address.toLocaleLowerCase()} is missing role ${withdrawerRole}`;
      await expect(
        escrowContract
          .connect(contributor1)
          .withdrawPurpose(contributor1.address, 0, 1)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe("withdrawPurposeAdmin", () => {
    let blockNumber: number;
    let now: number;
    beforeEach(async () => {
      blockNumber = await ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 1M purpose for 12m, staked today
      // contributor2: 2M purpose for 6m, staked 7m ago
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from(10 ** 6)),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now + 86400 * 365,
            },
          },
          [contributor2.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from(2 * 10 ** 6)),
              createdAt: now - 86400 * 212,
              isAccelerated: true,
              purposePrice: 10000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now - 86400 * 30,
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 1,
          [contributor2.address]: 1,
        },
      });
    });

    it("should transfer purpose and rewards to contributor", async () => {
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();
      const stakedPurpose = purposeWithDecimals(BigNumber.from(2 * 10 ** 6));
      const rewards = await escrowContract
        .connect(pfpAdmin)
        .calcAvailableReward(contributor2.address, 0, now);
      expect(rewards).to.be.gt(0);

      await escrowContract
        .connect(pfpAdmin)
        .withdrawPurposeAdmin(contributor2.address, 0);

      // should mint rewards (note: test setup calls mintPurpose initially)
      expect(purposeToken.mintPurpose).to.have.been.calledWith(
        escrowContract.address,
        rewards
      );

      // should have called erc20 transfer method
      expect(purposeToken.transfer).to.have.been.calledWith(
        contributor2.address,
        stakedPurpose.add(rewards)
      );

      // purpose total supply increases by rewards
      expect(await purposeToken.totalSupply()).to.equal(
        purposeSupply.add(rewards)
      );
      // contributor gets rewards + staked purpose
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance.add(stakedPurpose).add(rewards)
      );
      // escrow purpose balance decreases by staked amount only
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance.sub(stakedPurpose)
      );
    });

    it("should transfer purpose and no rewards to contributor", async () => {
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor2.address]: {
            0: {
              interestRate: 0,
            },
          },
        },
      });

      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();
      const stakedPurpose = purposeWithDecimals(BigNumber.from(2 * 10 ** 6));

      await escrowContract
        .connect(pfpAdmin)
        .withdrawPurposeAdmin(contributor2.address, 0);

      // should not mint rewards (note: test setup calls mintPurpose initially)
      expect(purposeToken.mintPurpose).to.have.callCount(1);

      // should have called erc20 transfer method
      expect(purposeToken.transfer).to.have.been.calledWith(
        contributor2.address,
        stakedPurpose
      );

      // purpose total supply should not have increased
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);
      // contributor gets staked purpose only
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance.add(stakedPurpose)
      );
      // escrow purpose balance decreases by staked amount only
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance.sub(stakedPurpose)
      );
    });

    it("should emit PurposeWithdrawn event", async () => {
      const stakedPurpose = purposeWithDecimals(BigNumber.from(2 * 10 ** 6));
      const rewards = await escrowContract
        .connect(pfpAdmin)
        .calcAvailableReward(contributor2.address, 0, now);

      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(contributor2.address, 0)
      )
        .to.emit(escrowContract, "PurposeWithdrawn")
        .withArgs(contributor2.address, stakedPurpose.add(rewards));
    });

    it("should revert if mint purpose fails", async () => {
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();

      purposeToken.mintPurpose.reverts();

      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(contributor2.address, 0)
      ).to.be.reverted;

      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance
      );
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance
      );
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);
    });

    it("should revert if transfer fails", async () => {
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();

      purposeToken.transfer.reverts();

      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(contributor2.address, 0)
      ).to.be.reverted;

      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance
      );
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance
      );
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);
    });

    it("should revert if no balance remains", async () => {
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor2.address]: {
            0: {
              withdrawnBalance: purposeWithDecimals(
                BigNumber.from(2 * 10 ** 6)
              ),
            },
          },
        },
      });

      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(contributor2.address, 0)
      ).to.be.revertedWith("Escrow: Insufficient amount");
    });

    it("should revert before vest date", async () => {
      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(contributor1.address, 0)
      ).to.be.revertedWith("Escrow: No withdrawable amount");
    });

    it("should revert given unknown index", async () => {
      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(contributor1.address, 110)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert given unknown address", async () => {
      await expect(
        escrowContract
          .connect(pfpAdmin)
          .withdrawPurposeAdmin(pfpContract.address, 0)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert if caller not in ADMIN_ROLE", async () => {
      const adminRole = await escrowContract.ADMIN_ROLE();
      let errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        escrowContract.withdrawPurposeAdmin(contributor1.address, 0)
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${contributor1.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        escrowContract
          .connect(contributor1)
          .withdrawPurposeAdmin(contributor1.address, 0)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe("calcWithdrawableAmount", () => {
    let blockNumber: number;
    let now: number;
    beforeEach(async () => {
      blockNumber = await ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 20M purpose for 12m, staked today
      // contributor2: 1.5M purpose for 6m, staked 7m ago, 10% withdrawn
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("20000000")),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now + 86400 * 365,
            },
          },
          [contributor2.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("1500000")),
              createdAt: now - 86400 * 212,
              isAccelerated: true,
              purposePrice: 50000,
              interestRate: INTEREST_RATE_20APY,
              withdrawnBalance: purposeWithDecimals(BigNumber.from("150000")),
              vestStartingDate: now - 86400 * 30,
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 1,
          [contributor2.address]: 1,
        },
      });
    });

    it("should return correct withdrawable amounts at vest dates", async () => {
      // contributor1: 20M purpose for 12m, staked today

      // now: nothing should be available
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor1.address,
          0,
          now
        )
      ).to.eq(0);

      // now + 12m: 10% available
      const firstTranche = purposeWithDecimals(BigNumber.from("2000000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor1.address,
          0,
          now + 86400 * 366
        )
      ).to.eq(firstTranche);

      // now + 18m: 10% + 15% available
      const secondTranche = purposeWithDecimals(BigNumber.from("3000000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor1.address,
          0,
          now + 86400 * 549
        )
      ).to.eq(firstTranche.add(secondTranche));

      // now + 24m: 10% + 15%  + 25% available
      const thirdTranche = purposeWithDecimals(BigNumber.from("5000000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor1.address,
          0,
          now + 86400 * 731
        )
      ).to.eq(firstTranche.add(secondTranche).add(thirdTranche));

      // now + 30m: 10% + 15%  + 25%  + 25% available
      const fourthTranche = purposeWithDecimals(BigNumber.from("5000000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor1.address,
          0,
          now + 86400 * 915
        )
      ).to.eq(
        firstTranche.add(secondTranche).add(thirdTranche).add(fourthTranche)
      );

      // now + 36m: 10% + 15%  + 25%  + 25% + 25% available
      const fifthTranche = purposeWithDecimals(BigNumber.from("5000000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor1.address,
          0,
          now + 86400 * 1096
        )
      ).to.eq(
        firstTranche
          .add(secondTranche)
          .add(thirdTranche)
          .add(fourthTranche)
          .add(fifthTranche)
      );
    });

    it("should consider already withdrawn", async () => {
      // contributor2: 1.5M purpose for 6m, staked 7m ago, 10% withdrawn

      // now: nothing should be available
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor2.address,
          0,
          now
        )
      ).to.eq(0);

      // now + 5m: 15% available (10% already withdrawn)
      const secondTranche = purposeWithDecimals(BigNumber.from("225000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor2.address,
          0,
          now + 86400 * 154
        )
      ).to.eq(secondTranche);

      // now + 17m: 15% + 25% available
      const thirdTranche = purposeWithDecimals(BigNumber.from("375000"));
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor2.address,
          0,
          now + 86400 * 332
        )
      ).to.eq(secondTranche.add(thirdTranche));

      // update withdrawn balance: 10% + (15/2)%
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor2.address]: {
            0: {
              withdrawnBalance: purposeWithDecimals(BigNumber.from("262500")),
            },
          },
        },
      });

      // now + 17m: (15/2)% + 25% available
      expect(
        await escrowContract.calcWithdrawableAmount(
          contributor2.address,
          0,
          now + 86400 * 332
        )
      ).to.eq(secondTranche.div(2).add(thirdTranche));
    });

    it("should revert given unknown index", async () => {
      await expect(
        escrowContract.calcWithdrawableAmount(contributor1.address, 110, now)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert given unknown address", async () => {
      await expect(
        escrowContract.calcWithdrawableAmount(pfpContract.address, 0, now)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });
  });

  describe("claimReward", () => {
    beforeEach(async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 1M purpose for 12m, staked today
      // contributor2: 2M purpose for 6m, staked 7m ago, nothing withdrawn
      // contributor2: 5M purpose for 12m, staked 25m ago, 50% + rewards withdrawn
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("1000000")),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now + 86400 * 365,
            },
          },
          [contributor2.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("2000000")),
              createdAt: now - 86400 * 212,
              isAccelerated: true,
              purposePrice: 50000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now - 86400 * 30,
            },
            1: {
              initBalance: purposeWithDecimals(BigNumber.from("5000000")),
              createdAt: now - 86400 * (365 * 2 + 30),
              isAccelerated: false,
              purposePrice: 10000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now - 86400 * (365 + 30),
              withdrawnBalance: purposeWithDecimals(BigNumber.from("12500000")),
              paidReward: purposeWithDecimals(BigNumber.from("336639")),
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 1,
          [contributor2.address]: 2,
        },
      });
    });

    it("should allow contributor to claim all rewards available", async () => {
      // contributor2.0: 2M purpose for 6m, staked 7m ago, nothing withdrawn
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();
      const availableRewards = BigNumber.from("19034311133750682310753");

      await escrowContract
        .connect(pfpContract)
        .claimReward(contributor2.address, 0, availableRewards);

      // should mint new purpose
      expect(purposeToken.mintPurpose).to.have.been.calledWith(
        contributor2.address,
        availableRewards
      );

      // should not call erc20 transfer (minted directly into contributor account)
      expect(purposeToken.transfer).to.have.callCount(0);

      // purpose total supply should increase
      expect(await purposeToken.totalSupply()).to.equal(
        purposeSupply.add(availableRewards)
      );

      // contributor should have new purpose
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance.add(availableRewards)
      );
      // escrow purpose balance should not change
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance
      );

      // claiming any more should fail
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(contributor2.address, 0, BigNumber.from("1000000"))
      ).to.be.revertedWith("Escrow: No available reward");
    });

    it("should allow contributor to claim rewards in chunks", async () => {
      // contributor2.1: 5M purpose for 12m, staked 25m ago, 25% + all rewards withdrawn
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();

      // withdraw 250k of 550k available
      await escrowContract
        .connect(pfpContract)
        .claimReward(
          contributor2.address,
          1,
          purposeWithDecimals(BigNumber.from("250000"))
        );

      // withdraw 290k of 300k available
      await escrowContract
        .connect(pfpContract)
        .claimReward(
          contributor2.address,
          1,
          purposeWithDecimals(BigNumber.from("290000"))
        );

      // purpose total supply should increase
      const purposeRewards = purposeWithDecimals(BigNumber.from("540000"));
      expect(await purposeToken.totalSupply()).to.equal(
        purposeSupply.add(purposeRewards)
      );

      // contributor gains purpose
      expect(await purposeToken.balanceOf(contributor2.address)).to.equal(
        contributorBalance.add(purposeRewards)
      );
      // escrow purpose balance should not change
      expect(await purposeToken.balanceOf(escrowContract.address)).to.equal(
        escrowBalance
      );

      // claiming more than 10k available should fail
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(
            contributor2.address,
            1,
            purposeWithDecimals(BigNumber.from("10001"))
          )
      ).to.be.revertedWith("Escrow: No available reward");
    });

    it("should emit PurposeRewardWithdrawn event", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(contributor2.address, 0, BigNumber.from("1000"))
      )
        .to.emit(escrowContract, "PurposeRewardWithdrawn")
        .withArgs(contributor2.address, BigNumber.from("1000"));
    });

    it("should revert if trying to withdraw more than available", async () => {
      // contributor2.1: 5M purpose for 12m, staked 25m ago, 25% + all rewards withdrawn
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(
            contributor2.address,
            1,
            purposeWithDecimals(BigNumber.from("1000000"))
          )
      ).to.be.revertedWith("Escrow: No available reward");
    });

    it("should revert if paid reward more than what should be available", async () => {
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor2.address]: {
            0: {
              paidReward: purposeWithDecimals(BigNumber.from(2 * 10 ** 6)),
            },
          },
        },
      });

      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(
            contributor2.address,
            0,
            purposeWithDecimals(BigNumber.from("100000"))
          )
      ).to.be.revertedWith("Escrow: No available reward");
    });

    it("should revert if mint fails", async () => {
      const contributorBalance = await purposeToken.balanceOf(
        contributor2.address
      );
      const escrowBalance = await purposeToken.balanceOf(
        escrowContract.address
      );
      const purposeSupply = await purposeToken.totalSupply();

      purposeToken.mintPurpose.reverts();

      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(contributor2.address, 0, 1)
      ).to.be.reverted;

      expect(await purposeToken.balanceOf(contributor2.address)).to.eq(
        contributorBalance
      );
      expect(await purposeToken.balanceOf(escrowContract.address)).to.eq(
        escrowBalance
      );
      expect(await purposeToken.totalSupply()).to.equal(purposeSupply);
    });

    it("should revert before vest date", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(
            contributor1.address,
            0,
            purposeWithDecimals(BigNumber.from("100000"))
          )
      ).to.be.revertedWith("Escrow: No withdrawable amount");
    });

    it("should revert given unknown index", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(
            contributor1.address,
            110,
            purposeWithDecimals(BigNumber.from("100000"))
          )
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert given unknown address", async () => {
      await expect(
        escrowContract
          .connect(pfpContract)
          .claimReward(pfpContract.address, 0, 1)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert if caller not in WITHDRAWER_ROLE", async () => {
      const withdrawerRole = await escrowContract.WITHDRAWER_ROLE();
      let errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${withdrawerRole}`;
      await expect(
        escrowContract.claimReward(contributor1.address, 0, 1)
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${contributor1.address.toLocaleLowerCase()} is missing role ${withdrawerRole}`;
      await expect(
        escrowContract
          .connect(contributor1)
          .claimReward(contributor1.address, 0, 1)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe("calcAvailableReward", () => {
    let blockNumber: number;
    let now: number;
    beforeEach(async () => {
      blockNumber = await ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 1M purpose for 12m, staked today
      // contributor2: 1.5M purpose for 12m, staked 13m ago, 10% + rewards withdrawn
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("1000000")),
              createdAt: now - 86400 * 3,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now + 86400 * 362,
            },
          },
          [contributor2.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("1500000")),
              createdAt: now - 86400 * 396,
              isAccelerated: false,
              purposePrice: 50000,
              interestRate: INTEREST_RATE_20APY,
              withdrawnBalance: purposeWithDecimals(BigNumber.from("150000")),
              paidReward: purposeWithDecimals(BigNumber.from("30000")),
              vestStartingDate: now - 86400 * 31,
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 1,
          [contributor2.address]: 1,
        },
      });
    });

    it("should return 0 rewards before first vest date", async () => {
      // contributor1: 1M purpose for 12m, staked 3 days ago
      expect(
        await escrowContract.calcAvailableReward(contributor1.address, 0, now)
      ).to.eq(0);
    });

    it("should return rewards after first vest date", async () => {
      // contributor1: 1M purpose for 12m, staked 3 days ago
      expect(
        await escrowContract.calcAvailableReward(
          contributor1.address,
          0,
          now + 86400 * 365
        )
      ).to.gt(0);
    });

    it("should return rewards less already paid rewards", async () => {
      // contributor2: 1.5M purpose for 12m, staked 13m ago, 10% + rewards withdrawn

      // now: no rewards; already paid
      expect(
        await escrowContract.calcAvailableReward(contributor2.address, 0, now)
      ).to.be.closeTo(BigNumber.from(0), BigNumber.from(10).pow(18));

      // now + 6m: second reward only
      const expectedSecondReward =
        1500000 * 0.15 * 1.2 ** (549 / 365) - 1500000 * 0.15;
      expect(
        await escrowContract.calcAvailableReward(
          contributor2.address,
          0,
          now + 86400 * 184
        )
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(Math.floor(expectedSecondReward))),
        BigNumber.from(10).pow(21)
      );
    });

    it("should revert given unknown index", async () => {
      await expect(
        escrowContract.calcAvailableReward(contributor1.address, 110, now)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });

    it("should revert given unknown address", async () => {
      await expect(
        escrowContract.calcAvailableReward(pfpContract.address, 0, now)
      ).to.be.revertedWith("Escrow: Unavailable index");
    });
  });

  describe("calcTotalReward", () => {
    let blockNumber: number;
    let now: number;
    beforeEach(async () => {
      blockNumber = await ethers.provider.getBlockNumber();
      now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 1.5M purpose for 12m, staked today
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from("1500000")),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now + 86400 * 365,
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 1,
        },
      });
    });

    it("should calculate rewards on full principle before first vest date", async () => {
      // now: nothing should be available
      expect(
        await escrowContract.calcTotalReward(contributor1.address, 0, now)
      ).to.eq(0);

      // now + 1 day
      let expected = 1500000 * 1.2 ** (1 / 365) - 1500000;
      expect(
        await escrowContract.calcTotalReward(
          contributor1.address,
          0,
          now + 86400 * 1
        )
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(Math.floor(expected))),
        BigNumber.from(10).pow(18)
      );

      // now + 31 day
      expected = 1500000 * 1.2 ** (31 / 365) - 1500000;
      expect(
        await escrowContract.calcTotalReward(
          contributor1.address,
          0,
          now + 86400 * 31
        )
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(Math.floor(expected))),
        BigNumber.from(10).pow(18)
      );

      // now + 364 day
      expected = 1500000 * 1.2 ** (364 / 365) - 1500000;
      expect(
        await escrowContract.calcTotalReward(
          contributor1.address,
          0,
          now + 86400 * 364
        )
      ).to.be.closeTo(
        purposeWithDecimals(BigNumber.from(Math.floor(expected))),
        BigNumber.from(10).pow(18)
      );
    });

    it("should return correct rewards for each tranche", async () => {
      // contributor1: 1.5M purpose for 12m, staked today

      // now: nothing should be available
      expect(
        await escrowContract.calcTotalReward(contributor1.address, 0, now)
      ).to.eq(0);

      // now + 12m: rewards on 10% available
      const expectedFirstReward =
        1500000 * 0.1 * 1.2 ** (365 / 365) - 1500000 * 0.1;
      let actualTotalReward = await escrowContract.calcTotalReward(
        contributor1.address,
        0,
        now + 86400 * 366
      );
      expect(
        purposeWithDecimals(BigNumber.from(expectedFirstReward))
      ).to.be.closeTo(actualTotalReward, BigNumber.from(10).pow(12));

      // now + 15m: 12m rewards on 10% + nothing 18m rewards on 15%
      expect(
        await escrowContract.calcTotalReward(
          contributor1.address,
          0,
          now + 86400 * 457
        )
      ).to.eq(actualTotalReward);

      // now + 18m: 12m rewards on 10% + 18m rewards on 15%
      const expectedSecondReward =
        1500000 * 0.15 * 1.2 ** (549 / 365) - 1500000 * 0.15;
      let previousTotalReward = actualTotalReward;
      actualTotalReward = await escrowContract.calcTotalReward(
        contributor1.address,
        0,
        now + 86400 * 549
      );
      const actualSecondReward = actualTotalReward
        .sub(previousTotalReward)
        .div(BigNumber.from(10).pow(18));
      expect(expectedSecondReward).to.be.closeTo(
        actualSecondReward.toNumber(),
        500
      );

      // now + 24m: 12m rewards on 10% + 18m rewards on 15% + 24m rewards on 25%
      const expectedThirdReward =
        1500000 * 0.25 * 1.2 ** (730 / 365) - 1500000 * 0.25;
      previousTotalReward = actualTotalReward;
      actualTotalReward = await escrowContract.calcTotalReward(
        contributor1.address,
        0,
        now + 86400 * 732
      );
      const diff =
        expectedThirdReward -
        actualTotalReward
          .sub(previousTotalReward)
          .div(BigNumber.from(10).pow(18))
          .toNumber();
      expect(diff).to.be.closeTo(0, 1000); // < 1%

      // now + 30m: 12m rewards on 10% + 18m rewards on 15% + 24m rewards on 25% + 30m rewards on 25%
      const expectedFourthReward =
        1500000 * 0.25 * 1.2 ** (915 / 365) - 1500000 * 0.25;
      previousTotalReward = actualTotalReward;
      actualTotalReward = await escrowContract.calcTotalReward(
        contributor1.address,
        0,
        now + 86400 * 915
      );
      expect(
        purposeWithDecimals(BigNumber.from(Math.floor(expectedFourthReward)))
      ).to.be.closeTo(
        actualTotalReward.sub(previousTotalReward),
        BigNumber.from(10).pow(21) // prev tranche rewards calc will result an extra few hundred purpose tokens
      );

      // now + 36m: 12m rewards on 10% + 18m rewards on 15% + 24m rewards on 25% + 30m rewards on 25% + 36m rewards on 25%
      const expectedFifthReward =
        1500000 * 0.25 * 1.2 ** (1096 / 365) - 1500000 * 0.25;
      previousTotalReward = actualTotalReward;
      actualTotalReward = await escrowContract.calcTotalReward(
        contributor1.address,
        0,
        now + 86400 * 1096
      );
      const actualFifthReward = actualTotalReward
        .sub(previousTotalReward)
        .div(BigNumber.from(10).pow(18));
      expect(expectedFifthReward).to.be.closeTo(
        actualFifthReward.toNumber(),
        1000
      );

      // now + 36m+: no more extra rewards
      previousTotalReward = actualTotalReward;
      actualTotalReward = await escrowContract.calcTotalReward(
        contributor1.address,
        0,
        now + 86400 * 3600
      );
      expect(actualTotalReward).to.eq(previousTotalReward);
    });
  });

  describe("getVestSchedules", () => {
    beforeEach(async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      // contributor1: 1M purpose for 12m, staked today
      // contributor1: 2M purpose for 12m, staked 12m ago
      // contributor2: 2M purpose for 6m, staked 7m ago
      await escrowContract.setVariables({
        vestSchedules: {
          [contributor1.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from(2 * 10 ** 6)),
              createdAt: now - 86400 * 365,
              isAccelerated: false,
              purposePrice: 40000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now,
              withdrawnBalance: purposeWithDecimals(
                BigNumber.from(1 * 10 ** 6)
              ),
            },
            1: {
              initBalance: purposeWithDecimals(BigNumber.from(10 ** 6)),
              createdAt: now,
              isAccelerated: false,
              purposePrice: 20000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now + 86400 * 365,
            },
          },
          [contributor2.address]: {
            0: {
              initBalance: purposeWithDecimals(BigNumber.from(2 * 10 ** 6)),
              createdAt: now - 86400 * 212,
              isAccelerated: true,
              purposePrice: 10000,
              interestRate: INTEREST_RATE_20APY,
              vestStartingDate: now - 86400 * 30,
              withdrawnBalance: purposeWithDecimals(
                BigNumber.from(2 * 10 ** 6)
              ),
              paidReward: purposeWithDecimals(BigNumber.from(123456)),
            },
          },
        },
        numVestSchedules: {
          [contributor1.address]: 2,
          [contributor2.address]: 1,
        },
      });
    });

    it("should return all vest schedules for contributor 1", async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      const result = await escrowContract.getVestSchedules(
        contributor1.address
      );
      const { 0: vestSchedules, 1: numSchedules } = result;

      expect(vestSchedules.length).to.eq(2);
      expect(vestSchedules.length).to.eq(numSchedules);

      const firstSchedule = vestSchedules[0];
      expect(firstSchedule.initBalance).to.eq(
        purposeWithDecimals(BigNumber.from(2 * 10 ** 6))
      );
      expect(firstSchedule.createdAt).to.be.closeTo(
        BigNumber.from(now - 86400 * 365),
        1
      );
      expect(firstSchedule.isAccelerated).to.be.false;  // eslint-disable-line
      expect(firstSchedule.purposePrice).to.eq(40000);
      expect(firstSchedule.vestStartingDate).to.be.closeTo(
        BigNumber.from(now),
        1
      );
      expect(firstSchedule.withdrawnBalance).to.eq(
        purposeWithDecimals(BigNumber.from(1 * 10 ** 6))
      );
      expect(firstSchedule.paidReward).to.eq(0);

      const secondSchedule = vestSchedules[1];
      expect(secondSchedule.initBalance).to.eq(
        purposeWithDecimals(BigNumber.from(10 ** 6))
      );
      expect(secondSchedule.createdAt).to.be.closeTo(BigNumber.from(now), 1);
      expect(secondSchedule.isAccelerated).to.be.false;   // eslint-disable-line
      expect(secondSchedule.purposePrice).to.eq(20000);
      expect(secondSchedule.vestStartingDate).to.be.closeTo(
        BigNumber.from(now + 86400 * 365),
        1
      );
      expect(secondSchedule.withdrawnBalance).to.eq(0);
      expect(firstSchedule.paidReward).to.eq(0);
    });

    it("should return all vest schedules for contributor 2", async () => {
      const blockNumber = ethers.provider.getBlockNumber();
      const now = (await ethers.provider.getBlock(blockNumber)).timestamp;

      const result = await escrowContract.getVestSchedules(
        contributor2.address
      );
      const { 0: vestSchedules, 1: numSchedules } = result;

      expect(vestSchedules.length).to.eq(1);
      expect(vestSchedules.length).to.eq(numSchedules);

      const firstSchedule = vestSchedules[0];
      expect(firstSchedule.initBalance).to.eq(
        purposeWithDecimals(BigNumber.from(2 * 10 ** 6))
      );
      expect(firstSchedule.createdAt).to.be.closeTo(
        BigNumber.from(now - 86400 * 212),
        1
      );
      expect(firstSchedule.isAccelerated).to.be.true;   // eslint-disable-line
      expect(firstSchedule.purposePrice).to.eq(10000);
      expect(firstSchedule.vestStartingDate).to.be.closeTo(
        BigNumber.from(now - 86400 * 30),
        1
      );
      expect(firstSchedule.withdrawnBalance).to.eq(
        purposeWithDecimals(BigNumber.from(2 * 10 ** 6))
      );
      expect(firstSchedule.paidReward).to.eq(
        purposeWithDecimals(BigNumber.from(123456))
      );
    });

    it("should revert if address is not a contributor", async () => {
      await expect(
        escrowContract.connect(pfpAdmin).getVestSchedules(pfpAdmin.address)
      ).to.be.revertedWith("Escrow: Address not found");
    });
  });

  describe("updateInterestRate", () => {
    it("should emit an InterestRateUpdated event", async () => {
      await expect(escrowContract.connect(pfpAdmin).updateInterestRate(1234567))
        .to.emit(escrowContract, "InterestRateUpdated")
        .withArgs(1234567);
    });

    it("should be able to update with zero amount", async () => {
      await escrowContract.setVariables({
        interestRate: 123,
      });

      const tx = await escrowContract.connect(pfpAdmin).updateInterestRate(0);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should be able to update with new amount", async () => {
      const tx = await escrowContract
        .connect(pfpAdmin)
        .updateInterestRate(11111);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should be able to update with max 100%", async () => {
      const tx = await escrowContract
        .connect(pfpAdmin)
        .updateInterestRate(BigNumber.from("10000000000"));
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should revert if above max", async () => {
      await expect(
        escrowContract
          .connect(pfpAdmin)
          .updateInterestRate(BigNumber.from("10000000001"))
      ).to.be.revertedWith("Escrow: max 100% interest");
    });

    it("should revert if new value equals current value", async () => {
      await escrowContract.setVariables({
        interestRate: 123,
      });

      await expect(
        escrowContract.connect(pfpAdmin).updateInterestRate(123)
      ).to.be.revertedWith("Escrow: new value equals current");
    });

    it("should revert if not called by admin", async () => {
      const adminRole = await escrowContract.ADMIN_ROLE();
      const errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(escrowContract.updateInterestRate(10)).to.be.revertedWith(
        errorMsg
      );
    });
  });
});
