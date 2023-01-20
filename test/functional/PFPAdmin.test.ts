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
import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  PFPAdmin,
  PFPAdmin__factory,
  TestPFPConfig,
  MockERC20,
  MockERC20__factory,
} from "../../build/types";
import { ZERO_ADDRESS } from "../test-helpers/constants";
import { smock, MockContract, FakeContract } from "@defi-wonderland/smock";
import { BigNumber } from "ethers";

describe("PFPAdmin", function () {
  let pfpAdminContract: MockContract<PFPAdmin>;
  let mockUSDCToken: MockContract<MockERC20>;
  let mockDAIToken: MockContract<MockERC20>;
  let fakeTestPFPConfig: FakeContract<TestPFPConfig>;
  let owner: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let roleManager: SignerWithAddress;
  let pauser: SignerWithAddress;

  beforeEach(async () => {
    [owner, notAdmin, roleManager, pauser] = await ethers.getSigners();

    // setup mocks and fakes
    const mockUSDCTokenfactory = await smock.mock<MockERC20__factory>(
      "MockERC20"
    );
    mockUSDCToken = await mockUSDCTokenfactory.deploy(
      "USDC Token",
      "USDC",
      BigNumber.from(1000000000),
      6
    );
    await mockUSDCToken.deployed();

    const mockDAITokenfactory = await smock.mock<MockERC20__factory>(
      "MockERC20"
    );
    mockDAIToken = await mockDAITokenfactory.deploy(
      "DAI Token",
      "DAI",
      BigNumber.from(1000000000000000),
      18
    );
    await mockDAIToken.deployed();

    fakeTestPFPConfig = await smock.fake<TestPFPConfig>("TestPFPConfig");
    fakeTestPFPConfig.roleManager.returns(roleManager.address);

    const pfpAdminFactory = await smock.mock<PFPAdmin__factory>(
      "PFPAdmin",
      owner
    );

    // unit tests for zero parameter check
    await expect(pfpAdminFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith(
      "PFPAdmin: zero address"
    );

    pfpAdminContract = await pfpAdminFactory.deploy(fakeTestPFPConfig.address);
    await pfpAdminContract.deployed();

    await pfpAdminContract
      .connect(roleManager)
      .grantRole(await pfpAdminContract.ADMIN_ROLE(), owner.address);
    await pfpAdminContract
      .connect(roleManager)
      .grantRole(await pfpAdminContract.BREAK_GLASS_ROLE(), pauser.address);
  });

  describe("deploy", () => {
    it("should set config roleManager as Admin Role", async () => {
      expect(
        await pfpAdminContract.hasRole(
          await pfpAdminContract.DEFAULT_ADMIN_ROLE(),
          roleManager.address
        )
      ).to.eq(true);
    });
  });

  describe("addCoinAddr", () => {
    it("should emit an AllowedCoinAdded event", async () => {
      await expect(pfpAdminContract.addCoinAddr(mockUSDCToken.address))
        .to.emit(pfpAdminContract, "AllowedCoinAdded")
        .withArgs(mockUSDCToken.address);
    });

    it("should be able to add 2 coin addresses", async () => {
      let tx = await pfpAdminContract.addCoinAddr(mockUSDCToken.address);
      let receipt = await tx.wait();
      assert.equal(receipt.status, 1);

      tx = await pfpAdminContract.addCoinAddr(mockDAIToken.address);
      receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should revert if not called by admin", async () => {
      const adminRole = await pfpAdminContract.ADMIN_ROLE();
      const errorMsg = `AccessControl: account ${notAdmin.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        pfpAdminContract.connect(notAdmin).addCoinAddr(mockUSDCToken.address)
      ).to.be.revertedWith(errorMsg);
    });

    it("should revert if adding zero address", async () => {
      await expect(
        pfpAdminContract.addCoinAddr(ZERO_ADDRESS)
      ).to.be.revertedWith("PFPAdmin: zero address");
    });

    it("should revert if adding duplicate address", async () => {
      await pfpAdminContract.addCoinAddr(mockUSDCToken.address);
      await expect(
        pfpAdminContract.addCoinAddr(mockUSDCToken.address)
      ).to.be.revertedWith("PFPAdmin: coin addr registered");
    });

    it("should revert if adding improper address", async () => {
      await expect(pfpAdminContract.addCoinAddr("0x012345")).to.be.reverted;
    });
  });

  describe("removeCoinAddr", () => {
    beforeEach(async () => {
      await pfpAdminContract.setVariables({
        allowedCoinList: {
          [mockUSDCToken.address]: true,
        },
      });
    });

    it("should emit an AllowedCoinRemoved event", async () => {
      await expect(pfpAdminContract.removeCoinAddr(mockUSDCToken.address))
        .to.emit(pfpAdminContract, "AllowedCoinRemoved")
        .withArgs(mockUSDCToken.address);
    });

    it("should revert if not called by admin", async () => {
      const adminRole = await pfpAdminContract.ADMIN_ROLE();
      const errorMsg = `AccessControl: account ${notAdmin.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        pfpAdminContract.connect(notAdmin).removeCoinAddr(mockUSDCToken.address)
      ).to.be.revertedWith(errorMsg);
    });

    it("should revert if removing invalid address", async () => {
      const daiAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
      await expect(
        pfpAdminContract.removeCoinAddr(daiAddress)
      ).to.be.revertedWith("PFPAdmin: invalid coin");
    });

    it("should revert if adding improper address", async () => {
      await expect(pfpAdminContract.removeCoinAddr("0x012345")).to.be.reverted;
    });
  });

  describe("updateMinimumDeposit", () => {
    it("should emit an MinimumDepositUpdated event", async () => {
      await expect(pfpAdminContract.updateMinimumDeposit(1111))
        .to.emit(pfpAdminContract, "MinimumDepositUpdated")
        .withArgs(1111);
    });

    it("should be able to update with zero amount", async () => {
      const tx = await pfpAdminContract.updateMinimumDeposit(0);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should be able to update with new amount", async () => {
      const tx = await pfpAdminContract.updateMinimumDeposit(11111);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should revert if new value equals current value", async () => {
      await pfpAdminContract.setVariables({
        minimumDepositInUsdNoDecimals: 123,
      });

      await expect(
        pfpAdminContract.updateMinimumDeposit(123)
      ).to.be.revertedWith("PFPAdmin: value equals current");
    });

    it("should revert if not called by admin", async () => {
      const adminRole = await pfpAdminContract.ADMIN_ROLE();
      const errorMsg = `AccessControl: account ${notAdmin.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        pfpAdminContract.connect(notAdmin).updateMinimumDeposit(999)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe("updateAcceleratedVestAllowed", () => {
    it("should emit an AcceleratedVestAllowedUpdated event", async () => {
      await expect(pfpAdminContract.updateAcceleratedVestAllowed(true))
        .to.emit(pfpAdminContract, "AcceleratedVestAllowedUpdated")
        .withArgs(true);
    });

    it("should be able to update with new value", async () => {
      const tx = await pfpAdminContract.updateAcceleratedVestAllowed(true);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should revert if new value equals current value", async () => {
      await pfpAdminContract.setVariables({
        acceleratedVestAllowed: true,
      });

      await expect(
        pfpAdminContract.updateAcceleratedVestAllowed(true)
      ).to.be.revertedWith("PFPAdmin: value equals current");
    });

    it("should revert if not called by admin", async () => {
      const adminRole = await pfpAdminContract.ADMIN_ROLE();
      const errorMsg = `AccessControl: account ${notAdmin.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        pfpAdminContract.connect(notAdmin).updateAcceleratedVestAllowed(true)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe("pauseProtocol", () => {
    it("should emit a Paused event", async () => {
      await expect(pfpAdminContract.connect(pauser).pauseProtocol()).to.emit(
        pfpAdminContract,
        "Paused"
      );
    });

    it("should be callable", async () => {
      const tx = await pfpAdminContract.connect(pauser).pauseProtocol();
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should revert if already paused", async () => {
      await pfpAdminContract.connect(pauser).pauseProtocol();
      await expect(
        pfpAdminContract.connect(pauser).pauseProtocol()
      ).to.be.revertedWith("Pausable: paused");
    });

    it("should revert if not called by pauser", async () => {
      const breakGlassRole = await pfpAdminContract.BREAK_GLASS_ROLE();
      let errorMsg = `AccessControl: account ${notAdmin.address.toLocaleLowerCase()} is missing role ${breakGlassRole}`;
      await expect(
        pfpAdminContract.connect(notAdmin).pauseProtocol()
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${breakGlassRole}`;
      await expect(pfpAdminContract.pauseProtocol()).to.be.revertedWith(
        errorMsg
      );
    });
  });

  describe("unpauseProtocol", () => {
    beforeEach(async () => {
      await pfpAdminContract.setVariables({
        _paused: true,
      });
    });

    it("should emit an Unpaused event", async () => {
      await expect(pfpAdminContract.unpauseProtocol()).to.emit(
        pfpAdminContract,
        "Unpaused"
      );
    });

    it("should be callable", async () => {
      const tx = await pfpAdminContract.unpauseProtocol();
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);
    });

    it("should revert if already unpaused", async () => {
      await pfpAdminContract.unpauseProtocol();
      await expect(pfpAdminContract.unpauseProtocol()).to.be.revertedWith(
        "Pausable: not paused"
      );
    });

    it("should revert if not called by admin", async () => {
      const adminRole = await pfpAdminContract.ADMIN_ROLE();
      let errorMsg = `AccessControl: account ${notAdmin.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        pfpAdminContract.connect(notAdmin).unpauseProtocol()
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${pauser.address.toLocaleLowerCase()} is missing role ${adminRole}`;
      await expect(
        pfpAdminContract.connect(pauser).unpauseProtocol()
      ).to.be.revertedWith(errorMsg);
    });
  });
});
