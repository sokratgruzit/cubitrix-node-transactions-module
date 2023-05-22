const express = require("express");
const router = express();
const transactions_controller = require("../controllers/transactions_controller");

const cookieParser = require("cookie-parser");

router.use(cookieParser());
router.post("/make_transaction", transactions_controller.make_transaction);
router.post(
  "/update_transaction_status",
  transactions_controller.update_transaction_status,
);

router.post("/deposit_transaction", transactions_controller.deposit_transaction);

router.post(
  "/pending_deposit_transaction",
  transactions_controller.pending_deposit_transaction,
);

router.post(
  "/coinbase_deposit_transaction",
  transactions_controller.coinbase_deposit_transaction,
);

module.exports = router;
