const main_helper = require("../helpers/index");
var Web3 = require("web3");
const { options, accounts, account_meta } = require("@cubitrix/models");
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
    if (currency == "ATR") {
      return 2;
    }
    const value = Web3.utils.fromWei(wei.toString(), currency);
    return main_helper.return_data(true, value);
  } catch (e) {
    console.log("calculate_tx_fee:", e.message);
    return main_helper.error_message("error calculating tx_fee");
  }
}
// get account balance

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
// get account type by name
async function get_account_by_address(address) {
  try {
    let account_address = await account_meta
      .findOne({ address: address })
      .exec();

    if (account_address) {
      let type_id = account_address._id;
      return type_id.toString();
    }
    return 0;
  } catch (e) {
    return main_helper.error_message(e.message);
  }
}

module.exports = {
  get_option_by_key,
  calculate_tx_fee,
  make_hash,
  get_account_by_address,
};
