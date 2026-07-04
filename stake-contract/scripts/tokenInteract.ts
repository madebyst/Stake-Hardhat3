// scripts/tokenInteract.ts
import hre from "hardhat";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;

  const stakeContract = await ethers.getContractAt("MetaNodeStake", "0x62b7C03E5A42fedE09D1b862Cb7936B26fDc5c1e");
  const data = await stakeContract.MetaNode();
  console.log(data);
}

main();
