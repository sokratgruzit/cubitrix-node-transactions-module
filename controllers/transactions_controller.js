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
} = require("@cubitrix/models");

require("dotenv").config();

var Webhook = require("coinbase-commerce-node").Webhook;

const jwt = require("jsonwebtoken");

const axios = require("axios");

async function deposit_transaction(req, res) {
  try {
    let { from, amount, tx_currency, tx_type } = req.body;
    if (!from) return res.status(400).json(main_helper.error_message("from is required"));
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

    if (!(tx_type_db.success && tx_global_currency.success)) {
      return main_helper.error_response(
        res,
        "such kind of transaction type is not defined.",
      );
    }

    if (!tx_fee_currency && !tx_wei) {
      return main_helper.error_response(res, {
        message: "fee currency is not defined",
      });
    }
    if (!tx_fee_value.success) {
      return main_helper.error_response(res, { message: tx_fee_value.message });
    }

    let account = await accounts.findOne({ address: from });

    if (!account) {
      return main_helper.error_response(res, {
        message: "Account with this address doesn't exist",
      });
    }

    const createdTransaction = await transactions.create({
      from,
      to: from,
      amount,
      tx_hash,
      tx_status: "approved",
      tx_type,
      denomination,
      tx_fee,
      tx_fee_currency,
      tx_currency,
    });

    const bonus = await deposit_referral_bonus(createdTransaction, tx_hash);

    return res.status(200).json({
      message: "transaction created",
      data: createdTransaction,
      bonus,
    });
  } catch (e) {
    console.log(e.message);
    res.status(500).send({ success: false, message: "something went wrong" });
  }
}

async function get_transactions_of_user(req, res) {
  try {
    const req_body = await req.body;
    const req_page = req_body.page ? req_body.page : 1;
    const limit = req_body.limit ? req_body.limit : 10;
    const account_type = req_body?.account ? req_body?.account : "all";
    const method_type = req_body?.type ? req_body?.type : "all";
    const date_type = req_body?.time ? req_body?.time : "all";
    const address = req_body?.address;
    if (!address) {
      return res.status(500).send({ success: false, message: "address not provided" });
    }
    let accounts_list = await accounts.find(
      {
        $or: [{ address: address }, { account_owner: address }],
      },
      { address: 1, _id: 0, account_category: 1 },
    );
    let addr_arr = [];
    for (let i = 0; i < accounts_list.length; i++) {
      if (account_type == "all") {
        addr_arr.push(accounts_list[i].address);
      } else {
        if (accounts_list[i].account_category == account_type) {
          addr_arr.push(accounts_list[i].address);
        }
      }
    }
    const pipeline = [
      {
        $facet: {
          toCount: [
            {
              $match: {
                to: { $in: addr_arr },
              },
            },
            {
              $count: "toCount",
            },
          ],
          fromSum: [
            {
              $match: {
                from: { $in: addr_arr },
              },
            },
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
              },
            },
          ],
        },
      },
      {
        $project: {
          toCount: { $arrayElemAt: ["$toCount.toCount", 0] },
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
      amounts_to_from,
    });
  } catch (e) {
    console.log(e.message);
    return res.status(500).send({ success: false, message: "something went wrong" });
  }
}

async function create_deposit_transaction(from, amount, tx_currency, tx_type) {
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

  const createdTransaction = await transactions.create({
    from,
    to: from,
    amount,
    tx_hash,
    tx_status: "approved",
    tx_type,
    denomination,
    tx_fee,
    tx_fee_currency,
    tx_currency,
  });

  const deposit_referral = await deposit_referral_bonus(createdTransaction, tx_hash);

  return {
    message: "transaction created",
    data: createdTransaction,
    deposit_referral,
  };
}
// make_transaction
async function make_transaction(req, res) {
  try {
    let { from, to, amount, tx_type, tx_currency } = req.body;
    if (from) from = from.toLowerCase();
    if (to) to = to.toLowerCase();
    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();
    let tx_type_db = await get_tx_type(tx_type);
    amount = parseFloat(amount);
    let tx_global_currency = await global_helper.get_option_by_key("global_currency");
    let tx_fee_currency = tx_global_currency?.data?.value;
    let tx_wei = tx_type_db?.data?.tx_fee;
    let tx_fee_value = await global_helper.calculate_tx_fee(tx_wei, tx_fee_currency);
    let tx_fee = tx_fee_value.data;
    let denomination = 0;

    if (tx_type == "withdraw") {
      try {
        if (!from && !amount && !tx_currency) {
          return main_helper.error_response(res, "please provide all necessary values");
        }
        let account = await accounts.findOne({ address: from });
        to = account.account_owner;
        if (!to || account.active === false) {
          return main_helper.error_response(res, "Cannot withdraw from this account");
        }
      } catch (e) {
        console.log(e.message);
        return main_helper.error_response(res, "error saving transaction");
      }
    }
    if (tx_type == "deposit") {
      try {
        if (!to && !amount && !tx_currency) {
          return main_helper.error_response(res, "please provide all necessary values");
        }
        let account = await accounts.findOne({
          account_owner: to,
        });
        from = account.account_owner;

        if (!from || account.active === false) {
          return main_helper.error_response(res, "Cannot deposit to this account");
        }
      } catch (e) {
        console.log(e.message);
        return main_helper.error_response(res, "error saving transaction");
      }
    }
    if (tx_type == "transfer") {
      try {
        if (!from && !to && !amount && !tx_type && !tx_currency) {
          return main_helper.error_response(res, "please provide all necessary values");
        }
        let account = await accounts.findOne({
          address: to,
        });
        from = account.account_owner;
        if (!from || account.active === false) {
          return main_helper.error_response(res, "Cannot deposit to this account");
        }
      } catch (e) {
        console.log(e.message);
        return main_helper.error_response(res, "error saving transaction");
      }
    }
    let check_from_address_exists = await global_helper.check_if_address_exists(from);
    let check_to_address_exists = await global_helper.check_if_address_exists(to);
    if (!check_from_address_exists && !check_to_address_exists) {
      return main_helper.error_response(
        res,
        "we dont have such address registered in our system.",
      );
    }

    if (!(tx_type_db.success && tx_global_currency.success)) {
      return main_helper.error_response(
        res,
        "such kind of transaction type is not defined.",
      );
    }

    if (!tx_fee_currency && !tx_wei) {
      return main_helper.error_response(res, "fee currency is not defined");
    }
    if (!tx_fee_value.success) {
      return main_helper.error_response(res, tx_fee_value.message);
    }
    let tx_save = await transactions.create({
      from,
      to,
      amount,
      tx_hash,
      tx_status: "approved",
      tx_type,
      denomination,
      tx_fee,
      tx_fee_currency,
      tx_currency,
    });

    // if (tx_save.tx_type == "deposit") {
    //   referral_resp = await deposit_referral_bonus(tx, tx_save.tx_hash);
    // }
    // return main_helper.success_response(res, {
    //   message: "Transaction approved",
    //   referral_resp,
    // });

    // if (tx.tx_status == "pending") {
    // if (
    //   !get_from_account_balance.success ||
    //   get_from_account_balance.data == null ||
    //   get_from_account_balance.data < tx.amount + parseFloat(tx.tx_fee)
    // ) {
    //   return main_helper.error_response(
    //     res,
    //     "there is no sufficient amount on your balance",
    //   );
    // }
    // let get_from_account_balance_value = parseFloat(get_from_account_balance?.data);
    // let get_to_account_balance_value = parseFloat(get_to_account_balance?.data);
    // await global_helper.set_account_balance(
    //   tx.from,
    //   get_from_account_balance_value - (tx.amount + parseFloat(tx.tx_fee)),
    // );
    // await global_helper.set_account_balance(
    //   tx.to,
    //   (get_to_account_balance_value ? get_to_account_balance_value : 0) + tx.amount,
    // );
    // }
    if (!tx_save) {
      return main_helper.error_response(res, {
        message: "error saving transaction",
      });
    }
    return main_helper.success_response(res, {
      message: "successfull transaction",
      data: tx_save,
    });
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error saving transaction");
  }
}

async function submit_transaction(req, res) {
  try {
    let { from, to, amount, tx_currency } = req.body;
    if (!from && !to && !amount && !tx_currency) {
      return main_helper.error_response(res, "please provide all necessary values");
    }

    from = from.toLowerCase();
    to = to.toLowerCase();
    amount = parseFloat(amount);

    let account_from = await accounts.findOne({
      address: from,
    });

    let account_to = await accounts.findOne({
      address: to,
    });

    if (!account_from || !account_to) {
      return main_helper.error_response(res, "Can't find account with this address");
    }

    if (!account_from.active || !account_to.active) {
      return main_helper.error_response(res, "Both accounts must be active");
    }

    const { balance: account_from_balance } = await accounts.findOne({
      address: from,
    });

    let tx_type;

    if (account_to.account_category === "external") {
      tx_type = "withdraw";
    } else if (
      account_from.account_owner === account_to.account_owner ||
      account_from.address === account_to.account_owner
    ) {
      tx_type = "internal_transfer";
    } else if (account_to.address === account_from.address) {
      tx_type = "deposit";
    } else {
      tx_type = "transfer";
    }

    let tx_hash_generated = global_helper.make_hash();
    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();
    let tx_type_db = await get_tx_type(tx_type);

    if (!tx_type_db.success) {
      return main_helper.error_response(
        res,
        "such kind of transaction type is not defined.",
      );
    }

    let tx_global_currency = await global_helper.get_option_by_key("global_currency");
    let tx_fee_currency = tx_global_currency?.data?.value;
    let tx_wei = tx_type_db?.data?.tx_fee;
    let tx_fee_value = await global_helper.calculate_tx_fee(tx_wei, tx_fee_currency);
    let tx_fee = parseFloat(tx_fee_value.data);
    let denomination = 0;

    let total_amount_necessary = amount + tx_fee;

    if (!(account_from_balance >= total_amount_necessary)) {
      return main_helper.error_response(
        res,
        "there is no sufficient amount on your balance",
      );
    }

    const fromBalanceUpdated = await global_helper.set_account_balance(
      from,
      -total_amount_necessary,
    );

    const toBalanceUpdated = await global_helper.set_account_balance(to, amount);

    if (!fromBalanceUpdated.success || !toBalanceUpdated.success) {
      return main_helper.error_response(
        res,
        "balance update failed, please try again later",
      );
    }

    let tx_save = await transactions.create({
      from,
      to,
      amount,
      tx_hash,
      tx_status: "approved",
      tx_type,
      denomination,
      tx_fee,
      tx_fee_currency,
      tx_currency,
    });

    if (!tx_save) {
      return main_helper.error_response(res, {
        message: "error saving transaction",
      });
    }

    return main_helper.success_response(res, {
      message: "successful transaction",
      data: tx_save,
    });
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error submitting transaction");
  }
}

async function update_transaction_status(req, res) {
  try {
    let { tx_hash, status } = req.body;
    let tx = await transactions.findOne({ tx_hash: tx_hash }).exec();

    // return main_helper.success_response(
    //   res,
    //   await deposit_referral_bonus(tx, tx_hash)pending
    // );

    let account_type_from = await global_helper.get_type_by_address(tx.from);
    let account_type_to = await global_helper.get_type_by_address(tx.to);
    let get_from_account_balance = await global_helper.get_account_balance(tx.from);
    let referral_resp;
    let get_to_account_balance = await global_helper.get_account_balance(tx.to);

    if (status == "approve") {
      if (tx.tx_status == "pending") {
        if (
          !get_from_account_balance.success ||
          get_from_account_balance.data == null ||
          get_from_account_balance.data < tx.amount + parseFloat(tx.tx_fee)
        ) {
          return main_helper.error_response(
            res,
            "there is no sufficient amount on your balance",
          );
        }
        let get_from_account_balance_value = parseFloat(get_from_account_balance?.data);
        let get_to_account_balance_value = parseFloat(get_to_account_balance?.data);
        await global_helper.set_account_balance(
          tx.from,
          get_from_account_balance_value - (tx.amount + parseFloat(tx.tx_fee)),
        );
        await global_helper.set_account_balance(
          tx.to,
          (get_to_account_balance_value ? get_to_account_balance_value : 0) + tx.amount,
        );
        let tx_updated = await transactions.findOneAndUpdate(
          { tx_hash: tx_hash },
          { tx_status: "approved" },
        );
        if (tx_updated) {
          if (tx.tx_type == "deposit") {
            referral_resp = await deposit_referral_bonus(tx, tx_hash);
          }
          return main_helper.success_response(res, {
            message: "Transaction approved",
            referral_resp,
          });
        }
      } else {
        return main_helper.error_response(
          res,
          "Transaction already approved, can not change status anymore",
        );
      }
    }
    if (status == "cancel") {
      if (tx.tx_status == "approved") {
        return main_helper.error_response(
          res,
          "Transaction approved and can not change status",
        );
      } else {
        let tx_updated = await transactions.findOneAndUpdate(
          { tx_hash: tx_hash },
          { tx_status: "cancelled" },
        );
        if (tx_updated) {
          return main_helper.success_response(res, "Transaction cancelled");
        }
      }
    }
    return main_helper.error_response(res, "Transaction hash not found");
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error");
  }
}

async function deposit_referral_bonus(tx, tx_hash) {
  let referral_options = await global_helper.get_option_by_key("referral_options");
  referral_options = referral_options?.data;
  if (referral_options.object_value.referral_activated == "none") {
    return false;
  }
  let user_account = await accounts.findOne({ address: tx.from });
  let resp_data = [];
  let from_bonus = user_account.account_owner
    ? user_account.account_owner
    : user_account.address;
  let account_type_uni_from = await global_helper.get_type_by_address(from_bonus);
  let user_id = await global_helper.get_account_by_address(from_bonus);
  if (
    referral_options.object_value.referral_activated == "all" ||
    referral_options.object_value.referral_activated == "uni"
  ) {
    let user_has_ref_uni = await referral_uni_users.findOne({
      user_id,
    });

    if (user_has_ref_uni) {
      let uni_tx = await send_uni_referral_transaction(
        user_has_ref_uni,
        referral_options,
        tx_hash,
        account_type_uni_from,
        tx,
      );
      resp_data.push({ uni: uni_tx });
    } else {
      resp_data.push({ uni: null });
    }
  }
  if (
    referral_options.object_value.referral_activated == "all" ||
    referral_options.object_value.referral_activated == "binary"
  ) {
    let user_has_ref_binary = await referral_binary_users.find({
      user_id,
    });

    if (user_has_ref_binary.length > 0) {
      let binary_tx = await send_binary_referral_transaction(
        user_has_ref_binary,
        referral_options,
        tx_hash,
        account_type_uni_from,
        tx,
      );

      resp_data.push({ binary: binary_tx });
    } else {
      resp_data.push({ binary: null });
    }
  }

  return resp_data;
}

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
    let to_system = await accounts.findOne({
      $or: [{ account_owner: to_address }, { address: to_address }],
      account_category: "system",
    });
    let tx_save_uni = await transactions.create({
      tx_hash: ("0x" + tx_hash_generated).toLowerCase(),
      to: to_system?.address,
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
        { account_owner: to_address, account_category: "system" },
        { $inc: { balance: tx_amount } },
      );
    }
  }
  return false;
}

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
        let to_system = await accounts.findOne({
          $or: [{ account_owner: to_address }, { address: to_address }],
          account_category: "system",
        });
        let tx_save_binary = await transactions.create({
          tx_hash: ("0x" + tx_hash_generated).toLowerCase(),
          to: to_system?.address,
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
            { account_owner: to_address, account_category: "system" },
            { $inc: { balance: tx_amount } },
          );
          binary_bonus_txs.push(tx_save_binary);
        }
      }
    }
  }
  return binary_bonus_txs;
}

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

async function pending_deposit_transaction(req, res) {
  try {
    let { from, amount, amountTransferedFrom, receivePaymentAddress, startDate } =
      req.body;

    if (!from) return res.status(400).json(main_helper.error_message("from is required"));
    from = from.toLowerCase();

    const tx_hash = global_helper.make_hash();

    const transaction = await transactions.create({
      from,
      to: from,
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

async function coinbase_deposit_transaction(req, res) {
  try {
    let { from, amount } = req.body;
    if (!from) return res.status(400).json(main_helper.error_message("from is required"));
    from = from.toLowerCase();
    const tx_hash = global_helper.make_hash();

    await transactions.create({
      from,
      to: from,
      amount,
      tx_hash,
      tx_type: "deposit",
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
        usdt: true,
      },
      redirect_url: `http://localhost:3000/`,
      cancel_url: `http://localhost:3000/`,
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

const Web3 = require("web3");
const web3 = new Web3("https://data-seed-prebsc-1-s1.binance.org:8545/");

const minABI = require("../abi/WBNB.json");

const account1 = "0xA3403975861B601aE111b4eeAFbA94060a58d0CA";
var tokenAddress = "0xE807fbeB6A088a7aF862A2dCbA1d64fE0d9820Cb"; // Staking Token Address

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
      try {
        const contract = new web3.eth.Contract(minABI, tokenAddress);
        const tokenAmountInWei = web3.utils.toWei(amount, "ether");
        const transfer = contract.methods.transfer(metadata?.address, tokenAmountInWei);

        const encodedABI = transfer.encodeABI();
        const tx = {
          from: account1,
          to: tokenAddress,
          gas: 2000000,
          data: encodedABI,
        };

        web3.eth.accounts.signTransaction(
          tx,
          process.env.METAMASK_PRIVATE,
          (err, signed) => {
            if (err) {
              console.log(err);
            } else {
              web3.eth
                .sendSignedTransaction(signed.rawTransaction)
                .on("receipt", console.log);
            }
          },
        );
      } catch (e) {
        console.log(e);
      }
    }

    if (event.type === "charge:failed") {
      let metadata = event.data.metadata;
      await transactions.findOneAndUpdate(
        { tx_hash: metadata.tx_hash },
        { tx_status: "canceled" },
      );
    }

    console.log(event.type);

    console.log(event.type);
  } catch (e) {
    console.log(e);
  }
}
module.exports = {
  make_transaction,
  update_transaction_status,
  deposit_transaction,
  create_deposit_transaction,
  pending_deposit_transaction,
  coinbase_deposit_transaction,
  create_global_option,
  update_options,
  submit_transaction,
  coinbase_webhooks,
  get_transactions_of_user,
};
