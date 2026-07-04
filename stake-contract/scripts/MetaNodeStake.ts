// scripts/MetaNodeStake.ts
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);

  // 部署获取到的MetaNode Token 地址
  const MetaNodeToken = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  // 质押起始区块高度
  const startBlock = 6529999;
  // 质押结束的区块高度
  const endBlock = 9529999;
  // 每个区块奖励的MetaNode token的数量
  const MetaNodePerBlock = "20000000000000000";
  const Stake = await ethers.getContractFactory("MetaNodeStake");
  console.log("Deploying MetaNodeStake...");
  const s = await upgradesApi.deployProxy(
    Stake,
    [MetaNodeToken, startBlock, endBlock, MetaNodePerBlock],
    { initializer: "initialize", kind: "uups" }
  );
  console.log("Box deployed to:", await s.getAddress());
}

main();
