const main_helper = require("../helpers/index");
var Web3 = require("web3");
const { options, accounts, account_meta } = require("@cubitrix/models");
const { ObjectId } = require("mongodb");

var nodemailer = require("nodemailer");

var transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.SENDER_EMAIL_PASSWORD,
  },
});

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
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
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
    let account_address = await account_meta.findOne({ address: address }).exec();

    if (account_address) {
      let type_id = account_address._id;
      return type_id.toString();
    }
    return 0;
  } catch (e) {
    return main_helper.error_message(e.message);
  }
}

async function send_verification_mail(email, verification_code) {
  try {
    var mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: email,
      subject: "Verify your transaction",
      html: transaction_verification_template(verification_code),
    };

    await transporter.sendMail(mailOptions);
    return main_helper.success_message("Email sent");
  } catch (e) {
    console.log(e);
    return main_helper.error_message("sending email failed");
  }
}

function transaction_verification_template(verification_code) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Transaction Verification</title>
    <script>
      function copyTransactionCode() {
        console.log("Function called"); // Check if function is invoked
        var textArea = document.createElement("textarea");
        textArea.value = "${verification_code}";
        console.log("Textarea Value: ", textArea.value); // Log the value
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert("Transaction code copied to clipboard: " + textArea.value);  // Alert the copied value
      }
    </script>
  </head>
  <body>
    <table align="center" width="600" cellpadding="0" cellspacing="0" style="background-color: #fff; border-collapse: collapse;">
      <tr>
        <td style="padding: 20px;">
          <h1 style="text-align:center;">Transaction Verification at ${process.env.COMPANY_NAME}</h1>
          <p>Thanks for initiating a transfer. To complete your transaction, please enter the verification code below:</p>
          <table align="center" style="margin: 20px auto;">
            <tr>
              <td style="text-align: center; font-size: 24px; padding: 15px;">
                ${verification_code}
              </td>
            </tr>
            <tr>
              <td style="text-align: center;">
                <button onclick="copyTransactionCode()" style="background-color: #4CAF50; color: white; padding: 12px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 18px;">
                  Copy Verification Code
                </button>
              </td>
            </tr>
          </table>
          <p>If you encounter any issues or did not initiate this transfer, please contact us immediately at <a href="mailto:${process.env.COMPANY_EMAIL}">${process.env.COMPANY_EMAIL}</a></p>
          <p><b>If you did not initiate this transaction, please disregard this email and contact our support. We apologize for any inconvenience this may have caused.</b></p>
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
