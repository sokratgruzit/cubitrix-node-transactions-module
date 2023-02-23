const main_helper = require("../helpers/index");
const global_helper = require("../helpers/global_helper");
const {
  transaction_types,
  transactions,
  accounts,
} = require("@cubitrix/models");
// var Web3 = require("web3");

// make_transaction
async function make_transaction(req, res) {
  try {
    let { from, to, amount, tx_type, tx_currency } = req.body;
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
        if (!to || !account.active) {
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
          address: to,
        });
        from = account.account_owner;
        if (!from || !account.active) {
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
        if (!from || !account.active) {
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
      tx_status: "pending",
      tx_type,
      denomination,
      tx_fee,
      tx_fee_currency,
      tx_currency,
    });
    if (tx_save) {
      return main_helper.success_response(res, tx_save);
    }
    return main_helper.error_response(res, "error saving transaction");
  } catch (e) {
    console.log(e.message);
    return main_helper.error_response(res, "error saving transaction");
  }
}
async function update_transaction_status(req, res) {
  try {
    let { tx_hash, status } = req.body;
    let tx = await transactions.findOne({ tx_hash: tx_hash }).exec();
    let account_type_from = await global_helper.get_type_by_address(tx.from);
    let account_type_to = await global_helper.get_type_by_address(tx.to);
    let get_from_account_balance = await global_helper.get_account_balance(
      tx.from,
      account_type_from
    );
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
          return main_helper.success_response(res, "Transaction approved");
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
module.exports = {
  make_transaction,
  update_transaction_status,
};
