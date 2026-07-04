// scripts/deploy.ts
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);

  const [signer] = await ethers.getSigners();

  const MetaNodeToken = await ethers.getContractFactory("MetaNodeToken");
  const metaNodeToken = await MetaNodeToken.deploy();
  await metaNodeToken.waitForDeployment();
  const metaNodeTokenAddress = await metaNodeToken.getAddress();

  // 1. 获取合约工厂
  const MetaNodeStake = await ethers.getContractFactory("MetaNodeStake");

  // 2. 设置初始化参数
  const provider = ethers.provider;
  const currentBlock = await provider.getBlockNumber();
  const startBlock = currentBlock;
  const endBlock = currentBlock + 999999999;
  const metaNodePerBlock = ethers.parseUnits("1", 18); // 每区块奖励1个MetaNode

  // 3. 部署可升级代理合约
  const stake = await upgradesApi.deployProxy(
    MetaNodeStake,
    [metaNodeTokenAddress, startBlock, endBlock, metaNodePerBlock],
    { initializer: "initialize", kind: "uups" }
  );

  await stake.waitForDeployment();

  const stakeAddress = await stake.getAddress();

  // 获取实现合约地址（ERC1967 标准）
  const implAddress = await upgradesApi.erc1967.getImplementationAddress(stakeAddress);
  console.log("MetaNodeToken deployed to:", metaNodeTokenAddress);
  console.log("MetaNodeStake (proxy) deployed to:", stakeAddress);
  console.log("MetaNodeStake (implementation) deployed to:", implAddress);

  // 将 MetaNode 代币转入质押合约
  const tokenAmount = await metaNodeToken.balanceOf(signer.address);
  let tx = await metaNodeToken.connect(signer).transfer(stakeAddress, tokenAmount);
  await tx.wait();
  console.log("Transferred", ethers.formatUnits(tokenAmount, 18), "MetaNode tokens to stake contract");

  // 验证命令（手动执行）
  console.log("\n========== 手动验证合约 ==========");
  console.log("# 验证 MetaNodeToken:");
  console.log(`npx hardhat verify --network sepolia ${metaNodeTokenAddress}`);
  console.log("\n# 验证 MetaNodeStake 实现合约:");
  console.log(`npx hardhat verify --network sepolia ${implAddress}`);
  console.log("==================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
