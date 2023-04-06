const transactions = require("./routes/transactions");
const create_deposit_transaction =
  require("./controllers/transactions_controller").create_deposit_transaction;

module.exports = {
  transactions: transactions,
  create_deposit_transaction,
};
