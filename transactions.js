const transactions = require("./routes/transactions");
const deposit_transaction =
  require("./controllers/transactions_controller").make_transaction;

module.exports = {
  transactions: transactions,
  deposit_transaction,
};
