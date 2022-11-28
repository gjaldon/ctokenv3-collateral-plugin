import { ethers, network } from 'hardhat'
import {
  OracleLib,
  OracleLib__factory,
  CTokenV3Collateral,
  CTokenV3Collateral__factory,
  CusdcV3Wrapper__factory,
  CusdcV3Wrapper,
} from '../typechain-types'
import { networkConfig } from './configuration'

async function main() {
  const [deployer] = await ethers.getSigners()

  console.log(`Starting full deployment on network ${network.name}`)
  console.log(`Deployer account: ${deployer.address}\n`)

  const config = networkConfig[network.name]

  let oracleLib: OracleLib
  if (config.oracleLib === undefined) {
    const OracleLibFactory: OracleLib__factory = await ethers.getContractFactory('OracleLib')
    oracleLib = <OracleLib>await OracleLibFactory.deploy()
    await oracleLib.deployed()
    console.log(`Wrapped oracleLib deployed to ${oracleLib.address}`)
  } else {
    oracleLib = <OracleLib>await ethers.getContractAt('OracleLib', config.oracleLib)
    console.log(`Existing OracleLib at ${oracleLib.address} being used`)
  }

  let wcusdcV3: CusdcV3Wrapper
  if (config.cusdcV3Wrapper === undefined) {
    const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
      await ethers.getContractFactory('CusdcV3Wrapper')
    )
    const { address, rewards, comp } = config.comet
    wcusdcV3 = <CusdcV3Wrapper>await CusdcV3WrapperFactory.deploy(address, rewards, comp)
    await wcusdcV3.deployed()
    console.log(`Wrapped cUSDv3 deployed to ${wcusdcV3.address}`)
  } else {
    wcusdcV3 = <CusdcV3Wrapper>await ethers.getContractAt('CusdcV3Wrapper', config.cusdcV3Wrapper)
    console.log(`Existing Wrapped cUSDv3 at ${wcusdcV3.address} being used`)
  }

  const CTokenV3CollateralFactory: CTokenV3Collateral__factory = await ethers.getContractFactory(
    'CTokenV3Collateral',
    {
      libraries: { OracleLib: oracleLib.address },
    }
  )

  const opts: CTokenV3Collateral.ConfigurationStruct = {
    ...config.collateralOpts,
    erc20: wcusdcV3.address,
  }
  const collateral = <CTokenV3Collateral>await CTokenV3CollateralFactory.deploy(opts)
  console.log(`Deploying CTokenV3Collateral with transaction ${collateral.deployTransaction.hash}`)
  await collateral.deployed()

  console.log(
    `CTokenV3Collateral deployed to ${collateral.address} as collateral to ${wcusdcV3.address}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
