const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const StockMovement = require('../models/StockMovement');
const Settings = require('../models/Settings');
const { razorpay, isConfigured: isRazorpayConfigured } = require('../config/razorpay');
const { sendOrderConfirmationEmail } = require('../services/email.service');
const { sendOrderNotificationToAdmin, sendOrderCancellationNotificationToAdmin } = require('../services/whatsapp.service');
const ApiResponse = require('../utils/apiResponse');
const crypto = require('crypto');
const logger = require('../utils/logger');

// GST Logic: Now dynamic based on product.gstPercentage

// POST /orders/create
exports.createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, billingAddress, paymentMethod, couponCode, notes, guestDetails } = req.body;

    // Check if COD is enabled globally
    if (paymentMethod === 'cod') {
      const settings = await Settings.findOne();
      if (settings && settings.payment && settings.payment.codEnabled === false) {
        return ApiResponse.error(res, 'Cash on Delivery is currently disabled.', 400);
      }
    }

    const settings = await Settings.findOne() || {};
    const shippingConfig = settings.shipping || { flatRate: 50, freeShippingThreshold: 999 };

    // --- Build order items with live prices ---
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) throw { message: `Product not available: ${item.productId}`, statusCode: 400 };

      const variant = product.variants.find(v => v.size === item.size && v.color === item.color);
      if (!variant) throw { message: 'Variant not found', statusCode: 400 };

      const available = variant.stock - variant.reservedStock;
      if (available < item.quantity) throw { message: `Insufficient stock for ${product.name} (${item.size}/${item.color})`, statusCode: 400 };

      const price = product.discountedPrice || product.sellingPrice;
      const gstRate = (product.gstPercentage || 12) / 100;
      const taxableValue = parseFloat((price * item.quantity / (1 + gstRate)).toFixed(2));
      const gstAmount = parseFloat((price * item.quantity - taxableValue).toFixed(2));
      const itemTotal = price * item.quantity;

      orderItems.push({
        productId: product._id, productName: product.name,
        productImage: product.images[0], sku: product.sku,
        hsnCode: product.hsnCode || '6205',
        variant: { size: item.size, color: item.color },
        quantity: item.quantity, price,
        taxableValue, cgst: gstAmount / 2, sgst: gstAmount / 2, total: itemTotal,
      });
      subtotal += itemTotal;
    }

    // --- Coupon validation ---
    let couponDiscount = 0;
    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
      if (coupon && new Date() >= coupon.validFrom && new Date() <= coupon.validTo) {
        if (subtotal >= coupon.minPurchaseAmount) {
          if (coupon.discountType === 'percentage') {
            couponDiscount = Math.min((subtotal * coupon.discountValue) / 100, coupon.maxDiscountAmount || Infinity);
          } else {
            couponDiscount = Math.min(coupon.discountValue, subtotal);
          }
          await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usageCount: 1 }, $push: { usedBy: req.user?._id } });
        }
      }
    }

    const afterDiscount = subtotal - couponDiscount;
    // Note: gstAmount is now the sum of individual item taxes for precision
    const totalGst = orderItems.reduce((sum, item) => sum + (item.cgst + item.sgst), 0);
    const shipping = afterDiscount >= shippingConfig.freeShippingThreshold ? 0 : shippingConfig.flatRate;
    const totalAmount = parseFloat((afterDiscount + shipping).toFixed(2));

    // --- Reserve stock ---
    for (const item of orderItems) {
      await Product.updateOne(
        { 
          _id: item.productId, 
          variants: { $elemMatch: { size: item.variant.size, color: item.variant.color } }
        },
        { $inc: { 'variants.$.reservedStock': item.quantity } }
      );
    }

    // --- Razorpay order (if online payment) ---
    let razorpayOrder = null;
    if (paymentMethod === 'razorpay') {
      if (!isRazorpayConfigured) {
        return ApiResponse.error(res, 'Online payment is currently unavailable. Please use Cash on Delivery.', 400);
      }
      razorpayOrder = await razorpay.orders.create({

        amount: Math.round(totalAmount * 100), // paise
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`,
      });
    }

    const estimatedDeliveryDate = new Date();
    estimatedDeliveryDate.setDate(estimatedDeliveryDate.getDate() + 5);

    // Generate Sequential Order Number: ORD-YYYYMMDD-MAG001
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const countToday = await Order.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } });
    const sequence = (countToday + 1).toString().padStart(3, '0');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const sequentialOrderNumber = `ORD-${dateStr}-MAG${sequence}`;

    // --- Create order (retry on duplicate orderNumber) ---
    let order;
    let attempts = 0;
    while (attempts < 3) {
      try {
        order = await Order.create({
          orderNumber: sequentialOrderNumber,
          userId: req.user?._id,
          isGuestOrder: !req.user,
          guestDetails: !req.user ? guestDetails : undefined,
          items: orderItems,
          pricing: { subtotal, couponDiscount, gstAmount: totalGst, shippingCharges: shipping, totalAmount },
          shippingAddress, billingAddress: billingAddress || shippingAddress,
          paymentMethod,
          paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
          paymentDetails: razorpayOrder ? { razorpayOrderId: razorpayOrder.id } : {},
          couponCode, notes, estimatedDeliveryDate,
          statusHistory: [{ status: 'placed', updatedAt: new Date() }],
        });
        break; // success
      } catch (dupErr) {
        const isDuplicate = dupErr.code === 11000 || (dupErr.message && dupErr.message.includes('E11000'));
        if (isDuplicate && attempts < 3) {
          attempts++;
          logger.warn(`Order number collision (Attempt ${attempts}). Retrying...`);
          if (attempts >= 3) throw new Error('Could not generate unique order number. Please try again.');
        } else {
          throw dupErr;
        }
      }

    }


    // For COD: confirm stock immediately
    if (paymentMethod === 'cod') {
      await confirmStockSale(orderItems, order._id);
    }

    // Clear the cart for authenticated users
    if (req.user) {
      await Cart.findOneAndUpdate({ userId: req.user._id }, { items: [] });
      
      // Save address to user profile if not already present
      const user = await User.findById(req.user._id);
      if (user && shippingAddress) {
        const addrExists = user.addresses.some(a => 
          (a.addressLine1 || '').trim().toLowerCase() === (shippingAddress.addressLine1 || '').trim().toLowerCase() && 
          (a.pincode || '').trim() === (shippingAddress.pincode || '').trim()
        );
        if (!addrExists) {
          user.addresses.push({ ...shippingAddress, isDefault: user.addresses.length === 0 });
          await user.save();
          logger.info(`Saved new address for user: ${user._id}`);
        }
      }
    }

    logger.info(`Order created: ${order.orderNumber} | ₹${totalAmount} | ${paymentMethod}`);

    // Notify Admin via WhatsApp
    sendOrderNotificationToAdmin(order).catch(() => {});

    return ApiResponse.created(res, {
      order: { _id: order._id, orderNumber: order.orderNumber, totalAmount, estimatedDeliveryDate },
      razorpayOrder,
    }, 'Order created successfully');
  } catch (error) { next(error); }
};

// POST /orders/verify-payment
exports.verifyPayment = async (req, res, next) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return ApiResponse.error(res, 'Payment verification failed. Invalid signature.', 400);
    }

    const order = await Order.findById(orderId);
    if (!order) return ApiResponse.notFound(res, 'Order not found');

    // Update payment details
    order.paymentStatus = 'completed';
    order.paymentDetails.razorpayPaymentId = razorpayPaymentId;
    order.paymentDetails.razorpaySignature = razorpaySignature;
    order.paymentDetails.paidAt = new Date();
    order.orderStatus = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', updatedAt: new Date() });
    await order.save();

    // Permanently deduct stock
    await confirmStockSale(order.items, order._id);

    // Send confirmation email
    const emailTo = order.isGuestOrder ? order.guestDetails?.email : req.user?.email;
    if (emailTo) sendOrderConfirmationEmail(emailTo, order).catch(() => {});

    return ApiResponse.success(res, { order: { orderNumber: order.orderNumber } }, 'Payment verified!');
  } catch (error) { next(error); }
};

async function confirmStockSale(items, orderId) {
  for (const item of items) {
    await Product.updateOne(
      { 
        _id: item.productId, 
        variants: { $elemMatch: { size: item.variant.size, color: item.variant.color } }
      },
      {
        $inc: {
          'variants.$.stock': -item.quantity,
          'variants.$.reservedStock': -item.quantity,
          salesCount: item.quantity,
        },
      }
    );
    await StockMovement.create({
      productId: item.productId, variant: item.variant,
      type: 'sale', quantity: item.quantity,
      reason: 'Online order sale', orderId,
    });
  }
}

// GET /orders/:id (User or Admin)
exports.getOrder = async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const query = isAdmin
      ? { _id: req.params.id }
      : { _id: req.params.id, userId: req.user._id };
    const order = await Order.findOne(query).populate('userId', 'name email phone');
    if (!order) return ApiResponse.notFound(res, 'Order not found');
    return ApiResponse.success(res, { order });
  } catch (error) { next(error); }
};

// GET /users/orders (User's order history)
exports.getUserOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).select('-items.taxableValue -items.cgst -items.sgst').lean(),
      Order.countDocuments({ userId: req.user._id }),
    ]);
    return ApiResponse.paginated(res, orders, { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
};

// GET /orders (Admin)
exports.getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, payment, search, startDate, endDate } = req.query;
    const query = {};
    if (status) query.orderStatus = status;
    if (payment) query.paymentStatus = payment;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (search) query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { 'shippingAddress.name': { $regex: search, $options: 'i' } },
      { 'shippingAddress.phone': { $regex: search, $options: 'i' } },
    ];

    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      Order.find(query).populate('userId', 'name email phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Order.countDocuments(query),
    ]);
    return ApiResponse.paginated(res, orders, { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
};

// PUT /orders/:id/status (Admin)
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status, note, trackingNumber, carrier, trackingUrl } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return ApiResponse.notFound(res, 'Order not found');

    order.orderStatus = status;
    order.statusHistory.push({ status, updatedAt: new Date(), updatedBy: req.user._id, note });
    if (trackingNumber) order.trackingInfo = { carrier, trackingNumber, trackingUrl };
    if (status === 'delivered') order.deliveredAt = new Date();

    await order.save();
    return ApiResponse.success(res, { order }, 'Order status updated');
  } catch (error) { next(error); }
};

// POST /orders/:id/cancel (User)
exports.cancelOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
    if (!order) return ApiResponse.notFound(res, 'Order not found');
    if (!['placed', 'confirmed'].includes(order.orderStatus)) {
      return ApiResponse.error(res, 'Order cannot be cancelled at this stage', 400);
    }

    // Properly handle stock based on order status to prevent "Magical Inventory" bug
    for (const item of order.items) {
      if (order.orderStatus === 'placed') {
        // Stock wasn't deducted yet, only reservedStock was increased.
        await Product.updateOne(
          { 
            _id: item.productId, 
            variants: { $elemMatch: { size: item.variant.size, color: item.variant.color } }
          },
          { $inc: { 'variants.$.reservedStock': -item.quantity } }
        );
      } else if (order.orderStatus === 'confirmed') {
        // Stock was deducted. Return it to stock.
        await Product.updateOne(
          { 
            _id: item.productId, 
            variants: { $elemMatch: { size: item.variant.size, color: item.variant.color } }
          },
          { $inc: { 'variants.$.stock': item.quantity, salesCount: -item.quantity } }
        );
      }
    }

    order.orderStatus = 'cancelled';
    order.cancelReason = req.body.reason || 'Cancelled by customer';
    order.statusHistory.push({ status: 'cancelled', updatedAt: new Date() });
    await order.save();

    // Notify Admin via WhatsApp
    sendOrderCancellationNotificationToAdmin(order, order.cancelReason).catch(() => {});

    return ApiResponse.success(res, null, 'Order cancelled successfully');
  } catch (error) { next(error); }
};

// POST /orders/:id/return
exports.requestReturn = async (req, res, next) => {
  try {
    const { reason, images } = req.body;
    const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });

    if (!order) return ApiResponse.notFound(res, 'Order not found');
    if (order.orderStatus !== 'delivered') return ApiResponse.error(res, 'Only delivered orders can be returned', 400);
    
    // Check if within 7 days window
    const deliveryDate = new Date(order.deliveredAt);
    const now = new Date();
    const diffDays = Math.ceil((now - deliveryDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 7) return ApiResponse.error(res, 'Return window (7 days) has expired', 400);

    order.returnRequest = {
      isRequested: true,
      requestedAt: now,
      reason,
      images: images || [],
      status: 'pending'
    };
    
    await order.save();
    return ApiResponse.success(res, order, 'Return request submitted successfully');
  } catch (error) { next(error); }
};

// PUT /orders/:id/return-status (Admin)
exports.updateReturnStatus = async (req, res, next) => {
  try {
    const { status, adminNote, refundAmount } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order || !order.returnRequest.isRequested) {
      return ApiResponse.error(res, 'Return request not found for this order', 404);
    }

    order.returnRequest.status = status;
    order.returnRequest.adminNote = adminNote;
    
    if (status === 'approved') {
      order.orderStatus = 'returned';
      order.returnRequest.refundAmount = refundAmount || order.pricing.totalAmount;
      order.returnRequest.refundedAt = new Date();
      order.paymentStatus = 'refunded';

      // Ensure physical items are added back to inventory stock
      const StockMovement = require('../models/StockMovement');
      for (const item of order.items) {
        await Product.updateOne(
          { 
            _id: item.productId, 
            variants: { $elemMatch: { size: item.variant.size, color: item.variant.color } }
          },
          { $inc: { 'variants.$.stock': item.quantity, salesCount: -item.quantity } }
        );
        await StockMovement.create({
          productId: item.productId, variant: item.variant,
          type: 'return', quantity: item.quantity,
          reason: adminNote || 'Customer Return Approved', orderId: order._id,
        });
      }
    }

    await order.save();
    return ApiResponse.success(res, order, `Return request ${status}`);
  } catch (error) { next(error); }
};

