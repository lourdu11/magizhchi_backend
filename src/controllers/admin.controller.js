const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Bill = require('../models/Bill');
const Settings = require('../models/Settings');
const ApiResponse = require('../utils/apiResponse');

exports.getDashboardStats = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisYear = new Date(today.getFullYear(), 0, 1);

    const [
      todayOrders, monthOrders, yearOrders,
      pendingOrders, shippedOrders, deliveredOrders, cancelledOrders,
      totalUsers, totalProducts,
      lowStockProducts, recentOrders,
    ] = await Promise.all([
      Order.aggregate([{ $match: { createdAt: { $gte: today }, orderStatus: { $nin: ['cancelled', 'returned'] } } }, { $group: { _id: null, revenue: { $sum: '$pricing.totalAmount' }, count: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { createdAt: { $gte: thisMonth }, orderStatus: { $nin: ['cancelled', 'returned'] } } }, { $group: { _id: null, revenue: { $sum: '$pricing.totalAmount' }, count: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { createdAt: { $gte: thisYear }, orderStatus: { $nin: ['cancelled', 'returned'] } } }, { $group: { _id: null, revenue: { $sum: '$pricing.totalAmount' }, count: { $sum: 1 } } }]),
      Order.countDocuments({ orderStatus: { $in: ['placed', 'confirmed', 'processing'] } }),
      Order.countDocuments({ orderStatus: 'shipped' }),
      Order.countDocuments({ orderStatus: 'delivered' }),
      Order.countDocuments({ orderStatus: 'cancelled' }),
      User.countDocuments({ role: 'user' }),
      Product.countDocuments({ isActive: true }),
      Product.find({ isActive: true }).then(products =>
        products.filter(p => p.totalStock < (p.lowStockThreshold || 10)).slice(0, 10)
      ),
      Order.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'name email'),
    ]);

    return ApiResponse.success(res, {
      revenue: {
        today: todayOrders[0]?.revenue || 0,
        month: monthOrders[0]?.revenue || 0,
        year: yearOrders[0]?.revenue || 0,
      },
      orders: {
        todayCount: todayOrders[0]?.count || 0,
        monthCount: monthOrders[0]?.count || 0,
        pending: pendingOrders, shipped: shippedOrders,
        delivered: deliveredOrders, cancelled: cancelledOrders,
      },
      users: totalUsers,
      products: totalProducts,
      lowStockProducts,
      recentOrders,
    });
  } catch (error) { next(error); }
};

exports.getSalesAnalytics = async (req, res, next) => {
  try {
    const { period = 'monthly', year = new Date().getFullYear() } = req.query;
    let groupBy, match;

    if (period === 'daily') {
      const startOf = new Date(); startOf.setDate(startOf.getDate() - 30);
      match = { createdAt: { $gte: startOf }, orderStatus: { $nin: ['cancelled', 'returned'] } };
      groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
    } else if (period === 'monthly') {
      match = { createdAt: { $gte: new Date(year, 0, 1) }, orderStatus: { $nin: ['cancelled', 'returned'] } };
      groupBy = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
    } else {
      match = { orderStatus: { $nin: ['cancelled', 'returned'] } };
      groupBy = { $dateToString: { format: '%Y', date: '$createdAt' } };
    }

    // Define previous period for growth comparison
    let previousMatch = { ...match };
    const now = new Date();
    if (period === 'daily') {
      const startOfPrev = new Date(); startOfPrev.setDate(startOfPrev.getDate() - 60);
      const endOfPrev = new Date(); endOfPrev.setDate(endOfPrev.getDate() - 30);
      previousMatch.createdAt = { $gte: startOfPrev, $lt: endOfPrev };
    } else if (period === 'monthly') {
      const startOfPrev = new Date(year - 1, 0, 1);
      const endOfPrev = new Date(year - 1, 11, 31);
      previousMatch.createdAt = { $gte: startOfPrev, $lt: endOfPrev };
    }

    const [salesTrend, categoryData, paymentData, topProducts, topCustomers, locationData, currentSummary, previousSummary] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $group: { _id: groupBy, revenue: { $sum: '$pricing.totalAmount' }, orders: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: '$items' },
        { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $lookup: { from: 'categories', localField: 'product.category', foreignField: '_id', as: 'category' } },
        { $unwind: '$category' },
        { $group: { _id: '$category.name', revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }, count: { $sum: '$items.quantity' } } },
        { $sort: { revenue: -1 } }
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: '$paymentMethod', revenue: { $sum: '$pricing.totalAmount' }, count: { $sum: 1 } } }
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: '$items' },
        { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $group: { _id: '$product.name', sales: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
        { $sort: { sales: -1 } },
        { $limit: 5 }
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: '$userId', totalSpent: { $sum: '$pricing.totalAmount' }, orders: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { name: { $ifNull: ['$user.name', 'Guest User'] }, email: { $ifNull: ['$user.email', 'N/A'] }, totalSpent: 1, orders: 1 } },
        { $sort: { totalSpent: -1 } },
        { $limit: 5 }
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: '$shippingAddress.state', revenue: { $sum: '$pricing.totalAmount' }, orders: { $sum: 1 } } },
        { $sort: { revenue: -1 } },
        { $limit: 8 }
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: null, totalRevenue: { $sum: '$pricing.totalAmount' }, totalOrders: { $sum: 1 } } }
      ]),
      Order.aggregate([
        { $match: previousMatch },
        { $group: { _id: null, totalRevenue: { $sum: '$pricing.totalAmount' } } }
      ])
    ]);

    const currentRevenue = currentSummary[0]?.totalRevenue || 0;
    const prevRevenue = previousSummary[0]?.totalRevenue || 0;
    const growth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    return ApiResponse.success(res, { 
      data: salesTrend, 
      categoryData, 
      paymentData, 
      topProducts,
      topCustomers,
      locationData,
      summary: {
        ...(currentSummary[0] || { totalRevenue: 0, totalOrders: 0 }),
        growth: growth.toFixed(1)
      }
    });
  } catch (error) { next(error); }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const query = {};
    if (role) query.role = role;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      User.find(query).select('-password -refreshToken').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(query),
    ]);
    return ApiResponse.paginated(res, users, { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
};

exports.toggleBlockUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return ApiResponse.notFound(res, 'User not found');
    user.isBlocked = !user.isBlocked;
    await user.save();
    return ApiResponse.success(res, null, `User ${user.isBlocked ? 'blocked' : 'unblocked'}`);
  } catch (error) { next(error); }
};

exports.createStaff = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;
    const staff = await User.create({ name, email, phone, password, role: 'staff', isVerified: true });
    return ApiResponse.created(res, { staff: { _id: staff._id, name, email, phone, role: 'staff' } }, 'Staff account created');
  } catch (error) { next(error); }
};

exports.getStaff = async (req, res, next) => {
  try {
    const staff = await User.find({ role: 'staff' }).select('-password -refreshToken').sort({ createdAt: -1 });
    return ApiResponse.success(res, staff);
  } catch (error) { next(error); }
};

exports.deleteStaff = async (req, res, next) => {
  try {
    const staff = await User.findOneAndDelete({ _id: req.params.id, role: 'staff' });
    if (!staff) return ApiResponse.notFound(res, 'Staff not found');
    return ApiResponse.success(res, null, 'Staff account deleted');
  } catch (error) { next(error); }
};

exports.getLowStock = async (req, res, next) => {
  try {
    const products = await Product.find({ isActive: true });
    const lowStock = products.filter(p =>
      p.totalStock < (p.lowStockThreshold || 10)
    );
    return ApiResponse.success(res, lowStock);
  } catch (error) { next(error); }
};
exports.getSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    return ApiResponse.success(res, settings);
  } catch (error) { next(error); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    // Find the first document or create it
    const existing = await Settings.findOne();
    const settings = await Settings.findOneAndUpdate(
      existing ? { _id: existing._id } : {}, 
      { $set: req.body }, 
      { upsert: true, new: true, runValidators: true }
    );
    
    return ApiResponse.success(res, settings, 'Settings updated successfully');
  } catch (error) { next(error); }
};

exports.getPublicSettings = async (req, res, next) => {
  try {
    const settings = await Settings.findOne()
      .select('store shipping.freeShippingThreshold payment.codEnabled seo')
      .lean();
    
    // Ensure the response structure is always complete even if DB doc is empty
    const response = {
      store: settings?.store || {},
      shipping: settings?.shipping || { codEnabled: true, freeShippingThreshold: 999 },
      payment: settings?.payment || { codEnabled: true },
      seo: settings?.seo || {}
    };

    return ApiResponse.success(res, response);
  } catch (error) { next(error); }
};
