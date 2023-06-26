const { accounts } = require("@cubitrix/models");
const main_helper = require("../helpers/index");

// get account balance
async function get_account_balance(address) {
  try {
    let balance = await accounts.find({ address, account_category: "main" });
    if (balance) {
      return main_helper.return_data(true, balance.balance);
    }
    return main_helper.error_message("error");
  } catch (e) {
    console.log(e.message);
    return main_helper.error_message("error");
  }
}
y;
module.exports = {
  get_account_balance,
};
