const main_helper = require("../helpers/index");
var Web3 = require("web3");
const { options, accounts } = require("@cubitrix/models");
const { ObjectId } = require("mongodb");
async function get_option_by_key(key) {
  try {
    let option = await options.findOne({ key });
    if (option) {
      return {
        success: true,
        data: option,
      };
    }
    return {
      success: false,
      data: null,
    };
  } catch (e) {
    console.log("get_option_by_key:", e.message);
    return {
      success: false,
      data: null,
    };
  }
}
async function calculate_tx_fee(wei = 21000, currency = "ether") {
  try {
    const value = Web3.utils.fromWei(wei.toString(), currency);
    return main_helper.return_data(true, value);
  } catch (e) {
    console.log("calculate_tx_fee:", e.message);
    return main_helper.error_message("error calculating tx_fee");
  }
}
async function check_if_address_exists(address) {
  try {
    const check_address = await accounts.findOne({ address });
    if (check_address) {
      return true;
    }
    return false;
  } catch (e) {
    console.log("check_if_address_exists:", e.message);
    return main_helper.error_message("error checking address");
  }
}
// get account balance
async function get_account_balance(address, account_type_id) {
  try {
    account_type_id = ObjectId(account_type_id);
    let balance = await accounts.findOne({ address: address, account_type_id });
    if (balance) {
      return main_helper.return_data(true, balance.balance);
    }
    return main_helper.error_message("error");
  } catch (e) {
    console.log(e.message);
    return main_helper.error_message("error");
  }
}
// set account balance
async function set_account_balance(address, account_type_id, balance) {
  try {
    let balance_update = await accounts.findOneAndUpdate(
      { address, account_type_id },
      { address, account_type_id, balance }
    );
    if (balance_update) {
      return main_helper.success_message("balance updated");
    }
    return main_helper.error_message("error");
  } catch (e) {
    console.log(e.message);
    return main_helper.error_message("error");
  }
}
// get account type by address
async function get_type_by_address(address) {
  try {
    let type = await accounts.findOne({ address: address }).exec();

    if (type) {
      let type_id = type.account_type_id;
      return type_id.toString();
    }
    /*else {
      await account_types.create({ name: type_name }).exec();
      type = await account_types.findOne({ name: type_name }).exec();
      return type._id;
    }*/
    return 0;
  } catch (e) {
    return main_helper.error_message(e.message);
  }
}
// get account type by name
async function get_type_by_name(address) {
  try {
    let type = await accounts.findOne({ name: name }).exec();

    if (type) {
      let type_id = type.account_type_id;
      return type_id.toString();
    }
    /*else {
      await account_types.create({ name: type_name }).exec();
      type = await account_types.findOne({ name: type_name }).exec();
      return type._id;
    }*/
    return 0;
  } catch (e) {
    return main_helper.error_message(e.message);
  }
}
function make_hash(length = 66) {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

module.exports = {
  get_option_by_key,
  calculate_tx_fee,
  check_if_address_exists,
  get_account_balance,
  set_account_balance,
  get_type_by_address,
  make_hash,
};
