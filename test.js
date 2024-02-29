const express = require("express");
const mongoose = require("mongoose");
const transactions = require("./routes/transactions");
const cors = require("cors");
const cors_options = require("./config/cors_options");
const app = express();
const decryptEnv = require("./utils/decryptEnv");

const MONGO_URL = process.env.MONGO_URL;

const mongoUrl = decryptEnv(MONGO_URL);
// const mongoUrl = decryptEnv(
//   "U2FsdGVkX18ce+k4gpWbvcCt+GsXpMQBjdunUS3QHmm9B8Ym5iKc8EGvDIUGymW16x4BwmXks2xy0Cu+uxtu0bTReJ+QwwWyMzyx2lWIfZ1vxEyYK4jpnlzFPvJ2dl3hzCShzTNtwD/TiJdZBSsI/uU8fnIPuA70xPExesNunFg="
// );

app.use(
  express.json({
    extended: true,
    verify: (req, res, buf) => {
      const url = req.originalUrl;
      if (url.startsWith("/api/transactions/coinbase_webhooks")) {
        req.rawBody = buf.toString();
      }
    },
  })
);
require("dotenv").config();

app.use(cors(cors_options));
app.use("/api/transactions", transactions);

// setInterval(async () => {
//   const exchangeId = "6535a9fb67ab1715a7dce9c9";
//   let { data } = await axios.post(process.env.PAYMENT_API + "/v1/getExchangeInfo", {
//     exchangeId: exchangeId,
//   });

//   let ratesObj = await rates.findOne();

//   let receiveAmount = data?.exchange?.receiveAmount ?? data?.exchange?.sentAmount;

//   if (data.exchange?.status === "success") {
//     let receivedTokenAddress = data?.exchange?.tokenAddress;
//     let receivedrpc = data?.exchange?.rpc;
//     let receivedrpc1 = data?.exchange?.rpc1;
//     let receivedisNative = data?.exchange?.isNative;

//     try {
//       const contract = new web3.eth.Contract(minABI, tokenAddress);
//       let binance_rpcs_testnet = ["https://data-seed-prebsc-1-s1.binance.org:8545"];
//       let binance_rpcs = [
//         "https://bsc-dataseed.binance.org",
//         "https://binance.nodereal.io",
//       ];
//       let eth_rpcs = ["https://eth.meowrpc.com"];
//       let chain;

//       if (eth_rpcs.includes(receivedrpc) || eth_rpcs.includes(receivedrpc1)) {
//         chain = "eth";
//       } else if (binance_rpcs.includes(receivedrpc) || binance_rpcs.includes(receivedrpc1)) {
//         chain = "bsc";
//       } else {
//         chain = "bsc-test";
//       }

//       if (!chain) {
//         return;
//       }

//       let receivedTotal = 0;
//       if (receivedisNative) {
//         if (chain == "bsc") {
//           receivedTotal = ratesObj.bnb.usd * receiveAmount;
//         } else if (chain == "eth") {
//           receivedTotal = ratesObj.eth.usd * receiveAmount;
//         } else {
//           receivedTotal = ratesObj.bnb.usd * receiveAmount;
//         }
//       } else {
//         if (chain == "eth") {
//           if (receivedTokenAddress == "0xdAC17F958D2ee523a2206206994597C13D831ec7") {
//             receivedTotal = ratesObj.usdt.usd * receiveAmount;
//           }
//           if (receivedTokenAddress == "0xB8c77482e45F1F44dE1745F52C74426C631bDD52") {
//             receivedTotal = ratesObj.bnb.usd * receiveAmount;
//           }
//         }
//       }

//       let finalTokenCount = (receivedTotal - 1) / ratesObj.atr.usd;
//       const tokenAmountInWei = web3.utils.toWei(finalTokenCount?.toString(), "ether");
//       const transfer = contract.methods.transfer("0x677dD459bEF0F585ffB17734e8f1968ff4805a39", tokenAmountInWei);
//       const encodedABI = transfer.encodeABI();

//       let txStats = {
//         from: treasuryAddress,
//         to: tokenAddress,
//         data: encodedABI,
//         value: 0
//       };

//       const gasPrice = Number(await web3.eth.getGasPrice());
//       const gasLimit = await web3.eth.estimateGas(txStats);

//       txStats.gas = gasLimit;
//       txStats.gasPrice = gasPrice;

//       console.log(txStats)

//       web3.eth.accounts.signTransaction(
//         txStats,
//         process.env.TOKEN_HOLDER_TREASURY_PRIVATE_KEY,
//         (err, signed) => {
//           if (err) {
//             console.log(err);
//           } else {
//             console.log(signed);
//             web3.eth
//               .sendSignedTransaction(signed.rawTransaction)
//               .on("error", console.log);
//           }
//         },
//       );
//     } catch (e) {

//     }
//   }
// }, 5000);

// console.log(accounts.index("jinx1"));
// app.use('/accounts', router)

// const auth = require('./modules/auth/routes/index.routes');
// const staking = require('./modules/staking/routes/index.routes');

//load modules depend env file
// if(process.env.AUTH === 'true') app.use('/api/auth', auth);
// if(process.env.STAKING === 'true') app.use('/api/staking', staking);

// //test route
app.get("/test", (req, res) => {
  console.log("eyeaa");

  res.send("server is working");
});

//static path
const root = require("path").join(__dirname, "front", "build");
app.use(express.static(root));

// app.get("*", function (req, res) {
//    res.sendFile(
//       'index.html', { root }
//    );
// });

async function start() {
  const PORT = process.env.PORT || 5000;
  try {
    mongoose.set("strictQuery", false);

    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    app.listen(PORT, () =>
      console.log(`App has been started on port ${PORT}...`)
    );
  } catch (e) {
    console.log(`Server Error ${e.message}`);
    process.exit(1);
  }
}

start();
