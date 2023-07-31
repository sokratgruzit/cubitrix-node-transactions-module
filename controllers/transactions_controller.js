const main_helper = require("../helpers/index");
const global_helper = require("../helpers/global_helper");
const {
  transaction_types,
  transactions,
  accounts,
  referral_links,
  referral_uni_users,
  referral_binary_users,
  deposit_requests,
  options,
  stakes,
} = require("@cubitrix/models");
const moment = require("moment");
const _ = require("lodash");

require("dotenv").config();

var Webhook = require("coinbase-commerce-node").Webhook;

const axios = require("axios");

const Web3 = require("web3");
const web3 = new Web3("https://data-seed-prebsc-1-s1.binance.org:8545/");

const minABI = require("../abi/WBNB.json");
const STACK_ABI = require("../abi/stack.json");
const { decode } = require("jsonwebtoken");

const account1 = "0xA3403975861B601aE111b4eeAFbA94060a58d0CA";
var tokenAddress = "0xE807fbeB6A088a7aF862A2dCbA1d64fE0d9820Cb"; // Staking Token Address

// Get Transactions Of user
async function get_transactions_of_user(req, res) {
  try {
    const req_body = await req.body;
    const req_page = req_body.page ? req_body.page : 1;
    const limit = req_body.limit ? req_body.limit : 10;
    const account_type = req_body?.account ? req_body?.account : "all";
    const method_type = req_body?.type ? req_body?.type : "all";
    const date_type = req_body?.time ? req_body?.time : "all";
    let address = req_body?.address;
    if (!address) {
      return res.status(500).send({ success: false, message: "address not provided" });
    }

    address = address.toLowerCase();

    const mainAccount = await accounts.findOne({
      account_owner: address,
      account_category: "main",
    });

    if (!mainAccount) {
      return res.status(400).json(main_helper.error_message("main account not found"));
    }

    let addr_arr = [address, mainAccount.address];

    const pipeline = [
      {
        $facet: {
          toCount: [
            {
              $match: {
                to: { $in: addr_arr },
                tx_type: { $in: ["transfer", "deposit", "bonus", "internal_transfer"] },
              },
            },
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
          fromSum: [
            {
              $match: {
                from: { $in: addr_arr },
                tx_type: { $in: ["transfer", "internal_transfer"] },
              },
            },
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
      {
        $project: {
          toCount: { $arrayElemAt: ["$toCount.count", 0] },
          toSum: { $arrayElemAt: ["$toCount.totalAmount", 0] },
          fromCount: { $arrayElemAt: ["$fromSum.count", 0] },
          fromSum: { $arrayElemAt: ["$fromSum.totalAmount", 0] },
        },
      },
    ];

    let amounts_to_from = await transactions.aggregate(pipeline);

    let tx_type_to_check = null;
    let data = {
      $or: [
        {
          to: {
            $in: addr_arr,
          },
        },
        {
          from: {
            $in: addr_arr,
          },
        },
      ],
    };

    if (account_type !== "all") {
      data.$or = [
        {
          to: {
            $in: addr_arr,
          },
          tx_options: { $exists: true }, // Check if tx_options field exists
          $or: [
            { "tx_options.account_category_to": account_type },
            { "tx_options.account_category_from": account_type },
          ],
        },
        {
          from: {
            $in: addr_arr,
          },
          tx_options: { $exists: true }, // Check if tx_options field exists
          $or: [
            { "tx_options.account_category_to": account_type },
            { "tx_options.account_category_from": account_type },
          ],
        },
      ];
    }

    if (method_type != "all" && method_type != null) {
      if (method_type == "bonus") {
        let referral_types = [
          "referral_bonus_uni_level",
          "referral_bonus_binary_level_1",
          "referral_bonus_binary_level_2",
          "referral_bonus_binary_level_3",
          "referral_bonus_binary_level_4",
          "referral_bonus_binary_level_5",
          "referral_bonus_binary_level_6",
          "referral_bonus_binary_level_7",
          "referral_bonus_binary_level_8",
          "referral_bonus_binary_level_9",
          "referral_bonus_binary_level_10",
          "referral_bonus_binary_level_11",
        ];
        data.tx_type = { $in: referral_types };
      } else {
        data.tx_type = method_type;
      }
    }
    if (date_type != "all" && date_type != null) {
      const targetDate = new Date(date_type);
      targetDate.setUTCHours(0, 0, 0, 0); // Set time to the beginning of the target date

      const nextDay = new Date(targetDate);
      nextDay.setDate(targetDate.getDate() + 1); // Set next day's date

      data.createdAt = {
        $gte: targetDate,
        $lt: nextDay,
      };
    }
    result = await transactions
      .find(data)
      .sort({ createdAt: "desc" })
      .limit(limit)
      .skip(limit * (req_page - 1));
    total_pages = await transactions.count(data);
    return res.status(200).send({
      transactions: result,
      total_pages: Math.ceil(total_pages / limit),
      total_transaction: total_pages,
      amounts_to_from: amounts_to_from,
    });
  } catch (e) {
    console.log(e.message);
    return res.status(500).send({ success: false, message: e.message });
  }
}

// Create Manual Deposit Transaction
async function create_deposit_transaction(from, amount, tx_currency, tx_type) {
  try {
    from = from.toLowerCase();
    amount = parseFloat(amount);
    let tx_hash_generated = global_helper.make_hash();

    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    let tx_type_db = await get_tx_type(tx_type);
    let tx_global_currency = await global_helper.get_option_by_key("global_currency");
    let tx_fee_currency = tx_global_currency?.data?.value;
    let tx_wei = tx_type_db?.data?.tx_fee;
    let tx_fee_value = await global_helper.calculate_tx_fee(tx_wei, tx_fee_currency);

    let tx_fee = tx_fee_value?.data;
    let denomination = 0;
    let account_main = await accounts.findOne({
      account_owner: from,
      account_category: "main",
    });

    const createdTransaction = await transactions.create({
      from,
      to: account_main?.address,
      amount,
      tx_hash,
      tx_status: "approved",
      tx_type,
      denomination,
      tx_fee,
      tx_fee_currency,
      tx_currency,
    });

    return {
      message: "transaction created",
      data: createdTransaction,
    };
  } catch (e) {
    console.log(e, "deposit transaction error");
    return null;
  }
}

// Make Transfer
async function make_transfer(req, res) {
  try {
    let {
      from,
      to,
      amount,
      tx_currency,
      account_category_to,
      account_category_from,
      tx_type = "transfer",
    } = req.body;

    if (
      !from &&
      !to &&
      !amount &&
      !tx_type &&
      !tx_currency &&
      !account_category_to &&
      !account_category_from
    ) {
      return main_helper.error_response(res, "please provide all necessary values");
    }
    if (from) from = from.toLowerCase();
    if (to) to = to.toLowerCase();

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();
    amount = parseFloat(amount);
    if (amount <= 0) {
      return main_helper.error_response(res, "amount must be greater than 0");
    }
    let denomination = 0;

    if (to === from && account_category_to === account_category_from) {
      return main_helper.error_response(res, "You can not trasnfer to same account");
    }

    if (to !== from && account_category_to !== "main") {
      return main_helper.error_response(
        res,
        "You can only trasnfer to recepient's main account",
      );
    }

    let queries = [
      accounts.findOne({ account_owner: to, account_category: account_category_to }),
      accounts.findOne({ account_owner: from, account_category: account_category_from }),
      accounts.findOne({
        account_owner: from,
        account_category: "main",
      }),
    ];

    let [account_to, account_from, mainAccount] = await Promise.all(queries);

    if (!mainAccount.active) {
      return main_helper.error_response(res, "Cannot transfer from this account");
    }

    if (!account_to || !account_from) {
      return main_helper.error_response(
        res,
        "we dont have such address registered in our system.",
      );
    }

    if (account_from.active === false) {
      return main_helper.error_response(res, "Cannot transfer from this account");
    }
    if (account_to.active === false) {
      return main_helper.error_response(res, "Cannot transfer to this account");
    }
    if (
      account_category_from === "trade" &&
      account_from.balance - mainAccount.stakedTotal < parseFloat(amount)
    ) {
      return main_helper.error_response(res, "Insufficient funds or locked funds");
    } else if (account_from.balance >= parseFloat(amount)) {
      let tx_options = undefined;
      tx_options = {
        account_category_to,
        account_category_from,
      };
      const [updatedAcc, createdTransaction] = await Promise.all([
        accounts.findOneAndUpdate(
          { account_owner: from, account_category: account_category_from },
          { $inc: { balance: 0 - parseFloat(amount) } },
          { new: true },
        ),
        transactions.create({
          from,
          to,
          amount,
          tx_hash,
          tx_status: "approved",
          tx_type,
          denomination,
          tx_currency,
          tx_options,
        }),
        accounts.findOneAndUpdate(
          { account_owner: to, account_category: account_category_to },
          { $inc: { balance: amount } },
          { new: true },
        ),
      ]);

      return main_helper.success_response(res, {
        message: "successfull transaction",
        data: { createdTransaction, updatedAcc },
      });
    } else {
      return main_helper.error_response(res, "Insufficient funds");
    }
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error saving transaction");
  }
}

// Referral Uni Transaction
async function send_uni_referral_transaction(
  user_has_ref_uni,
  referral_options,
  tx_hash,
  account_type_uni_from,
  tx,
) {
  let user_uni_referral = await referral_links.aggregate([
    {
      $match: { referral: user_has_ref_uni.referral },
    },
    {
      $lookup: {
        from: "account_metas",
        localField: "account_id",
        foreignField: "_id",
        as: "account_id",
      },
    },
    { $unwind: "$account_id" },
  ]);
  let tx_amount =
    (tx.amount * referral_options?.object_value?.referral_uni_percentage) / 100;
  let to_address = user_uni_referral[0]?.account_id?.address;
  let tx_hash_generated = global_helper.make_hash();
  if (tx.to != to_address) {
    let to_main = await accounts.findOne({
      $or: [{ account_owner: to_address }, { address: to_address }],
      account_category: "main",
    });
    let tx_save_uni = await transactions.create({
      tx_hash: ("0x" + tx_hash_generated).toLowerCase(),
      to: to_main?.address,
      amount: tx_amount,
      from: tx.to,
      tx_status: "approved",
      tx_type: "referral_bonus_uni_level",
      denomination: 0,
      tx_fee: 0,
      tx_fee_currency: tx.tx_fee_currency,
      tx_currency: tx.tx_currency,
      tx_options: {
        referral: user_has_ref_uni.referral,
        tx_hash: tx_hash,
        referral_module: "uni",
        lvl: 0,
        percent: referral_options?.object_value?.referral_uni_percentage,
      },
    });
    if (tx_save_uni) {
      await accounts.findOneAndUpdate(
        { account_owner: to_address, account_category: "main" },
        { $inc: { balance: tx_amount } },
      );
    }
  }
  return false;
}

// Checking Max Bonus Amount For User Referral
async function check_user_bonus_maximum(address, bonus_type) {
  let tx_amount = await transactions.aggregate([
    { $match: { to: address, tx_type: bonus_type } },
    { $group: { _id: null, amount: { $sum: "$amount" } } },
  ]);
  if (tx_amount.length > 0) {
    return tx_amount[0].amount;
  } else {
    return 0;
  }
}

// Referral Binary Transaction
async function send_binary_referral_transaction(
  user_has_ref_binary,
  referral_options,
  tx_hash,
  account_type_uni_from,
  tx,
) {
  let binary_bonus_txs = [];
  for (let i = 0; i < user_has_ref_binary.length; i++) {
    let user_binary_referral = await referral_links.aggregate([
      {
        $match: { referral: user_has_ref_binary[i].referral },
      },
      {
        $lookup: {
          from: "account_metas",
          localField: "account_id",
          foreignField: "_id",
          as: "account_id",
        },
      },
      { $unwind: "$account_id" },
    ]);
    let lbl = "referral_binary_percentage_lvl_" + user_has_ref_binary[i].lvl;
    let lba = "referral_binary_max_amount_lvl_" + user_has_ref_binary[i].lvl;
    let level_percent = referral_options?.object_value[lbl];
    let tx_amount = (tx.amount * level_percent) / 100;
    let to_address = user_binary_referral[0]?.account_id?.address;
    let already_taken_bonus = await check_user_bonus_maximum(
      to_address,
      "referral_bonus_binary_level_" + (i + 1),
    );
    if (already_taken_bonus + tx_amount <= referral_options?.object_value[lba]) {
      let tx_hash_generated = global_helper.make_hash();
      if (tx.to != to_address) {
        let to_main = await accounts.findOne({
          $or: [{ account_owner: to_address }, { address: to_address }],
          account_category: "main",
        });
        let tx_save_binary = await transactions.create({
          tx_hash: ("0x" + tx_hash_generated).toLowerCase(),
          to: to_main?.address,
          amount: tx_amount,
          from: tx.to,
          tx_status: "approved",
          tx_type: "referral_bonus_binary_level_" + (i + 1),
          denomination: 0,
          tx_fee: 0,
          tx_fee_currency: tx.tx_fee_currency,
          tx_currency: tx.tx_currency,
          tx_options: {
            referral: user_has_ref_binary[i].referral,
            tx_hash: tx_hash,
            referral_module: "binary",
            lvl: i + 1,
            percent: level_percent,
          },
        });
        if (tx_save_binary) {
          await accounts.findOneAndUpdate(
            { account_owner: to_address, account_category: "main" },
            { $inc: { balance: tx_amount } },
          );
          binary_bonus_txs.push(tx_save_binary);
        }
      }
    }
  }
  return binary_bonus_txs;
}

// Get Transaction Type
async function get_tx_type(tx_type) {
  try {
    let type = await transaction_types.findOne({ name: tx_type }).exec();
    if (type) {
      return main_helper.return_data(true, type);
    }
    return main_helper.error_message("tx_type not found");
  } catch (e) {
    console.log(e.message);
    return main_helper.error_message("error");
  }
}

// Pending Deposit Transaction
async function pending_deposit_transaction(req, res) {
  try {
    let { from, amount, amountTransferedFrom, receivePaymentAddress, startDate } =
      req.body;

    if (!from) return res.status(400).json(main_helper.error_message("from is required"));
    from = from.toLowerCase();

    const tx_hash = global_helper.make_hash();
    let account_main = await accounts.findOne({
      $or: [{ account_owner: from }, { address: from }],
      account_category: "main",
    });

    const transaction = await transactions.create({
      from,
      to: account_main?.address,
      amount,
      tx_hash,
      tx_type: "deposit",
      tx_currency: "ether",
      tx_status: "pending",
      tx_options: {
        method: "manual",
        receivePaymentAddress,
        amountTransferedFrom,
        startDate,
      },
    });

    res.status(200).send({ success: true, transaction });
  } catch (e) {
    return res.status(500).send({ success: false, message: "something went wrong" });
  }
}

// Create Coinbase Deposit Transaction
async function coinbase_deposit_transaction(req, res) {
  try {
    let { from, amount } = req.body;
    if (!from) return res.status(400).json(main_helper.error_message("from is required"));
    from = from.toLowerCase();
    const tx_hash = global_helper.make_hash();
    let account_main = await accounts.findOne({
      $or: [{ account_owner: from }, { address: from }],
      account_category: "main",
    });

    await transactions.create({
      from,
      to: account_main?.address,
      amount: (amount - 1) / 2,
      tx_hash,
      tx_type: "payment",
      tx_currency: "ether",
      tx_status: "pending",
      tx_options: {
        method: "coinbase",
      },
    });

    const chargeData = {
      name: "Pay with CoinBase",
      description: "You can pay with your CoinBase wallet.",
      pricing_type: "fixed_price",
      local_price: {
        amount: amount,
        currency: "USD",
      },
      metadata: {
        address: from,
        tx_hash,
      },
      supported_currencies: {
        btc: true,
        eth: true,
        usdc: true,
      },
      redirect_url: `${process.env.FRONTEND_URL}`,
      cancel_url: `${process.env.FRONTEND_URL}`,
    };

    axios
      .post("https://api.commerce.coinbase.com/charges", chargeData, {
        headers: {
          "X-CC-Api-Key": process.env.COINBASE_API_KEY,
          "X-CC-Version": "2018-03-22",
        },
      })
      .then(async (response) => {
        const charge = response.data.data;

        const responseData = {
          hosted_url: charge.hosted_url,
          expires_at: charge.expires_at,
          amount: charge.pricing.local.amount,
          currency: charge.pricing.local.currency,
          addresses: charge.addresses,
          exchange_rates: charge.exchange_rates,
        };

        res.status(200).send({ success: true, responseData });
      })
      .catch((error) => {
        console.log(error?.response);
        res.status(500).send({ success: false, message: "something went wrong" });
      });
  } catch (e) {
    console.log(e);
    res.status(500).send({ success: false, message: "something went wrong" });
  }
}

// Create Global Option
async function create_global_option(req, res) {
  try {
    const { type, object_value, value } = req.body;

    let key = await global_helper.get_option_by_key(type);

    if (key.data) {
      return main_helper.error_response(
        res,
        main_helper.error_message("global option by that key already exists"),
      );
    }

    let optionData = {};

    if (value) {
      optionData.value = value;
    }

    if (object_value) {
      optionData.object_value = object_value;
    }

    const result = await options.create({ key: type, ...optionData });

    return res.status(200).json({
      message: "global option created successfully",
      data: result,
    });
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error creating global option");
  }
}

// Update Global Option
async function update_options(req, res) {
  try {
    const { type, object_value, value } = req.body;

    let key = await global_helper.get_option_by_key(type);

    if (!key.data) {
      return main_helper.error_message("key not found");
    }

    let updateObj = {};

    if (value !== undefined) {
      updateObj.value = value;
    }

    if (object_value !== undefined) {
      updateObj.object_value = object_value;
    }

    let result = await options.findOneAndUpdate(
      { key: type },
      { $set: updateObj },
      { new: true },
    );

    return res.status(200).json({
      message: "option updated",
      data: result,
    });
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error updating global option");
  }
}

// Coinbase Webhook
async function coinbase_webhooks(req, res) {
  try {
    const verify = Webhook.verifySigHeader(
      req.rawBody,
      req.headers["x-cc-webhook-signature"],
      process.env.COINBASE_WEBHOOK_SECRET,
    );

    if (!verify) {
      return res.status(400).send({ success: false, message: "invalid signature" });
    }

    const event = req.body.event;

    let amount = event.data.pricing.local.amount;
    let metadata = event.data.metadata;
    if (event.type === "charge:confired") {
      await transactions.findOneAndUpdate(
        { tx_hash: metadata.tx_hash },
        { tx_status: "paid", amount: Number(amount) },
      );
    }

    console.log(event?.data?.payments?.[0]?.value);
    // console.log(event);

    if (event.type === "charge:failed") {
      try {
        const contract = new web3.eth.Contract(minABI, tokenAddress);
        const tokenAmountInWei = web3.utils.toWei(
          ((amount - 1) / 2)?.toString(),
          "ether",
        );
        const transfer = contract.methods.transfer(metadata?.address, tokenAmountInWei);

        const encodedABI = transfer.encodeABI();

        const gasPrice = await web3.eth.getGasPrice();

        const tx = {
          from: account1,
          to: tokenAddress,
          data: encodedABI,
        };

        const gasLimit = await web3.eth.estimateGas(tx);

        tx.gas = gasLimit;

        web3.eth.accounts.signTransaction(
          tx,
          process.env.METAMASK_PRIVATE,
          (err, signed) => {
            if (err) {
              console.log(err);
            } else {
              web3.eth
                .sendSignedTransaction(signed.rawTransaction)
                .on("receipt", async (receipt) => {
                  const transactionFee = web3.utils.fromWei(
                    web3.utils.toBN(receipt.gasUsed).mul(web3.utils.toBN(gasPrice)),
                    "ether",
                  );
                  await transactions.findOneAndUpdate(
                    { tx_hash: metadata.tx_hash },
                    { tx_status: "canceled", tx_fee: transactionFee },
                  );
                })
                .on("error", console.log);
            }
          },
        );
      } catch (e) {
        console.log(e);
      }
    }
    return res.status(200).send({ success: true });
  } catch (e) {
    console.log(e);
    return res.status(500).send({ success: false, message: "internal server error" });
  }
}

async function make_withdrawal(req, res) {
  let { address, address_to, amount, accountType, rate } = req.body;
  if (!address) {
    return res.status(400).json({ error: "address is required" });
  }
  address = address.toLowerCase();
  try {
    const mainAccount = await accounts.findOne({
      account_owner: address,
      account_category: "main",
    });

    if (!mainAccount) {
      return res.status(400).json(main_helper.error_message("main account not found"));
    }

    if (!mainAccount.active) {
      return res
        .status(400)
        .json(main_helper.error_message("main account is not active"));
    }

    if (accountType === "ATAR") {
      if (mainAccount.balance < amount) {
        return res.status(400).json(main_helper.error_message("insufficient funds"));
      }
      let tx_hash_generated = global_helper.make_hash();
      let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

      const [updatedMainAcc] = await Promise.all([
        accounts.findOneAndUpdate(
          { account_owner: address, account_category: "main" },
          { $inc: { balance: 0 - amount } },
          { new: true },
        ),
        transactions.create({
          from: address,
          to: address_to,
          amount,
          tx_hash,
          tx_type: "withdraw",
          tx_currency: "ether",
          tx_status: "pending",
          tx_options: {
            method: "manual",
            currency: "ATR",
            rate,
          },
        }),
      ]);
      return res.status(200).json({
        success: true,
        message: "successfull transaction",
        result: updatedMainAcc,
      });
    }

    if (mainAccount.assets[accountType] < amount) {
      return res.status(400).json(main_helper.error_message("insufficient funds"));
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const [updatedMainAcc] = await Promise.all([
      accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { [`assets.${accountType}`]: 0 - amount } },
        { new: true },
      ),
      transactions.create({
        from: address,
        to: address_to,
        amount,
        tx_hash,
        tx_type: "withdraw",
        tx_currency: "ether",
        tx_status: "pending",
        tx_options: {
          method: "manual",
          currency: accountType,
          rate,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "successfull transaction",
      result: updatedMainAcc,
    });
  } catch (e) {
    console.log(e, "make_withdrawal");
    return res.status(500).send({ success: false, message: "internal server error" });
  }
}

async function direct_deposit(req, res) {
  try {
    let { address, hash } = req.body;
    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }

    address = address.toLowerCase();

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const tx = await web3.eth.getTransaction(hash);
    const inputHex = tx.input;
    const functionSignature = inputHex.slice(0, 10);
    const encodedParameters = inputHex.slice(10);
    const decodedParameters = web3.eth.abi.decodeParameters(
      ["address", "uint256"],
      encodedParameters,
    );

    if (
      tx.to.toLowerCase() === tokenAddress.toLowerCase() &&
      functionSignature === "0xa9059cbb"
    ) {
      const numberOfTokens = decodedParameters["1"];
      const [updatedAccount] = await Promise.all([
        accounts.findOneAndUpdate(
          { account_owner: address, account_category: "main" },
          { $inc: { balance: numberOfTokens / 10 ** 18 } },
          { new: true },
        ),
        transactions.create({
          from: address,
          to: address,
          amount: numberOfTokens / 10 ** 18,
          tx_hash,
          tx_type: "deposit",
          tx_currency: "ether",
          tx_status: "approved",
          tx_options: {
            method: "direct",
          },
        }),
      ]);

      return main_helper.success_response(res, {
        message: "successfull transaction",
        updatedAccount,
      });
    } else {
      return res.status(200).json({
        success: true,
        message: "This transaction does not involve a transfer of custom tokens.",
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Get One Tx By Hash
async function get_transaction_by_hash(req, res) {
  try {
    let = { hash } = req.body;

    if (!hash) return res.status(400).json(main_helper.error_message("hash is required"));

    const transaction = await transactions.findOne({ tx_hash: hash });

    if (!transaction)
      return res.status(200).json(main_helper.error_message("transaction not found"));

    return res.status(200).send({ success: true, transaction });
  } catch (e) {}
}

async function unstake_transaction(req, res) {
  try {
    let { address, index } = req.body;

    if (!address)
      return res.status(400).json(main_helper.error_message("address is required"));

    if (typeof index !== "number")
      return res.status(400).json(main_helper.error_message("index is required"));

    address = address.toLowerCase();

    const tokenAddress = "0xd472C9aFa90046d42c00586265A3F62745c927c0"; // Staking contract Address
    const tokenContract = new web3.eth.Contract(STACK_ABI, tokenAddress);
    const result = await tokenContract.methods.stakersRecord(address, index).call();

    if (!result.unstaked) {
      return res.status(400).json(main_helper.error_message("not unstaked yet"));
    }

    const mainAccount = await accounts.findOne({
      account_owner: address,
      account_category: "main",
    });

    if (!mainAccount) {
      return res.status(400).json(main_helper.error_message("main account not found"));
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const [updatedAccount] = await Promise.all([
      accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { balance: 0 - result.amount / 10 ** 18 } },
        { new: true },
      ),
      transactions.create({
        from: address,
        to: address,
        amount: result.amount / 10 ** 18,
        tx_hash,
        tx_type: "unstake",
        tx_currency: "ether",
        tx_status: "approved",
        tx_options: {
          method: "unstake",
        },
      }),
    ]);

    return res.status(200).send({ success: true, updatedAccount, result });
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: "An error occurred" });
  }
}

async function exchange(req, res) {
  try {
    let { address, fromAccType, fromAmount, toAccType, toAmount } = req.body;

    if (!address)
      return res.status(400).send({ success: false, message: "address is required" });

    address = address.toLowerCase();

    const mainAccount = await accounts.findOne({
      account_owner: address,
      account_category: "main",
    });

    if (!mainAccount) {
      return res.status(400).send({ success: false, message: "main account not found" });
    }

    if (!mainAccount.active) {
      return res
        .status(400)
        .json(main_helper.error_message("main account is not active"));
    }

    if (fromAccType.toLowerCase() === toAccType.toLowerCase()) {
      return res
        .status(400)
        .send({ success: false, message: "from and to account type can not be same" });
    }

    if (fromAccType === "ATAR" && mainAccount.balance < fromAmount) {
      return res.status(400).send({ success: false, message: "insufficient balance" });
    } else if (mainAccount.assets?.[fromAccType] < fromAmount) {
      return res.status(400).send({ success: false, message: "insufficient balance" });
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    let query = null;
    if (fromAccType === "ATAR") {
      query = accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { balance: 0 - fromAmount, [`assets.${toAccType}`]: toAmount } },
      );
    } else if (toAccType === "ATAR") {
      query = accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { balance: toAmount, [`assets.${fromAccType}`]: 0 - fromAmount } },
      );
    } else {
      query = accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        {
          $inc: {
            [`assets.${fromAccType}`]: 0 - fromAmount,
            [`assets.${toAccType}`]: toAmount,
          },
        },
      );
    }
    const [mainAccountUpdated] = await Promise.all([
      query,
      transactions.create({
        from: address,
        to: address,
        amount: fromAmount,
        tx_hash,
        tx_type: "exchange",
        tx_currency: "ether",
        tx_status: "approved",
        tx_options: {
          method: "exchange",
          fromAccType: fromAccType.toUpperCase(),
          toAccType: toAccType.toUpperCase(),
          fromAmount,
          toAmount,
        },
      }),
    ]);

    return res.status(200).send({ success: true, result: mainAccountUpdated });
  } catch (e) {
    console.log(e, "exchange");
    return res.status(500).send({ success: false, message: "internal server error" });
  }
}

module.exports = {
  create_deposit_transaction,
  pending_deposit_transaction,
  coinbase_deposit_transaction,
  create_global_option,
  update_options,
  coinbase_webhooks,
  get_transactions_of_user,
  get_transaction_by_hash,
  make_transfer,
  direct_deposit,
  unstake_transaction,
  exchange,
  make_withdrawal,
};
