const mongoose = require('mongoose');

mongoose.set("strictQuery", false);

const tradeConn = mongoose.createConnection("mongodb+srv://sokrat:lalala12345@cluster0.x2cvw.mongodb.net/trade?retryWrites=true&w=majority", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

const TradeTransaction = new mongoose.Schema({
    borrowed_address: String,
    collateral: Number,
    leverage: Number, 
    rate: Number,
    currency: String,
    price: String,
    returned: Boolean
}, {
    timestamps: true
});

module.exports = tradeConn.model('TradeTransaction', TradeTransaction);