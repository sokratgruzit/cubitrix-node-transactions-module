const express = require("express");
const router = express();
const transactions_controller = require("../controllers/transactions_controller");

const cookieParser = require("cookie-parser");

router.use(cookieParser());

router.post(
  "/create_global_option",
  transactions_controller.create_global_option
);

router.post("/update_options", transactions_controller.update_options);

router.post(
  "/pending_deposit_transaction",
  transactions_controller.pending_deposit_transaction
);

router.post(
  "/coinbase_deposit_transaction",
  transactions_controller.coinbase_deposit_transaction
);

router.post("/coinbase_webhooks", transactions_controller.coinbase_webhooks);
router.get("/coinbase_webhooks", (req, res) => res.send("ok"));
router.post(
  "/get_transactions_of_user",
  transactions_controller.get_transactions_of_user
);

router.post(
  "/get_transaction_by_hash",
  transactions_controller.get_transaction_by_hash
);
router.post("/make_transfer", transactions_controller.make_transfer);

router.post("/direct_deposit", transactions_controller.direct_deposit);
router.post(
  "/unstake_transaction",
  transactions_controller.unstake_transaction
);

router.post("/exchange", transactions_controller.exchange);
router.post("/make_withdrawal", transactions_controller.make_withdrawal);
router.post("/stake_currency", transactions_controller.stakeCurrency);

router.post(
  "/unstake_transaction",
  transactions_controller.unstake_transaction
);

module.exports = router;
