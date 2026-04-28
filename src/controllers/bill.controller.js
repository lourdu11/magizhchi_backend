const Bill = require('../models/Bill');
const Product = require('../models/Product');
const User = require('../models/User');
const StockMovement = require('../models/StockMovement');

const { generateBillNumber } = require('../utils/generateNumbers');
const ApiResponse = require('../utils/apiResponse');

const GST_RATE = 0.18;

exports.createBill = async (req, res, next) => {
  try {
    const { items, customerDetails, paymentMethod, paymentDetails, discount = 0, notes } = req.body;

    let subtotal = 0;
    const billItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) throw { message: `Product not found: ${item.productId}`, statusCode: 404 };

      const variant = product.variants.find(
        v => v.size === (item.variant?.size || item.size) &&
             v.color === (item.variant?.color || item.color)
      );
      if (!variant) throw { message: 'Variant not found', statusCode: 400 };

      const available = variant.stock - variant.reservedStock;
      if (available < item.quantity) throw { message: `Insufficient stock for ${product.name}`, statusCode: 400 };

      const price = item.price || product.discountedPrice;
      const taxableValue = parseFloat((price * item.quantity / 1.18).toFixed(2));
      const gstPerItem = parseFloat((price * item.quantity - taxableValue).toFixed(2));
      const itemTotal = price * item.quantity;

      const itemSize = item.variant?.size || item.size;
      const itemColor = item.variant?.color || item.color;

      billItems.push({
        productId: product._id, productName: product.name, sku: product.sku,
        hsnCode: product.hsnCode || '6205',
        variant: { size: itemSize, color: itemColor },
        quantity: item.quantity, price, taxableValue,
        cgst: gstPerItem / 2, sgst: gstPerItem / 2, total: itemTotal,
      });

      subtotal += itemTotal;
    }

    const afterDiscount = subtotal - discount;
    const gstAmount = parseFloat((afterDiscount - afterDiscount / 1.18).toFixed(2));
    const totalAmount = parseFloat(afterDiscount.toFixed(2));

    // Auto-populate payment details based on method if not provided
    const finalPaymentDetails = paymentDetails || {};
    if (paymentMethod === 'cash') finalPaymentDetails.cashAmount = totalAmount;
    else if (paymentMethod === 'card') finalPaymentDetails.cardAmount = totalAmount;
    else if (['upi', 'gpay', 'phonepe'].includes(paymentMethod)) finalPaymentDetails.upiAmount = totalAmount;

    // Generate Sequential Bill Number: ORD-YYYYMMDD-MAG001
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const countToday = await Bill.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } });
    const sequence = (countToday + 1).toString().padStart(3, '0');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const sequentialBillNumber = `ORD-${dateStr}-MAG${sequence}`;

    const bill = await Bill.create({
      billNumber: sequentialBillNumber,
      staffId: req.user._id,
      customerDetails,
      items: billItems,
      pricing: { subtotal, discount, gstAmount, totalAmount },
      paymentMethod,
      paymentDetails: finalPaymentDetails,
      notes,
    });


    // Deduct stock immediately for offline sale with atomic race condition protection
    for (const item of billItems) {
      const updateResult = await Product.updateOne(
        { 
          _id: item.productId, 
          variants: { 
            $elemMatch: { 
              size: item.variant.size, 
              color: item.variant.color,
              stock: { $gte: item.quantity }
            } 
          }
        },
        { $inc: { 'variants.$.stock': -item.quantity, salesCount: item.quantity } }
      );

      if (updateResult.modifiedCount === 0) {
        throw { message: `Concurrency Error: ${item.productName} (${item.variant.size}) just went out of stock!`, statusCode: 409 };
      }

      await StockMovement.create({
        productId: item.productId, variant: item.variant, type: 'sale',
        quantity: item.quantity, reason: 'Offline store sale', performedBy: req.user._id, billId: bill._id,
      });
    }

    return ApiResponse.created(res, { bill }, 'Bill created successfully');
  } catch (error) { next(error); }
};

exports.getBills = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, date, search } = req.query;
    const query = {};
    if (req.user.role === 'staff') query.staffId = req.user._id;
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    if (search) {
      query.$or = [
        { billNumber: { $regex: search, $options: 'i' } },
        { 'customerDetails.name': { $regex: search, $options: 'i' } },
        { 'customerDetails.phone': { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (page - 1) * limit;
    const [bills, total] = await Promise.all([
      Bill.find(query).populate('staffId', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Bill.countDocuments(query),
    ]);
    return ApiResponse.paginated(res, bills, { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
};


exports.getBill = async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role === 'staff') query.staffId = req.user._id;
    const bill = await Bill.findOne(query).populate('staffId', 'name');
    if (!bill) return ApiResponse.notFound(res, 'Bill not found');
    return ApiResponse.success(res, { bill });
  } catch (error) { next(error); }
};

exports.getDailyReport = async (req, res, next) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    const query = { createdAt: { $gte: start, $lte: end } };
    if (req.user.role === 'staff') query.staffId = req.user._id;

    const [bills, summary] = await Promise.all([
      Bill.find(query).sort({ createdAt: 1 }),
      Bill.aggregate([
        { $match: query },
        { $group: {
          _id: null,
          totalRevenue: { $sum: '$pricing.totalAmount' },
          totalBills: { $sum: 1 },
          cashTotal: { $sum: '$paymentDetails.cashAmount' },
          upiTotal: { $sum: '$paymentDetails.upiAmount' },
          cardTotal: { $sum: '$paymentDetails.cardAmount' },
        }},
      ]),
    ]);

    return ApiResponse.success(res, { bills, summary: summary[0] || {}, date: date.toDateString() });
  } catch (error) { next(error); }
};

exports.lookupCustomer = async (req, res, next) => {
  try {
    const { phone } = req.params;
    const user = await User.findOne({ phone }).select('name email phone');
    if (!user) return ApiResponse.notFound(res, 'Customer not found');
    return ApiResponse.success(res, { customer: user });
  } catch (error) { next(error); }
};

