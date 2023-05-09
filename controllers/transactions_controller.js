const main_helper = require("../helpers/index");
const global_helper = require("../helpers/global_helper");
const {
  transaction_types,
  transactions,
  accounts,
  referral_links,
  referral_uni_users,
  referral_binary_users,
  options,
} = require("@cubitrix/models");
// var Web3 = require("web3");

async function deposit_transaction(req, res) {
  try {
    //doesnt increase amount just creates log in transaction history and distributes referral bonus
    let { from, amount, tx_currency, tx_type } = req.body;
    if (!from)
      return res
        .status(400)
        .json(main_helper.error_message("from is required"));
    from = from.toLowerCase();
    amount = parseFloat(amount);
    let tx_hash_generated = global_helper.make_hash();

    let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

    let tx_type_db = await get_tx_type(tx_type);
    let tx_global_currency = await global_helper.get_option_by_key(
      "global_currency"
    );
    let tx_fee_currency = tx_global_currency?.data?.value;
    let tx_wei = tx_type_db?.data?.tx_fee;
    let tx_fee_value = await global_helper.calculate_tx_fee(
      tx_wei,
      tx_fee_currency
    );

    let tx_fee = tx_fee_value?.data;
    let denomination = 0;

    if (!(tx_type_db.success && tx_global_currency.success)) {
      return main_helper.error_response(
        res,
        "such kind of transaction type is not defined."
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

async function create_deposit_transaction(from, amount, tx_currency, tx_type) {
  from = from.toLowerCase();
  amount = parseFloat(amount);
  let tx_hash_generated = global_helper.make_hash();

  let tx_hash = ("0x" + tx_hash_generated).toLowerCase();

  let tx_type_db = await get_tx_type(tx_type);
  let tx_global_currency = await global_helper.get_option_by_key(
    "global_currency"
  );
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

  const wtf = await deposit_referral_bonus(createdTransaction, tx_hash);

  return { message: "transaction created", data: createdTransaction, wtf };
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
    let tx_global_currency = await global_helper.get_option_by_key(
      "global_currency"
    );
    let tx_fee_currency = tx_global_currency?.data?.value;
    let tx_wei = tx_type_db?.data?.tx_fee;
    let tx_fee_value = await global_helper.calculate_tx_fee(
      tx_wei,
      tx_fee_currency
    );
    let tx_fee = tx_fee_value.data;
    let denomination = 0;

    if (tx_type == "withdraw") {
      try {
        if (!from && !amount && !tx_currency) {
          return main_helper.error_response(
            res,
            "please provide all necessary values"
          );
        }
        let account = await accounts.findOne({ address: from });
        to = account.account_owner;
        if (!to || account.active === false) {
          return main_helper.error_response(
            res,
            "Cannot withdraw from this account"
          );
        }
      } catch (e) {
        console.log(e.message);
        return main_helper.error_response(res, "error saving transaction");
      }
    }
    if (tx_type == "deposit") {
      try {
        if (!to && !amount && !tx_currency) {
          return main_helper.error_response(
            res,
            "please provide all necessary values"
          );
        }
        let account = await accounts.findOne({
          account_owner: to,
        });
        from = account.account_owner;

        if (!from || account.active === false) {
          return main_helper.error_response(
            res,
            "Cannot deposit to this account"
          );
        }
      } catch (e) {
        console.log(e.message);
        return main_helper.error_response(res, "error saving transaction");
      }
    }
    if (tx_type == "transfer") {
      try {
        if (!from && !to && !amount && !tx_type && !tx_currency) {
          return main_helper.error_response(
            res,
            "please provide all necessary values"
          );
        }
        let account = await accounts.findOne({
          address: to,
        });
        from = account.account_owner;
        if (!from || account.active === false) {
          return main_helper.error_response(
            res,
            "Cannot deposit to this account"
          );
        }
      } catch (e) {
        console.log(e.message);
        return main_helper.error_response(res, "error saving transaction");
      }
    }
    let check_from_address_exists = await global_helper.check_if_address_exists(
      from
    );
    let check_to_address_exists = await global_helper.check_if_address_exists(
      to
    );
    if (!check_from_address_exists && !check_to_address_exists) {
      return main_helper.error_response(
        res,
        "we dont have such address registered in our system."
      );
    }

    if (!(tx_type_db.success && tx_global_currency.success)) {
      return main_helper.error_response(
        res,
        "such kind of transaction type is not defined."
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
    //   account_type_from,
    //   get_from_account_balance_value - (tx.amount + parseFloat(tx.tx_fee)),
    // );
    // await global_helper.set_account_balance(
    //   tx.to,
    //   account_type_to,
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
    let get_from_account_balance = await global_helper.get_account_balance(
      tx.from,
      account_type_from
    );
    let referral_resp;
    let get_to_account_balance = await global_helper.get_account_balance(
      tx.to,
      account_type_to
    );

    if (status == "approve") {
      if (tx.tx_status == "pending") {
        if (
          !get_from_account_balance.success ||
          get_from_account_balance.data == null ||
          get_from_account_balance.data < tx.amount + parseFloat(tx.tx_fee)
        ) {
          return main_helper.error_response(
            res,
            "there is no sufficient amount on your balance"
          );
        }
        let get_from_account_balance_value = parseFloat(
          get_from_account_balance?.data
        );
        let get_to_account_balance_value = parseFloat(
          get_to_account_balance?.data
        );
        await global_helper.set_account_balance(
          tx.from,
          account_type_from,
          get_from_account_balance_value - (tx.amount + parseFloat(tx.tx_fee))
        );
        await global_helper.set_account_balance(
          tx.to,
          account_type_to,
          (get_to_account_balance_value ? get_to_account_balance_value : 0) +
            tx.amount
        );
        let tx_updated = await transactions.findOneAndUpdate(
          { tx_hash: tx_hash },
          { tx_status: "approved" }
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
          "Transaction already approved, can not change status anymore"
        );
      }
    }
    if (status == "cancel") {
      if (tx.tx_status == "approved") {
        return main_helper.error_response(
          res,
          "Transaction approved and can not change status"
        );
      } else {
        let tx_updated = await transactions.findOneAndUpdate(
          { tx_hash: tx_hash },
          { tx_status: "cancelled" }
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
  let referral_options = await global_helper.get_option_by_key(
    "referral_options"
  );
  referral_options = referral_options?.data;
  if (referral_options.object_value.referral_activated == "none") {
    return false;
  }
  let user_account = await accounts.findOne({ address: tx.from });
  let resp_data = [];
  let from_bonus = user_account.account_owner
    ? user_account.account_owner
    : user_account.address;
  let account_type_uni_from = await global_helper.get_type_by_address(
    from_bonus
  );
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
        tx
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
        tx
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
  tx
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
    let tx_save_uni = await transactions.create({
      tx_hash: ("0x" + tx_hash_generated).toLowerCase(),
      to: to_address,
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
        { $inc: { balance: tx_amount } }
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
  tx
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
      "referral_bonus_binary_level_" + (i + 1)
    );
    if (
      already_taken_bonus + tx_amount <=
      referral_options?.object_value[lba]
    ) {
      let tx_hash_generated = global_helper.make_hash();
      if (tx.to != to_address) {
        let tx_save_binary = await transactions.create({
          tx_hash: ("0x" + tx_hash_generated).toLowerCase(),
          to: to_address,
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
            { $inc: { balance: tx_amount } }
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

module.exports = {
  make_transaction,
  update_transaction_status,
  deposit_transaction,
  create_deposit_transaction,
  create_global_option,
  update_options,
};
