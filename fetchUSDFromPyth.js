// Simple script to interact with your Pyth contract
// npm install @pythnetwork/price-service-client ethers dotenv

const { PriceServiceConnection } = require("@pythnetwork/price-service-client");
const { ethers } = require("ethers");
const dotenv = require("dotenv");

dotenv.config();

// ============= CONFIGURATION =============
const CONFIG = {
  // Sepolia testnet configuration
  SEPOLIA_RPC_URL:
    process.env.SEPOLIA_RPC_URL ||
    "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
  PRIVATE_KEY: process.env.PRIVATE_KEY, // Your wallet private key
  PYTH_CONTRACT_ADDRESS: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", // Pyth on Sepolia

  // Your deployed contract address (you'll fill this after deploying)
  YOUR_CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x...", // Replace after deployment

  // ETH/USD price feed ID
  ETH_USD_PRICE_ID:
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

// ============= CONTRACT ABI =============
// ABI for your contract (only the functions we need)
const CONTRACT_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "pythContract",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        internalType: "bytes[]",
        name: "priceUpdate",
        type: "bytes[]",
      },
    ],
    name: "fetchUSDPrice",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

// ============= PYTH SETUP =============
const priceService = new PriceServiceConnection("https://hermes.pyth.network");

class SimplePythScript {
  constructor() {
    // Setup wallet and provider
    this.provider = new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC_URL);
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);

    // Setup contract instance
    this.contract = new ethers.Contract(
      CONFIG.YOUR_CONTRACT_ADDRESS,
      CONTRACT_ABI,
      this.wallet
    );

    console.log("🚀 Script initialized!");
    console.log(`📍 Wallet address: ${this.wallet.address}`);
    console.log(`📄 Contract address: ${CONFIG.YOUR_CONTRACT_ADDRESS}`);
  }

  // ============= STEP 1: GET PRICE UPDATE DATA =============
  async getPriceUpdateData() {
    console.log("\n📡 Fetching latest price data from Pyth...");

    try {
      // Get latest price feeds for ETH/USD
      const priceFeeds = await priceService.getLatestPriceFeeds([
        CONFIG.ETH_USD_PRICE_ID,
      ]);

      if (priceFeeds && priceFeeds.length > 0) {
        const price = priceFeeds[0].getPriceUnchecked();
        const readablePrice = Number(price.price) * Math.pow(10, price.expo);

        console.log(`💰 Current ETH/USD price: $${readablePrice.toFixed(2)}`);
        console.log(
          `📅 Last updated: ${new Date(
            price.publishTime * 1000
          ).toLocaleString()}`
        );

        // Try different method names based on SDK version
        let updateData;
        if (typeof priceService.getPriceUpdatesData === "function") {
          updateData = priceService.getPriceUpdatesData(priceFeeds);
        } else if (typeof priceService.getPriceFeedsUpdateData === "function") {
          updateData = priceService.getPriceFeedsUpdateData(priceFeeds);
        } else {
          // Fallback: construct update data manually
          updateData = priceFeeds.map((priceFeed) => priceFeed.serialize());
        }

        console.log("✅ Price update data ready!");
        return updateData;
      } else {
        throw new Error("No price feeds available");
      }
    } catch (error) {
      console.error("❌ Error fetching price data:", error.message);

      // Try alternative approach using Hermes REST API
      console.log("🔄 Trying alternative method using Hermes REST API...");
      return await this.getPriceUpdateDataViaRest();
    }
  }

  // Alternative method using REST API
  async getPriceUpdateDataViaRest() {
    try {
      const response = await fetch(
        `https://hermes.pyth.network/api/latest_price_feeds?ids[]=${CONFIG.ETH_USD_PRICE_ID}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.length > 0) {
        // Display price info
        const priceData = data[0].price;
        const readablePrice =
          Number(priceData.price) * Math.pow(10, priceData.expo);
        console.log(`💰 Current ETH/USD price: $${readablePrice.toFixed(2)}`);
        console.log(
          `📅 Last updated: ${new Date(
            priceData.publish_time * 1000
          ).toLocaleString()}`
        );

        // Get VAA (Verifiable Action Approval) data for contract update
        const vaaResponse = await fetch(
          `https://hermes.pyth.network/api/latest_vaas?ids[]=${CONFIG.ETH_USD_PRICE_ID}`
        );
        if (!vaaResponse.ok) {
          throw new Error(`VAA fetch error! status: ${vaaResponse.status}`);
        }

        const vaaData = await vaaResponse.json();
        console.log("✅ Price update data ready via REST API!");

        return vaaData.map(
          (vaa) => "0x" + Buffer.from(vaa, "base64").toString("hex")
        );
      } else {
        throw new Error("No price data available from REST API");
      }
    } catch (error) {
      console.error("❌ REST API fallback failed:", error.message);
      throw error;
    }
  }

  // ============= STEP 2: CHECK WALLET BALANCE =============
  async checkBalance() {
    console.log("\n💳 Checking wallet balance...");

    const balance = await this.provider.getBalance(this.wallet.address);
    const balanceInETH = ethers.formatEther(balance);

    console.log(`💰 Wallet balance: ${balanceInETH} ETH`);

    if (parseFloat(balanceInETH) < 0.01) {
      console.log(
        "⚠️  Warning: Low balance! You might need more ETH for gas fees."
      );
    }

    return balance;
  }

  // ============= STEP 3: CALL CONTRACT FUNCTION =============
  async callFetchUSDPrice() {
    console.log("\n🔄 Calling contract's fetchUSDPrice...");

    try {
      // Step 1: Get price update data
      const priceUpdateData = await this.getPriceUpdateData();

      // Step 2: Get the Pyth contract to calculate update fee
      const pythContract = new ethers.Contract(
        CONFIG.PYTH_CONTRACT_ADDRESS,
        [
          "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
        ],
        this.provider
      );

      const updateFee = await pythContract.getUpdateFee(priceUpdateData);
      console.log(
        `💸 Update fee required: ${ethers.formatEther(updateFee)} ETH`
      );

      // Step 3: Call your contract method with the update data and fee
      console.log("📤 Sending transaction...");

      const tx = await this.contract.fetchUSDPrice(priceUpdateData, {
        value: updateFee, // Pay the update fee
        gasLimit: 500000, // Set a reasonable gas limit
      });

      console.log(`📋 Transaction hash: ${tx.hash}`);
      console.log("⏳ Waiting for confirmation...");

      // Wait for transaction to be mined
      const receipt = await tx.wait();

      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}!`);
      console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    } catch (error) {
      console.error("❌ Error calling contract method:", error.message);

      // Common error explanations
      if (error.message.includes("insufficient funds")) {
        console.log(
          "💡 Tip: You need more ETH in your wallet for gas fees and Pyth update fees."
        );
      } else if (error.message.includes("execution reverted")) {
        console.log(
          "💡 Tip: The contract call failed. Check if the price data is valid or if you have enough ETH for fees."
        );
      }

      throw error;
    }
  }

  // ============= STEP 4: MONITOR PRICE CHANGES (OPTIONAL) =============
  async monitorPrices(duration = 60000) {
    // Monitor for 1 minute by default
    console.log("\n👀 Starting price monitoring...");
    console.log(`⏰ Will monitor for ${duration / 1000} seconds`);

    let priceCount = 0;
    let lastPrice = 0;

    // Subscribe to price updates (if available)
    if (typeof priceService.subscribePriceFeedUpdates === "function") {
      priceService.subscribePriceFeedUpdates(
        [CONFIG.ETH_USD_PRICE_ID],
        (priceFeed) => {
          const price = priceFeed.getPriceUnchecked();
          const readablePrice = Number(price.price) * Math.pow(10, price.expo);

          priceCount++;
          const change = lastPrice
            ? (((readablePrice - lastPrice) / lastPrice) * 100).toFixed(2)
            : 0;
          const arrow = change > 0 ? "📈" : change < 0 ? "📉" : "➡️";

          console.log(
            `${arrow} ETH/USD: $${readablePrice.toFixed(2)} (${
              change > 0 ? "+" : ""
            }${change}%)`
          );

          lastPrice = readablePrice;
        }
      );
    } else {
      // Fallback: Poll prices manually
      console.log("📊 Using manual price polling...");
      const interval = setInterval(async () => {
        try {
          const priceFeeds = await priceService.getLatestPriceFeeds([
            CONFIG.ETH_USD_PRICE_ID,
          ]);

          if (priceFeeds && priceFeeds.length > 0) {
            const price = priceFeeds[0].getPriceUnchecked();
            const readablePrice =
              Number(price.price) * Math.pow(10, price.expo);

            priceCount++;
            const change = lastPrice
              ? (((readablePrice - lastPrice) / lastPrice) * 100).toFixed(2)
              : 0;
            const arrow = change > 0 ? "📈" : change < 0 ? "📉" : "➡️";

            console.log(
              `${arrow} ETH/USD: $${readablePrice.toFixed(2)} (${
                change > 0 ? "+" : ""
              }${change}%)`
            );

            lastPrice = readablePrice;
          }
        } catch (error) {
          console.log("⚠️ Error fetching price:", error.message);
        }
      }, 5000); // Poll every 5 seconds

      setTimeout(() => {
        clearInterval(interval);
      }, duration);
    }

    // Stop monitoring after specified duration
    setTimeout(() => {
      console.log(
        `\n🛑 Monitoring stopped. Received ${priceCount} price updates.`
      );
    }, duration);
  }
}

// ============= MAIN EXECUTION =============
async function main() {
  console.log("🎯 Simple Pyth Contract Interaction Script");
  console.log("==========================================");

  // Validate configuration
  if (!CONFIG.PRIVATE_KEY) {
    console.error(
      "❌ Error: Please set your PRIVATE_KEY in .env file or environment variable"
    );
    process.exit(1);
  }

  if (CONFIG.YOUR_CONTRACT_ADDRESS === "0x...") {
    console.error("❌ Error: Please set your deployed CONTRACT_ADDRESS");
    process.exit(1);
  }

  try {
    // Initialize script
    const script = new SimplePythScript();

    // Check wallet balance
    await script.checkBalance();

    // Call the contract method
    await script.callFetchUSDPrice();

    // Optional: Monitor prices for a bit
    console.log(
      "\n❓ Would you like to monitor price updates? (Starting for 30 seconds...)"
    );
    await script.monitorPrices(30000); // Monitor for 30 seconds

    console.log("\n🎉 Script completed successfully!");
  } catch (error) {
    console.error("\n💥 Script failed:", error.message);
    process.exit(1);
  }
}

// ============= HELPER FUNCTIONS =============

// Function to deploy your contract (run this first)
async function deployContract() {
  console.log("🚀 Deploying your contract...");

  const provider = new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

  // Your contract bytecode and ABI would go here
  // This is just a placeholder - you'll need to compile your contract first

  console.log("💡 To deploy your contract:");
  console.log("1. Compile your Solidity contract using Hardhat/Foundry");
  console.log(
    "2. Deploy it with the Pyth contract address:",
    CONFIG.PYTH_CONTRACT_ADDRESS
  );
  console.log("3. Update CONTRACT_ADDRESS in this script");
}

// Run the appropriate function based on command line argument
const command = process.argv[2];

if (command === "deploy") {
  deployContract();
} else {
  main();
}

// ============= USAGE INSTRUCTIONS =============
/*
SETUP:
1. Create .env file:
   SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
   PRIVATE_KEY=your_wallet_private_key_here
   CONTRACT_ADDRESS=your_deployed_contract_address

2. Install dependencies:
   npm install @pythnetwork/price-service-client ethers dotenv

3. Deploy your contract first:
   node script.js deploy

4. Update CONTRACT_ADDRESS in .env

5. Run the script:
   node script.js

The script will:
- Fetch the latest ETH/USD price from Pyth
- Calculate the required update fee
- Call your contract's fetchUSDPrice with the price data
- Monitor price changes for 30 seconds

TROUBLESHOOTING:
- If you get "getPriceFeedsUpdateData is not a function", try updating the SDK:
  npm update @pythnetwork/price-service-client
- The script includes fallback methods for different SDK versions
*/
