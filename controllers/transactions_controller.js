const main_helper = require("../helpers/index");
const global_helper = require("../helpers/global_helper");
const {
  transaction_types,
  transactions,
  accounts,
  referral_links,
  options,
  treasuries,
  currencyStakes,
  account_meta,
  verify_txs,
  rates,
} = require("@cubitrix/models");
const moment = require("moment");
const _ = require("lodash");

require("dotenv").config();

const Webhook = require("coinbase-commerce-node").Webhook;

const axios = require("axios");

const Web3 = require("web3");
const web3 = new Web3(process.env.WEB3_PROVIDER_URL);

const minABI = require("../abi/WBNB.json");
const STACK_ABI = require("../abi/stack.json");
const { decode } = require("jsonwebtoken");

const { ObjectId } = require("mongodb");

const treasuryAddress = process.env.TOKEN_HOLDER_TREASURY_ADDRESS;
const tokenAddress = process.env.TOKEN_ADDRESS;

// Get Transactions Of user
async function get_transactions_of_user(req, res) {
  try {
    const req_body = await req.body;
    const req_page = req_body.page ? req_body.page : 1;
    const limit = req_body.limit ? req_body.limit : 10;
    const account_type = req_body?.account ? req_body?.account : "all";
    const method_type = req_body?.type ? req_body?.type : "all";
    const date_type = req_body?.time ? req_body?.time : "all";
    let address = req.address;

    if (!address) {
      return res
        .status(500)
        .send({ success: false, message: "you are not logged in" });
    }

    const mainAccount = await accounts.findOne({
      account_owner: address,
      account_category: "main",
    });

    if (!mainAccount) {
      return res
        .status(400)
        .json(main_helper.error_message("main account not found"));
    }

    let addr_arr = [address, mainAccount.address];

    const pipeline = [
      {
        $facet: {
          toCount: [
            {
              $match: {
                to: { $in: addr_arr },
                tx_type: {
                  $in: ["deposit", "bonus", "transfer"],
                },
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
                tx_type: {
                  $in: ["withdraw", "transfer"],
                },
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
          "bonus",
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
      //.find({ to: mainAccount.address })
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
async function create_deposit_transaction(
  from1,
  amount1,
  tx_currency,
  tx_type
) {
  try {
    let from = from1.toLowerCase();
    let amount = parseFloat(amount1);

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const [tx_type_db, tx_global_currency, account_main, ratesObj] =
      await Promise.all([
        get_tx_type(tx_type),
        global_helper.get_option_by_key("global_currency"),
        accounts.findOne({
          account_owner: from,
          account_category: "main",
        }),
        rates.findOne(),
      ]);

    let tx_fee_currency = tx_global_currency?.data?.value;
    let tx_wei = tx_type_db?.data?.tx_fee;

    let tx_fee_value = await global_helper.calculate_tx_fee(
      tx_wei,
      tx_fee_currency
    );
    let tx_fee = tx_fee_value?.data;

    let denomination = 0;

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
      A1_price: ratesObj?.atr?.usd ?? 2,
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
      to,
      amount,
      currency,
      tx_currency,
      account_category_to,
      account_category_from,
      tx_type = "transfer",
    } = req.body;

    let from = req.address;

    if (
      !from &&
      !to &&
      !amount &&
      !tx_type &&
      !tx_currency &&
      !account_category_to &&
      !account_category_from
    ) {
      return main_helper.error_response(
        res,
        "please provide all necessary values"
      );
    }
    if (to) to = to.toLowerCase();

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();
    amount = parseFloat(amount);
    if (amount <= 0) {
      return main_helper.error_response(res, "amount must be greater than 0");
    }
    let denomination = 0;

    if (to === from && account_category_to === account_category_from) {
      return main_helper.error_response(
        res,
        "You can not trasnfer to same account"
      );
    }

    if (to !== from && account_category_to !== "main") {
      return main_helper.error_response(
        res,
        "You can only trasnfer to recepient's main account"
      );
    }

    let queries = [
      accounts.findOne({
        account_owner: to,
        account_category: account_category_to,
      }),
      accounts.findOne({
        account_owner: from,
        account_category: account_category_from,
      }),
      accounts.findOne({
        account_owner: from,
        account_category: "main",
      }),
      account_meta.findOne({
        address: from,
      }),
    ];

    let [account_to, account_from, mainAccount, metaAccount] =
      await Promise.all(queries);

    if (!mainAccount?.active) {
      return main_helper.error_response(
        res,
        "Cannot transfer from this account"
      );
    }

    if (!account_to || !account_from) {
      return main_helper.error_response(
        res,
        "we dont have such address registered in our system."
      );
    }

    if (account_from.active === false) {
      return main_helper.error_response(
        res,
        "Cannot transfer from this account"
      );
    }
    if (account_to.active === false) {
      return main_helper.error_response(res, "Cannot transfer to this account");
    }
    if (
      account_category_from === "trade" &&
      account_from.balance - mainAccount.stakedTotal < parseFloat(amount)
    ) {
      return main_helper.error_response(
        res,
        "Insufficient funds or locked funds"
      );
    } else if (currency) {
      let tx_options = {
        account_category_from,
        account_category_to,
        currency,
      };
      const verificationCode = global_helper.make_hash(6);
      const emailStatus = await global_helper.send_verification_mail(
        metaAccount?.email,
        verificationCode
      );
      await verify_txs.create({
        from,
        to,
        amount,
        tx_hash,
        tx_status: "approved",
        tx_type,
        denomination,
        tx_currency,
        tx_options,
        code: verificationCode,
      });

      if (emailStatus.message === "Email sent") {
        return main_helper.success_response(
          res,
          "Verification code has been sent"
        );
      } else {
        return main_helper.error_response(res, emailStatus);
      }
    } else if (account_from.balance >= parseFloat(amount)) {
      let tx_options = {
        account_category_to,
        account_category_from,
      };
      if (to !== from) {
        const verificationCode = global_helper.make_hash(6);
        const emailStatus = await global_helper.send_verification_mail(
          metaAccount?.email,
          verificationCode
        );

        await verify_txs.create({
          from,
          to,
          amount,
          tx_hash,
          tx_status: "approved",
          tx_type,
          denomination,
          tx_currency,
          tx_options,
          code: verificationCode,
        });
        if (emailStatus.message === "Email sent") {
          return main_helper.success_response(
            res,
            "Verification code has been sent"
          );
        } else {
          return main_helper.error_response(res, emailStatus);
        }
      }

      const [updatedAcc, createdTransaction] = await Promise.all([
        accounts.findOneAndUpdate(
          { account_owner: from, account_category: account_category_from },
          { $inc: { balance: 0 - parseFloat(amount) } },
          { new: true }
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
          { new: true }
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

async function verify_external_transaction(req, res) {
  try {
    let address = req.address;
    const { code } = req.body;

    if (!address)
      return main_helper.error_response(res, "you are not logged in");
    if (!code)
      return main_helper.error_response(
        res,
        "Please provide verification code"
      );

    const verifiedTx = await verify_txs.findOne({
      from: address,
      code,
    });

    if (!verifiedTx)
      return main_helper.error_response(res, "Invalid verification code");

    let {
      to,
      amount,
      tx_options,
      denomination,
      tx_type,
      tx_hash,
      tx_currency,
    } = verifiedTx;
    let currency = tx_options?.currency;

    const queries = [
      accounts.findOne({
        account_owner: to,
        account_category: tx_options?.account_category_to,
      }),
      accounts.findOne({
        account_owner: address,
        account_category: tx_options?.account_category_from,
      }),
      accounts.findOne({ account_owner: address, account_category: "main" }),
      rates.findOne(),
    ];

    let [account_to, account_from, mainAccount, ratesObj] = await Promise.all(
      queries
    );

    if (!mainAccount?.active || !account_to || !account_from) {
      // Change 3
      return main_helper.error_response(
        res,
        "we don't have such an address registered in our system, or the account is inactive"
      );
    }

    if (account_from.active === false) {
      return main_helper.error_response(
        res,
        "Cannot transfer from this account"
      );
    }
    if (account_to.active === false) {
      return main_helper.error_response(res, "Cannot transfer to this account");
    }

    let operations = [];

    const amountFloat = parseFloat(amount);
    if (currency) {
      if (
        (account_from.assets[currency],
        account_from.assets[currency] >= amountFloat)
      ) {
        let decreaseBalance = {};
        let increaseBalance = {};
        decreaseBalance[`assets.${currency}`] = 0 - amountFloat;
        increaseBalance[`assets.${currency}`] = amountFloat;
        operations.push(
          accounts.findOneAndUpdate(
            {
              account_owner: address,
              account_category: tx_options?.account_category_from,
            },
            { $inc: decreaseBalance },
            { new: true }
          ),
          transactions.create({
            from: address,
            to,
            amount: amountFloat,
            tx_hash,
            tx_status: "approved",
            tx_type,
            denomination,
            tx_currency,
            tx_options,
            A1_price: ratesObj?.atr?.usd ?? 2,
          }),
          accounts.findOneAndUpdate(
            {
              account_owner: to,
              account_category: tx_options?.account_category_to,
            },
            { $inc: increaseBalance },
            { new: true }
          )
        );
      } else {
        return main_helper.error_response(res, "Insufficient funds");
      }
    } else if (account_from.balance >= amountFloat) {
      operations.push(
        accounts.findOneAndUpdate(
          {
            account_owner: address,
            account_category: tx_options?.account_category_from,
          },
          { $inc: { balance: 0 - amountFloat } },
          { new: true }
        ),
        transactions.create({
          from: address,
          to,
          amount: amountFloat,
          tx_hash,
          tx_status: "approved",
          tx_type,
          denomination,
          tx_currency,
          tx_options,
          A1_price: ratesObj?.atr?.usd ?? 2,
        }),
        accounts.findOneAndUpdate(
          {
            account_owner: to,
            account_category: tx_options?.account_category_to,
          },
          { $inc: { balance: amountFloat } },
          { new: true }
        )
      );
    } else {
      return main_helper.error_response(res, "Insufficient funds");
    }

    let [updatedAcc, createdTransaction, updatedAcc2] = await Promise.all(
      operations
    );

    await verify_txs.deleteOne({ _id: verifiedTx._id });

    return main_helper.success_response(res, {
      message: "successfull transaction",
      data: { createdTransaction, updatedAcc, updatedAcc2 },
    });
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error saving transaction");
  }
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
    let from = req.address;
    if (!from)
      return res
        .status(400)
        .json(main_helper.error_message("you are not logged in"));
    let { amount, amountTransferedFrom, receivePaymentAddress, startDate } =
      req.body;

    const tx_hash = global_helper.make_hash();

    let [account_main, ratesObj] = await Promise.all([
      accounts.findOne({
        $or: [{ account_owner: from }, { address: from }],
        account_category: "main",
      }),
      rates.findOne(),
    ]);

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
      A1_price: ratesObj?.atr?.usd ?? 2,
    });

    res.status(200).send({ success: true, transaction });
  } catch (e) {
    return res
      .status(500)
      .send({ success: false, message: "something went wrong" });
  }
}

// Create Coinbase Deposit Transaction
async function coinbase_deposit_transaction(req, res) {
  try {
    let { amount } = req.body;
    let from = req.address;
    if (!from) {
      return res
        .status(400)
        .json(main_helper.error_message("you are not logged in"));
    }
    const tx_hash = global_helper.make_hash();

    let [account_main, ratesObj] = await Promise.all([
      accounts.findOne({
        $or: [{ account_owner: from }, { address: from }],
        account_category: "main",
      }),
      rates.findOne(),
    ]);

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
      A1_price: ratesObj?.atr?.usd ?? 2,
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
        bnb: true,
        usdt: true,
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
        res
          .status(500)
          .send({ success: false, message: "something went wrong" });
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
        main_helper.error_message("global option by that key already exists")
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
      { new: true }
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
      process.env.COINBASE_WEBHOOK_SECRET
    );

    if (!verify) {
      return res
        .status(400)
        .send({ success: false, message: "invalid signature" });
    }

    const event = req.body.event;

    let amount = event.data.pricing.local.amount;
    let metadata = event.data.metadata;
    if (event.type === "charge:confired") {
      await transactions.findOneAndUpdate(
        { tx_hash: metadata.tx_hash },
        { tx_status: "paid", amount: Number(amount) }
      );
    }

    if (event.type === "charge:failed") {
      try {
        const contract = new web3.eth.Contract(minABI, tokenAddress);
        const tokenAmountInWei = web3.utils.toWei(
          ((amount - 1) / 2)?.toString(),
          "ether"
        );
        const transfer = contract.methods.transfer(
          metadata?.address,
          tokenAmountInWei
        );

        const encodedABI = transfer.encodeABI();

        const gasPrice = await web3.eth.getGasPrice();

        const tx = {
          from: treasuryAddress,
          to: tokenAddress,
          data: encodedABI,
        };

        const gasLimit = await web3.eth.estimateGas(tx);

        tx.gas = gasLimit;

        web3.eth.accounts.signTransaction(
          tx,
          process.env.TOKEN_HOLDER_TREASURY_PRIVATE_KEY,
          (err, signed) => {
            if (err) {
              console.log(err);
            } else {
              web3.eth
                .sendSignedTransaction(signed.rawTransaction)
                .on("receipt", async (receipt) => {
                  const transactionFee = web3.utils.fromWei(
                    web3.utils
                      .toBN(receipt.gasUsed)
                      .mul(web3.utils.toBN(gasPrice)),
                    "ether"
                  );
                  await transactions.findOneAndUpdate(
                    { tx_hash: metadata.tx_hash },
                    { tx_status: "canceled", tx_fee: transactionFee }
                  );
                })
                .on("error", console.log);
            }
          }
        );
      } catch (e) {
        console.log(e);
      }
    }
    return res.status(200).send({ success: true });
  } catch (e) {
    console.log(e);
    return res
      .status(500)
      .send({ success: false, message: "internal server error" });
  }
}

async function create_exchange_transaction(req, res) {
  try {
    let address = req.address;
    //address = "0x677dD459bEF0F585ffB17734e8f1968ff4805a39";

    if (!address) {
      return res.status(400).json({ error: "you are not logged in" });
    }

    let { rpc1, rpc2, tokenAddress, amount, decimals, isNative, tokenCount } =
      req.body;
    amount = parseFloat(amount);

    let { data } = await axios.post(
      process.env.PAYMENT_API + "/v1/createExchange",
      {
        rpc: rpc1,
        rpc1: rpc2,
        tokenAddress,
        decimals,
        isNative,
        sentAmount: parseFloat(amount),
      }
    );

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const [account_main, ratesObj] = await Promise.all([
      accounts.findOne({
        account_owner: address,
        account_category: "main",
      }),
      rates.findOne(),
    ]);

    let denomination = 0;

    const createdTransaction = await transactions.create({
      from: address,
      to: account_main?.address,
      amount,
      tx_hash,
      tx_status: "pending",
      tx_type: "payment",
      denomination,
      tx_currency: "ether",
      exchange_id: data?.exchangeId,
      exchange_create_object: data,
      A1_price: ratesObj?.atr?.usd ?? 2,
      tx_options: {
        tokenCount,
      },
    });

    return res.status(200).send({ success: true, data, createdTransaction });
  } catch (e) {
    console.log(e);
    return res
      .status(500)
      .send({ success: false, message: "internal server error" });
  }
}

async function get_exchange_status(req, res) {
  try {
    let address = req.address;

    if (!address) {
      return res.status(400).json({ error: "you are not logged in" });
    }

    let { exchangeId } = req.body;

    if (!exchangeId || !ObjectId.isValid(exchangeId)) {
      return res.status(400).json({ error: "Invalid exchangeId" });
    }

    let exchangeIdAsObjectId = new ObjectId(exchangeId);

    let { data } = await axios.post(
      process.env.PAYMENT_API + "/v1/getExchangeInfo",
      {
        exchangeId: exchangeIdAsObjectId,
      }
    );

    return res.status(200).send({ success: true, data });
  } catch (e) {
    console.log(e);
    return res
      .status(500)
      .send({ success: false, message: "internal server error" });
  }
}

async function check_transactions_for_pending(req, res) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [get_txs, ratesObj, updated_txs] = await Promise.all([
    transactions.find({
      exchange_id: { $ne: null },
      tx_status: "pending",
      createdAt: { $gte: hourAgo },
    }),
    rates.findOne(),
    transactions.updateMany(
      {
        exchange_id: { $ne: null },
        tx_status: "pending",
        createdAt: { $lt: hourAgo },
      },
      { $set: { tx_status: "canceled" } }
    ),
  ]);

  const updatePromises = get_txs.map(async (tx) => {
    const exchangeId = tx.exchange_id;
    let { data } = await axios.post(
      process.env.PAYMENT_API + "/v1/getExchangeInfo",
      {
        exchangeId: exchangeId,
      }
    );

    let receiveAmount =
      data?.exchange?.receiveAmount ?? data?.exchange?.sentAmount;

    if (data.exchange?.status === "success") {
      let receivedTokenAddress = data?.exchange?.tokenAddress;
      let receivedrpc = data?.exchange?.rpc;
      let receivedrpc1 = data?.exchange?.rpc1;
      let receivedisNative = data?.exchange?.isNative;

      await transactions.updateOne(
        { exchange_id: exchangeId },
        { $set: { tx_status: "approved" } }
      );

      try {
        const contract = new web3.eth.Contract(minABI, tokenAddress);
        // let binance_rpcs_testnet = ["https://data-seed-prebsc-1-s1.binance.org:8545"];
        let binance_rpcs = [
          "https://bsc-dataseed.binance.org",
          "https://binance.nodereal.io",
        ];
        let eth_rpcs = ["https://eth.meowrpc.com"];
        let chain;

        if (eth_rpcs.includes(receivedrpc) || eth_rpcs.includes(receivedrpc1)) {
          chain = "eth";
        } else if (
          binance_rpcs.includes(receivedrpc) ||
          binance_rpcs.includes(receivedrpc1)
        ) {
          chain = "bsc";
        } else {
          chain = "bsc-test";
        }

        if (!chain) {
          return;
        }

        let receivedTotal = 0;

        if (receivedisNative) {
          if (chain == "bsc") {
            receivedTotal = ratesObj.bnb.usd * receiveAmount;
          } else if (chain == "eth") {
            receivedTotal = ratesObj.eth.usd * receiveAmount;
          } else {
            receivedTotal = ratesObj.bnb.usd * receiveAmount;
          }
        } else {
          if (chain == "eth") {
            if (
              receivedTokenAddress ==
              "0xdAC17F958D2ee523a2206206994597C13D831ec7"
            ) {
              receivedTotal = ratesObj.usdt.usd * receiveAmount;
            }
            if (
              receivedTokenAddress ==
              "0xB8c77482e45F1F44dE1745F52C74426C631bDD52"
            ) {
              receivedTotal = ratesObj.bnb.usd * receiveAmount;
            }
          }
        }

        //let finalTokenCount = Math.abs(receivedTotal);
        let approved_tx = await transactions.findOne({
          exchange_id: exchangeId,
        });
        let finalTokenCount = Math.abs(approved_tx.tx_options.tokenCount);

        const tokenAmountInWei = web3.utils.toWei(
          finalTokenCount?.toString(),
          "ether"
        );
        const transfer = contract.methods.transfer(tx?.from, tokenAmountInWei);
        const encodedABI = transfer.encodeABI();

        let txStats = {
          from: treasuryAddress,
          to: tokenAddress,
          data: encodedABI,
          value: 0,
        };

        const gasPrice = Number(await web3.eth.getGasPrice());
        const gasLimit = await web3.eth.estimateGas(txStats);

        txStats.gas = gasLimit;
        txStats.gasPrice = gasPrice;

        const trans = await web3.eth.accounts.signTransaction(
          txStats,
          process.env.TOKEN_HOLDER_TREASURY_PRIVATE_KEY,
          (err, signed) => {
            if (err) {
              console.log(err);
            } else {
              web3.eth
                .sendSignedTransaction(signed.rawTransaction)
                .on("error", (e) => {
                  console.log("Purchase error: ", e);
                });
            }
          }
        );

        return trans;
      } catch (e) {
        console.log(e);
      }
    }
  });

  await Promise.all(updatePromises);
}

async function make_withdrawal(req, res) {
  let { address_to, amount, accountType, rate } = req.body;

  let address = req.address;

  if (!address) {
    return res.status(400).json({ error: "you are not logged in" });
  }

  amount = parseFloat(amount);
  try {
    let [mainAccount, treasury, ratesObj] = await Promise.all([
      accounts.findOne({
        account_owner: address,
        account_category: "main",
      }),
      treasuries.findOne(),
      rates.findOne(),
    ]);

    if (!mainAccount)
      return res
        .status(400)
        .json(main_helper.error_message("main account not found"));
    if (!mainAccount.active)
      return res
        .status(400)
        .json(main_helper.error_message("main account is not active"));

    if (accountType === "ATAR") {
      let tx_fee_value = await global_helper.calculate_tx_fee(null, "ATR");

      if (mainAccount.balance < amount) {
        return res
          .status(400)
          .json(main_helper.error_message("insufficient funds"));
      }

      let balanceMinusFee = amount - tx_fee_value;

      const pendingWithdrawalAmount = treasury.pendingWithdrawals["ATR"] || 0;
      const currentIncomingAmount = treasury.incoming["ATR"] || 0;

      if (pendingWithdrawalAmount + amount > currentIncomingAmount) {
        return res
          .status(400)
          .json(
            main_helper.error_message(
              "Withdrawal with this amount is not possible at the moment"
            )
          );
      }

      let tx_hash_generated = global_helper.make_hash();
      let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

      const [updatedMainAcc] = await Promise.all([
        accounts.findOneAndUpdate(
          { account_owner: address, account_category: "main" },
          { $inc: { balance: 0 - amount } },
          { new: true }
        ),
        transactions.create({
          from: address,
          to: address_to,
          amount: balanceMinusFee,
          tx_hash,
          tx_type: "withdraw",
          tx_currency: "ether",
          tx_status: "approved",
          tx_fee: tx_fee_value,
          tx_fee_currency: "ATR",
          A1_price: ratesObj?.atr?.usd ?? 2,
          tx_options: {
            method: "manual",
            currency: "ATR",
            rate,
          },
        }),
      ]);
      const contract = new web3.eth.Contract(minABI, tokenAddress);
      const tokenAmountInWei = web3.utils.toWei(
        balanceMinusFee?.toString(),
        "ether"
      );
      const transfer = contract.methods.transfer(address_to, tokenAmountInWei);

      const encodedABI = transfer.encodeABI();

      const tx = {
        from: treasuryAddress,
        to: tokenAddress,
        data: encodedABI,
      };

      const gasLimit = await web3.eth.estimateGas(tx);

      tx.gas = gasLimit;

      web3.eth.accounts.signTransaction(
        tx,
        process.env.TOKEN_HOLDER_TREASURY_PRIVATE_KEY,
        (err, signed) => {
          if (err) {
            console.log(err);
          } else {
            web3.eth
              .sendSignedTransaction(signed.rawTransaction)
              .on("receipt", async (receipt) => {
                await transactions.findOneAndUpdate(
                  { tx_hash: tx_hash },
                  { tx_status: "approved", tx_hash: receipt.transactionHash }
                );
              })
              .on("error", console.log);
          }
        }
      );
      return res.status(200).json({
        success: true,
        message: "successfull transaction",
        result: updatedMainAcc,
      });
    }

    if (mainAccount.assets[accountType] < amount) {
      return res
        .status(400)
        .json(main_helper.error_message("insufficient funds"));
    }

    const currency = accountType?.toUpperCase();
    const pendingWithdrawalAmount = treasury.pendingWithdrawals[currency] || 0;
    const currentIncomingAmount = treasury.incoming[currency] || 0;

    if (pendingWithdrawalAmount + amount > currentIncomingAmount) {
      return res
        .status(400)
        .json(
          main_helper.error_message(
            "Withdrawal with this amount is not possible at the moment",
            "Withdrawal with this amount is not possible at the moment"
          )
        );
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const [updatedMainAcc] = await Promise.all([
      accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { [`assets.${accountType}`]: 0 - amount } },
        { new: true }
      ),
      transactions.create({
        from: address,
        to: address_to,
        amount,
        tx_hash,
        tx_type: "withdraw",
        tx_currency: "ether",
        tx_status: "pending",
        A1_price: ratesObj?.atr?.usd ?? 2,
        tx_options: {
          method: "manual",
          currency: accountType,
          rate,
        },
      }),
      treasuries.findOneAndUpdate(
        {},
        {
          $inc: {
            [`pendingWithdrawals.${currency}`]: amount,
          },
        }
      ),
    ]);

    return res.status(200).json({
      success: true,
      message: "successfull transaction",
      result: updatedMainAcc,
    });
  } catch (e) {
    console.log(e, "make_withdrawal");
    return res
      .status(500)
      .send({ success: false, message: "internal server error" });
  }
}

async function direct_deposit(req, res) {
  try {
    let { hash } = req.body;

    let address = req.address;

    if (!address) {
      return res.status(400).json({ error: "you are not logged in" });
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const existingTransaction = await transactions.findOne({
      tx_external_hash: hash,
    });

    if (existingTransaction) {
      return res
        .status(400)
        .json({ error: "Transaction with this hash already exists." });
    }

    const [tx, ratesObj] = await Promise.all([
      web3.eth.getTransaction(hash),
      rates.findOne(),
    ]);

    const inputHex = tx.input;
    const functionSignature = inputHex.slice(0, 10);
    const encodedParameters = inputHex.slice(10);
    const decodedParameters = web3.eth.abi.decodeParameters(
      ["address", "uint256"],
      encodedParameters
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
          { new: true }
        ),
        transactions.create({
          from: address,
          to: address,
          amount: numberOfTokens / 10 ** 18,
          tx_hash,
          tx_type: "deposit",
          tx_currency: "ether",
          tx_status: "approved",
          tx_external_hash: hash,
          tx_options: {
            method: "direct",
          },
          A1_price: ratesObj?.atr?.usd ?? 2,
        }),
      ]);

      return main_helper.success_response(res, {
        message: "successfull transaction",
        updatedAccount,
      });
    } else {
      return res.status(200).json({
        success: true,
        message:
          "This transaction does not involve a transfer of custom tokens.",
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
    let { hash } = req.body;

    if (!hash)
      return res
        .status(400)
        .json(main_helper.error_message("hash is required"));

    const transaction = await transactions.findOne({ tx_hash: hash });

    if (!transaction)
      return res
        .status(200)
        .json(main_helper.error_message("transaction not found"));

    return res.status(200).send({ success: true, transaction });
  } catch (e) {}
}

async function unstake_transaction(req, res) {
  try {
    let { index } = req.body;

    let address = req.address;

    if (!address)
      return res
        .status(400)
        .json(main_helper.error_message("you are not logged in"));

    if (typeof index !== "number")
      return res
        .status(400)
        .json(main_helper.error_message("index is required"));

    address = address.toLowerCase();

    const stakingContract = new web3.eth.Contract(
      STACK_ABI,
      process.env.STAKING_CONTRACT_ADDRESS
    );
    const result = await stakingContract.methods
      .stakersRecord(address, index)
      .call();

    if (!result.unstaked) {
      return res
        .status(400)
        .json(main_helper.error_message("not unstaked yet"));
    }

    const [mainAccount, ratesObj] = await Promise.all([
      accounts.findOne({
        account_owner: address,
        account_category: "main",
      }),
      rates.findOne(),
    ]);

    if (!mainAccount) {
      return res
        .status(400)
        .json(main_helper.error_message("main account not found"));
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    const [updatedAccount] = await Promise.all([
      accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { balance: 0 - result.amount / 10 ** 18 } },
        { new: true }
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
        A1_price: ratesObj?.atr?.usd ?? 2,
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
    let { fromAccType, fromAmount, toAccType, toAmount } = req.body;

    let address = req.address;

    if (!address)
      return res
        .status(400)
        .send({ success: false, message: "you are not logged in" });

    const [mainAccount, ratesObj] = await Promise.all([
      accounts.findOne({
        account_owner: address,
        account_category: "main",
      }),
      rates.findOne(),
    ]);

    if (!mainAccount) {
      return res
        .status(400)
        .send({ success: false, message: "main account not found" });
    }

    if (!mainAccount.active) {
      return res
        .status(400)
        .json(main_helper.error_message("main account is not active"));
    }

    if (fromAccType.toLowerCase() === toAccType.toLowerCase()) {
      return res.status(400).send({
        success: false,
        message: "from and to account type can not be same",
      });
    }

    if (fromAccType === "ATAR" && mainAccount.balance < fromAmount) {
      return res
        .status(400)
        .send({ success: false, message: "insufficient balance" });
    } else if (mainAccount.assets?.[fromAccType] < fromAmount) {
      return res
        .status(400)
        .send({ success: false, message: "insufficient balance" });
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    let query = null;
    if (fromAccType === "ATAR") {
      query = accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        { $inc: { balance: 0 - fromAmount, [`assets.${toAccType}`]: toAmount } }
      );
    } else if (toAccType === "ATAR") {
      query = accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        {
          $inc: {
            balance: toAmount,
            [`assets.${fromAccType}`]: 0 - fromAmount,
          },
        }
      );
    } else {
      query = accounts.findOneAndUpdate(
        { account_owner: address, account_category: "main" },
        {
          $inc: {
            [`assets.${fromAccType}`]: 0 - fromAmount,
            [`assets.${toAccType}`]: toAmount,
          },
        }
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
        A1_price: ratesObj?.atr?.usd ?? 2,
      }),
    ]);

    return res.status(200).send({ success: true, result: mainAccountUpdated });
  } catch (e) {
    console.log(e, "exchange");
    return res
      .status(500)
      .send({ success: false, message: "internal server error" });
  }
}

async function stakeCurrency(req, res) {
  try {
    let addr = req.address;
    let { amount, currency, percentage = 0, duration } = req.body;

    if (!addr) {
      return main_helper.error_response(res, "You are not logged in");
    }

    if (!amount || !currency) {
      return main_helper.error_response(
        res,
        "amount, and currency are required"
      );
    }

    const address = addr.toLowerCase();
    amount = Number(amount);

    const [mainAccount, ratesObj] = await Promise.all([
      accounts.findOne({
        account_owner: address,
        account_category: "main",
      }),
      rates.findOne(),
    ]);

    if (!mainAccount) {
      return main_helper.error_response(res, "account not found");
    }

    if (mainAccount.assets[currency] < amount) {
      return main_helper.error_response(res, "insufficient balance");
    }

    let expires;
    if (duration === "360 D") {
      expires = Date.now() + 360 * 24 * 60 * 60 * 1000;
    } else if (duration === "180 D") {
      expires = Date.now() + 180 * 24 * 60 * 60 * 1000;
    } else if (duration === "90 D") {
      expires = Date.now() + 90 * 24 * 60 * 60 * 1000;
    } else if (duration === "30 D") {
      expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    }

    const updateAccountPromise = accounts.findOneAndUpdate(
      { account_owner: address, account_category: "main" },
      {
        $inc: {
          [`assets.${currency}Staked`]: amount,
          [`assets.${currency}`]: -amount,
        },
      },
      { new: true }
    );

    const createStakePromise = currencyStakes.create({
      address,
      amount: amount,
      currency,
      percentage,
      expires,
    });
    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();
    const createTransactionPromice = transactions.create({
      from: address,
      to: address,
      amount: amount,
      tx_hash,
      tx_status: "approved",
      tx_type: "currency stake",
      denomination: 0,
      tx_fee: 0,
      tx_fee_currency: "atar",
      tx_currency: "currency",
      tx_options: {
        amount: amount,
        currency,
        percentage,
        expires,
      },
      A1_price: ratesObj?.atr?.usd ?? 2,
    });

    const [updatedAccount, createdStake, createTransaction] = await Promise.all(
      [updateAccountPromise, createStakePromise, createTransactionPromice]
    );

    if (!createdStake) {
      return main_helper.error_response(res, "error staking currency");
    }

    return main_helper.success_response(res, updatedAccount);
  } catch (e) {
    console.log(e, "error staking currency");
    return main_helper.error_response(res, "error staking currency");
  }
}

async function get_currency_stakes(req, res) {
  try {
    let address = req.address;

    if (!address) {
      return main_helper.error_response(res, "You are not logged in");
    }

    const stakes = await currencyStakes.find({ address });

    return main_helper.success_response(res, stakes);
  } catch (e) {
    console.log(e);
    return main_helper.error_response(res, "error getting currency stakes");
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
  stakeCurrency,
  get_currency_stakes,
  verify_external_transaction,
  create_exchange_transaction,
  get_exchange_status,
  check_transactions_for_pending,
};
