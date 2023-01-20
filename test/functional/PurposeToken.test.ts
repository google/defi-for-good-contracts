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
  PurposeToken,
  PurposeToken__factory,
  TestPFPConfig,
} from "../../build/types";
import { ZERO_ADDRESS } from "../test-helpers/constants";
import { FakeContract, smock } from "@defi-wonderland/smock";

use(smock.matchers);

describe("PurposeToken", function () {
  let purposeToken: PurposeToken;
  let fakeTestPFPConfig: FakeContract<TestPFPConfig>;
  let owner: SignerWithAddress;
  let roleManager: SignerWithAddress;
  let genesisEscrowAccount: SignerWithAddress;
  let pfpContract: SignerWithAddress;
  let contributor: SignerWithAddress;

  beforeEach(async () => {
    [owner, roleManager, genesisEscrowAccount, pfpContract, contributor] =
      await ethers.getSigners();

    fakeTestPFPConfig = await smock.fake<TestPFPConfig>("TestPFPConfig");
    fakeTestPFPConfig.roleManager.returns(roleManager.address);

    const purposeTokenFactory = (await ethers.getContractFactory(
      "PurposeToken",
      owner
    )) as PurposeToken__factory;

    // unit tests for zero parameter check
    await expect(purposeTokenFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith(
      "PurposeToken: zero address"
    );

    purposeToken = await purposeTokenFactory.deploy(fakeTestPFPConfig.address);
    await purposeToken.deployed();
    await purposeToken
      .connect(roleManager)
      .grantRole(await purposeToken.MINTER_ROLE(), pfpContract.address);
    await purposeToken
      .connect(roleManager)
      .grantRole(await purposeToken.BURNER_ROLE(), pfpContract.address);
  });

  describe("deploy", () => {
    it("should set name and symbol", async () => {
      expect(await purposeToken.name()).to.eq("PURPOSE Token");
      expect(await purposeToken.symbol()).to.eq("PURPOSE");
    });

    it("should set decimals", async () => {
      expect(await purposeToken.decimals()).to.eq(18);
    });

    it("should not create an initial supply", async () => {
      expect(await purposeToken.totalSupply()).to.equal(0);
      expect(await purposeToken.balanceOf(owner.address)).to.equal(0);
      expect(
        await purposeToken.balanceOf(genesisEscrowAccount.address)
      ).to.equal(0);
    });

    it("should set config roleManager as Admin Role", async () => {
      expect(
        await purposeToken.hasRole(
          await purposeToken.DEFAULT_ADMIN_ROLE(),
          roleManager.address
        )
      ).to.eq(true);
    });
  });

  describe("mintPurpose", () => {
    const amount = BigNumber.from(10000000);

    describe("when we mint a positive amount", () => {
      it("should emit a Transfer event", async () => {
        await expect(
          purposeToken
            .connect(pfpContract)
            .mintPurpose(genesisEscrowAccount.address, amount)
        )
          .to.emit(purposeToken, "Transfer")
          .withArgs(ZERO_ADDRESS, genesisEscrowAccount.address, amount);
      });

      it("should emit a MintPurpose event", async () => {
        await expect(
          purposeToken
            .connect(pfpContract)
            .mintPurpose(genesisEscrowAccount.address, amount)
        )
          .to.emit(purposeToken, "MintPurpose")
          .withArgs(genesisEscrowAccount.address, amount);
      });

      it("should increase total supply and escrow balance", async () => {
        await purposeToken
          .connect(pfpContract)
          .mintPurpose(genesisEscrowAccount.address, amount);
        expect(await purposeToken.totalSupply()).to.equal(amount);
        expect(
          await purposeToken.balanceOf(genesisEscrowAccount.address)
        ).to.equal(amount);
      });
    });

    describe("when we mint a zero amount", () => {
      it("should emit a Transfer event", async () => {
        await expect(
          purposeToken
            .connect(pfpContract)
            .mintPurpose(genesisEscrowAccount.address, 0)
        )
          .to.emit(purposeToken, "Transfer")
          .withArgs(ZERO_ADDRESS, genesisEscrowAccount.address, 0);
      });

      it("should not increase total supply and escrow balance", async () => {
        await purposeToken
          .connect(pfpContract)
          .mintPurpose(genesisEscrowAccount.address, 0);
        expect(await purposeToken.totalSupply()).to.equal(0);
        expect(
          await purposeToken.balanceOf(genesisEscrowAccount.address)
        ).to.equal(0);
      });
    });

    describe("when we mint a negative amount", () => {
      it("should reject the mint request", async () => {
        await expect(
          purposeToken
            .connect(pfpContract)
            .mintPurpose(genesisEscrowAccount.address, -1)
        ).to.be.reverted;
      });
    });

    it("should revert if caller not in MINTER_ROLE", async () => {
      const minterRole = await purposeToken.MINTER_ROLE();
      let errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${minterRole}`;
      await expect(
        purposeToken.mintPurpose(genesisEscrowAccount.address, amount)
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${contributor.address.toLocaleLowerCase()} is missing role ${minterRole}`;
      await expect(
        purposeToken
          .connect(contributor)
          .mintPurpose(genesisEscrowAccount.address, amount)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe("burnPurpose", () => {
    const purposeBalance = BigNumber.from(10 * 10 ** 6);
    const amount = BigNumber.from(10000);

    beforeEach(async () => {
      // todo: how do we set internal balance without calling mintPurpose?
      await purposeToken
        .connect(pfpContract)
        .mintPurpose(contributor.address, purposeBalance);
    });

    describe("when we burn a positive amount", () => {
      it("should emit a Transfer event", async () => {
        await expect(
          purposeToken
            .connect(pfpContract)
            .burnPurpose(contributor.address, amount)
        )
          .to.emit(purposeToken, "Transfer")
          .withArgs(contributor.address, ZERO_ADDRESS, amount);
      });

      it("should emit a BurnPurpose event", async () => {
        await expect(
          purposeToken
            .connect(pfpContract)
            .burnPurpose(contributor.address, amount)
        )
          .to.emit(purposeToken, "BurnPurpose")
          .withArgs(contributor.address, amount);
      });

      it("should decrease total supply and contributor balance", async () => {
        const prev_supply = BigNumber.from(await purposeToken.totalSupply());

        await purposeToken
          .connect(pfpContract)
          .burnPurpose(contributor.address, amount);

        const new_supply = BigNumber.from(await purposeToken.totalSupply());
        assert.isTrue(new_supply.lte(prev_supply));

        expect(await purposeToken.balanceOf(contributor.address)).to.equal(
          prev_supply.sub(amount)
        );
      });
    });

    describe("when we burn a zero amount", () => {
      it("should emit a Transfer event", async () => {
        await expect(
          purposeToken.connect(pfpContract).burnPurpose(contributor.address, 0)
        )
          .to.emit(purposeToken, "Transfer")
          .withArgs(contributor.address, ZERO_ADDRESS, 0);
      });

      it("should not increase total supply and escrow balance", async () => {
        await purposeToken
          .connect(pfpContract)
          .burnPurpose(contributor.address, 0);
        expect(await purposeToken.totalSupply()).to.equal(purposeBalance);
        expect(await purposeToken.balanceOf(contributor.address)).to.equal(
          purposeBalance
        );
      });
    });

    describe("when we burn a negative amount", () => {
      it("should reject the burn request", async () => {
        await expect(
          purposeToken.connect(pfpContract).burnPurpose(contributor.address, -1)
        ).to.be.reverted;
      });
    });

    it("should revert if caller not in BURNER_ROLE", async () => {
      const burnerRole = await purposeToken.BURNER_ROLE();
      let errorMsg = `AccessControl: account ${owner.address.toLocaleLowerCase()} is missing role ${burnerRole}`;
      await expect(
        purposeToken.burnPurpose(genesisEscrowAccount.address, amount)
      ).to.be.revertedWith(errorMsg);

      errorMsg = `AccessControl: account ${contributor.address.toLocaleLowerCase()} is missing role ${burnerRole}`;
      await expect(
        purposeToken
          .connect(contributor)
          .burnPurpose(genesisEscrowAccount.address, amount)
      ).to.be.revertedWith(errorMsg);
    });

    it("should revert if not enough Purpose", async () => {
      await expect(
        purposeToken
          .connect(pfpContract)
          .burnPurpose(contributor.address, purposeBalance.add(111))
      ).to.be.revertedWith("");
    });
  });
});
