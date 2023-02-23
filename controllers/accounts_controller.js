const { accounts } = require("@cubitrix/models");
const main_helper = require("../helpers/index");

// get account balance
async function get_account_balance(address, account_type_id) {
  try {
    let balance = await accounts.find({ address, account_type_id });
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

module.exports = {
  get_account_balance,
  set_account_balance,
};
