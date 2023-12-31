const CryptoJS = require("crypto-js");

const secretKey = process.env.SECRET_KEY;

const decryptEnv = (ciphertext) => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, secretKey);
  const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
  console.log(secretKey, decryptedText, "decryplksajf");
  return decryptedText;
};

module.exports = decryptEnv;
