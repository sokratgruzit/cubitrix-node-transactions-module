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

module.exports = router;
