const main_helper = require("../helpers/index");
var Web3 = require("web3");
const {options, accounts, account_meta} = require("@cubitrix/models");
const decryptEnv = require("../utils/decryptEnv");
var nodemailer = require("nodemailer");

const USE_CUSTOM_SMTP = process.env.USE_CUSTOM_SMTP;
const CUSTOM_SMTP_HOST = process.env.CUSTOM_SMTP_HOST;
const CUSTOM_SMTP_PORT = process.env.CUSTOM_SMTP_PORT;
const CUSTOM_SMTP_SECURE = process.env.CUSTOM_SMTP_SECURE;
const CUSTOM_SMTP_USER = process.env.CUSTOM_SMTP_USER;
const CUSTOM_SMTP_PASS = process.env.CUSTOM_SMTP_PASS;
const SENDER_EMAIL_PASSWORD = process.env.SENDER_EMAIL_PASSWORD;

const senderEmailPass = decryptEnv(SENDER_EMAIL_PASSWORD);

let transporter, transporterConfig;

if (USE_CUSTOM_SMTP === "true") {
  transporterConfig = {
    host: CUSTOM_SMTP_HOST,
    port: CUSTOM_SMTP_PORT,
    secure: CUSTOM_SMTP_SECURE === 'true',
    auth: {
      user: CUSTOM_SMTP_USER,
      pass: CUSTOM_SMTP_PASS,
    },
  };
} else {
  transporterConfig = {
    service: "gmail",
    auth: {
      user: process.env.SENDER_EMAIL,
      pass: senderEmailPass,
    },
  };
}

transporter = nodemailer.createTransport(transporterConfig);

async function get_option_by_key(key) {
  try {
    let option = await options.findOne({key});
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
    let account_address = await account_meta.findOne({address: address}).exec();

    if (account_address) {
      let type_id = account_address._id;
      return type_id.toString();
    }
    return 0;
  } catch (e) {
    return main_helper.error_message(e.message);
  }
}

async function send_verification_mail(email, verification_code, userName) {
  try {
    var mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: email,
      subject: "Transaction Verification at A1",
      html: transaction_verification_template(verification_code, userName),
    };

    await transporter.sendMail(mailOptions);
    return main_helper.success_message("Email sent");
  } catch (e) {
    console.log(e);
    return main_helper.error_message("sending email failed");
  }
}

function transaction_verification_template(verification_code, userName) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Transaction Verification</title>
    <style>
      .highlighted-box {
        text-align: center;
        font-size: 24px;
        padding: 15px;
        background-color: #f2f2f2;
        border: 1px solid #ccc;
        border-radius: 4px;
      }
    </style>
  </head>
  <body>
    <table align="center" width="600" cellpadding="0" cellspacing="0" style="background-color: #fff; border-collapse: collapse;">
      <tr>
        <td style="padding: 20px;">
          <h2 style="text-align:center;">Dear ${userName}</h2>
          <p>Thanks for initiating a transfer. To complete your transaction, please enter the verification code
          below:
          </p>
          <table align="center" style="margin: 20px auto;">
            <tr>
              <td class="highlighted-box">
                ${verification_code}
              </td>
            </tr>
            <tr>
              <td style="text-align: center;">
              Please copy and use the above code to complete your transaction securely.
              </td>
            </tr>
          </table>
          <p>If you encounter any issues or did not initiate this transfer, please contact us immediately. <a href="mailto:${process.env.COMPANY_EMAIL}">${process.env.COMPANY_EMAIL}</a></p>
          <p><b>If you did not initiate this transaction, please disregard this email and contact our support. We
          apologize for any inconvenience this may have caused.</b></p>
          <p>Best Regards,<p>
          <p>A1 Gold Team<p>
        </td>
      </tr>
    </table>
  </body>
  </html>  
  `;
}

module.exports = {
  get_option_by_key,
  calculate_tx_fee,
  make_hash,
  get_account_by_address,
  send_verification_mail,
};
