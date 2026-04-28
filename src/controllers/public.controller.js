const Contact = require('../models/Contact');
const ApiResponse = require('../utils/apiResponse');
const { sendContactMessageNotificationToAdmin } = require('../services/whatsapp.service');
const Settings = require('../models/Settings');
const Order = require('../models/Order');

exports.submitContactForm = async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    // 1. Save to DB
    const contact = await Contact.create({ name, email, phone, subject, message });

    // 2. Send WhatsApp Notification
    // We don't await this to keep the response fast
    sendContactMessageNotificationToAdmin(contact).catch(() => {});

    return ApiResponse.success(res, contact, 'Message sent successfully');
  } catch (e) {
    next(e);
  }
};

exports.getPublicSettings = async (req, res, next) => {
  try {
    const settings = await Settings.findOne();
    return ApiResponse.success(res, settings);
  } catch (e) {
    next(e);
  }
};

exports.trackOrder = async (req, res, next) => {
  try {
    const { orderNumber, phone } = req.body;

    if (!orderNumber && !phone) {
      return ApiResponse.error(res, 'Please enter Order Number or Phone Number', 400);
    }

    let query = {};

    if (orderNumber) {
      query.orderNumber = orderNumber.toUpperCase();
    }

    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const phoneQuery = {
        $or: [
          { 'shippingAddress.phone': { $regex: cleanPhone } },
          { 'guestDetails.phone': { $regex: cleanPhone } },
          { 'billingAddress.phone': { $regex: cleanPhone } }
        ]
      };

      if (orderNumber) {
        // If both provided, keep it strict for better security
        query = { ...query, ...phoneQuery };
      } else {
        // If only phone provided, search by phone
        query = phoneQuery;
      }
    }

    // Find the latest order matching the criteria
    const order = await Order.findOne(query)
      .sort({ createdAt: -1 })
      .select('-userId -paymentDetails.razorpaySignature -statusHistory.updatedBy');

    if (!order) {
      return ApiResponse.error(res, 'No matching order found', 404);
    }

    return ApiResponse.success(res, { order });
  } catch (e) {
    next(e);
  }
};

exports.getPublicOrderDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .select('-userId -paymentDetails.razorpaySignature -statusHistory.updatedBy');

    if (!order) {
      return ApiResponse.error(res, 'Order not found', 404);
    }

    return ApiResponse.success(res, { order });
  } catch (e) {
    next(e);
  }
};
