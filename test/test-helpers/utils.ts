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
import { BigNumber, utils } from "ethers";
import {
  USDC_TOKEN_DECIMALS,
  DAI_TOKEN_DECIMALS,
  PURPOSE_TOKEN_DECIMALS,
} from "./constants";

export function ethToWei(eth: number): BigNumber {
  return BigNumber.from(utils.parseEther(eth.toString()));
}

/* eslint-disable no-redeclare */
export function usdToUSDC(usd: number): BigNumber;
export function usdToUSDC(usd: BigNumber): BigNumber;
export function usdToUSDC(usd: number | BigNumber): BigNumber {
  if (typeof usd === "number") {
    return BigNumber.from(usd * 10 ** USDC_TOKEN_DECIMALS);
  } else {
    return usd.mul(BigNumber.from(10).pow(USDC_TOKEN_DECIMALS));
  }
}

export function usdToDAI(usd: number): BigNumber;
export function usdToDAI(usd: BigNumber): BigNumber;
export function usdToDAI(usd: number | BigNumber): BigNumber {
  if (typeof usd === "number") {
    return BigNumber.from(usd * 10 ** DAI_TOKEN_DECIMALS);
  } else {
    return usd.mul(BigNumber.from(10).pow(DAI_TOKEN_DECIMALS));
  }
}

export function purposeWithDecimals(wholePurpose: number): BigNumber;
export function purposeWithDecimals(wholePurpose: BigNumber): BigNumber;
export function purposeWithDecimals(
  wholePurpose: number | BigNumber
): BigNumber {
  if (typeof wholePurpose === "number") {
    return BigNumber.from(wholePurpose * 10 ** PURPOSE_TOKEN_DECIMALS);
  } else {
    return wholePurpose.mul(BigNumber.from(10).pow(PURPOSE_TOKEN_DECIMALS));
  }
}
/* eslint-enable no-redeclare */

export function monthsLater(date: Date, monthsToAdd: number) {
  const newDate = new Date(date.getTime());
  newDate.setMonth(newDate.getMonth() + monthsToAdd);
  return newDate;
}
