// hardhat.config.ts
import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatUpgrades from "@openzeppelin/hardhat-upgrades";
import "dotenv/config";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";

if (!SEPOLIA_RPC_URL) {
  console.warn("SEPOLIA_RPC_URL 未设置，Sepolia 网络不可用");
}

export default defineConfig({
  plugins: [
    hardhatToolboxMochaEthers,
    hardhatUpgrades,
  ],

  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: false,
        runs: 200,
      },
    },
  },

  networks: {
    sepolia: {
      type: "http",
      chainType: "l1",
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: 30_000_000_000, // 30 Gwei
    },
  },

  verify: {
    etherscan: {
      apiKey: ETHERSCAN_API_KEY,
    },
  },
});
