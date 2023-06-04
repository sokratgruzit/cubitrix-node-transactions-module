const express = require("express");
const router = express();
const transactions_controller = require("../controllers/transactions_controller");

const cookieParser = require("cookie-parser");

router.use(cookieParser());
router.post("/make_transaction", transactions_controller.make_transaction);
router.post(
  "/update_transaction_status",
  transactions_controller.update_transaction_status
);

router.post(
  "/deposit_transaction",
  transactions_controller.deposit_transaction
);

router.post(
  "/create_global_option",
  transactions_controller.create_global_option
);

router.post("/update_options", transactions_controller.update_options);

router.post("/submit_transaction", transactions_controller.submit_transaction);

router.post(
  "/pending_deposit_transaction",
  transactions_controller.pending_deposit_transaction
);

router.post(
  "/coinbase_deposit_transaction",
  transactions_controller.coinbase_deposit_transaction
);

router.post(
  "/cancel_coinbase_deposit_transaction",
  transactions_controller.cancel_coinbase_deposit_transaction
);

router.post("/coinbase_webhooks", transactions_controller.coinbase_webhooks);
router.post(
  "/get_transactions_of_user",
  transactions_controller.get_transactions_of_user
);

module.exports = router;
