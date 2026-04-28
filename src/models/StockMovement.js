const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variant: {
      size: { type: String, required: true },
      color: { type: String, required: true },
    },
    type: {
      type: String,
      enum: ['add', 'remove', 'reserve', 'release', 'sale', 'return', 'adjustment'],
      required: true,
    },
    quantity: { type: Number, required: true },
    reason: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    billId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill' },
    stockBefore: { type: Number },
    stockAfter: { type: Number },
    timestamp: { type: Date, default: Date.now },
  }
);

stockMovementSchema.index({ productId: 1 });
stockMovementSchema.index({ timestamp: -1 });
stockMovementSchema.index({ type: 1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
