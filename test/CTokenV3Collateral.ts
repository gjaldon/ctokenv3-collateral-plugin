import { expect } from "chai";
import { ethers } from "hardhat";
import { ContractFactory, BigNumber } from 'ethers';

const USDCtoUSDPriceFeed = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
const cUSDCv3 = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";
const ORACLE_TIMEOUT = BigNumber.from('281474976710655').div(2); // type(uint48).max / 2
const DEFAULT_THRESHOLD = BigNumber.from('0.05');
const DELAY_UNTIL_DEFAULT = BigNumber.from('86400');
const targetName = '0x5553440000000000000000000000000000000000000000000000000000000000';
const rTokenMaxTradeVolume = BigNumber.from('1e6');

describe("CTokenV3Collateral", () => {
  let CTokenV3CollateralFactory: ContractFactory

  beforeEach(async () => {
    CTokenV3CollateralFactory = await ethers.getContractFactory('CTokenV3Collateral');
  });

  describe('Constructor validation', () => {
    it('Should validate targetName correctly', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeed,
          cUSDCv3,
          ethers.constants.HashZero,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.constants.HashZero,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('targetName missing')
    })
  });
});
