const Product = require('../models/Product');
const Category = require('../models/Category');
const StockMovement = require('../models/StockMovement');
const ApiResponse = require('../utils/apiResponse');
const slugify = require('slugify');
const { generateSKU } = require('../utils/generateNumbers');
const { sendProductNotificationToAdmin } = require('../services/whatsapp.service');

// GET /products
exports.getProducts = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20, category, search, minPrice, maxPrice,
      size, color, sort = '-createdAt', isFeatured, isBestSeller, isNewArrival,
    } = req.query;

    const query = { isActive: true };

    if (category && !search) {
      const cat = await Category.findOne({ slug: category });
      if (cat) query.category = cat._id;
    }
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { sku: searchRegex },
        { tags: searchRegex }
      ];
      // When searching, we ignore the category filter to make it a global search
      delete query.category;
    }
    if (isFeatured === 'true') query.isFeatured = true;
    if (isBestSeller === 'true') query.isBestSeller = true;
    if (isNewArrival === 'true') query.isNewArrival = true;
    if (minPrice || maxPrice) {
      query.discountedPrice = {};
      if (minPrice) query.discountedPrice.$gte = Number(minPrice);
      if (maxPrice) query.discountedPrice.$lte = Number(maxPrice);
    }
    if (size) query['variants.size'] = { $in: size.split(',') };
    if (color) query['variants.color'] = { $in: color.split(',') };

    const sortMap = {
      '-createdAt': { createdAt: -1 },
      'price-asc': { discountedPrice: 1 },
      'price-desc': { discountedPrice: -1 },
      '-salesCount': { salesCount: -1 },
      '-ratings.average': { 'ratings.average': -1 },
    };

    const skip = (Number(page) - 1) * Number(limit);
    
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('category', 'name slug')
        .sort(sortMap[sort] || { createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-costPrice -__v'),
      Product.countDocuments(query),
    ]);

    return ApiResponse.paginated(res, products, {
      page: Number(page), limit: Number(limit),
      total, pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) { next(error); }
};

// GET /products/admin (Admin)
exports.getAdminProducts = async (req, res, next) => {
  try {
    const { category, search, sort = 'newest', page = 1, limit = 100 } = req.query;
    const query = {};

    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } }
      ];
    }

    const sortMap = {
      'newest': { createdAt: -1 },
      'oldest': { createdAt: 1 },
      'price-high': { sellingPrice: -1 },
      'price-low': { sellingPrice: 1 },
    };

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('category', 'name slug')
        .sort(sortMap[sort] || { createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-__v'),
      Product.countDocuments(query),
    ]);

    return ApiResponse.paginated(res, products, {
      page: Number(page), limit: Number(limit),
      total, pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) { next(error); }
};

// GET /products/:slug
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('category', 'name slug')
      .select('-costPrice -__v');
    if (!product) return ApiResponse.notFound(res, 'Product not found');
    // Increment view count async
    Product.findByIdAndUpdate(product._id, { $inc: { viewCount: 1 } }).exec();
    return ApiResponse.success(res, { product });
  } catch (error) { next(error); }
};

// GET /products/search
exports.searchProducts = async (req, res, next) => {
  try {
    const { q, limit = 8 } = req.query;
    if (!q || q.length < 2) return ApiResponse.success(res, { products: [] });
    const products = await Product.find({
      isActive: true,
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } },
      ],
    }).select('-costPrice -__v').limit(Number(limit));
    return ApiResponse.success(res, { products });
  } catch (error) { next(error); }
};

// POST /products (Admin)
exports.createProduct = async (req, res, next) => {
  try {
    const data = req.body;
    if (!data.name) return ApiResponse.error(res, 'Product name is required', 400);
    
    // 1. Generate unique slug
    let slug = slugify(data.name, { lower: true, strict: true });
    const slugExists = await Product.findOne({ slug });
    if (slugExists) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }
    data.slug = slug;

    if (!data.sku) data.sku = generateSKU(data.category);

    const product = await Product.create(data);
    
    // Notify Admin via WhatsApp
    sendProductNotificationToAdmin(product, 'created').catch(() => {});

    return ApiResponse.created(res, { product }, 'Product created successfully');
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'unique field';
      return ApiResponse.error(res, `A product with this ${field} already exists.`, 400);
    }
    next(error);
  }
};

// PUT /products/:id (Admin)
exports.updateProduct = async (req, res, next) => {
  try {
    const data = { ...req.body };
    const product = await Product.findById(req.params.id);
    if (!product) return ApiResponse.notFound(res, 'Product not found');

    // 1. Unique checks for SKU
    if (data.sku && data.sku !== product.sku) {
      const skuExists = await Product.findOne({ sku: data.sku, _id: { $ne: product._id } });
      if (skuExists) return ApiResponse.error(res, 'SKU already exists', 400);
    }

    // 2. Slug Regeneration (if name changed)
    if (data.name && data.name !== product.name) {
      let slug = slugify(data.name, { lower: true, strict: true });
      const slugExists = await Product.findOne({ slug, _id: { $ne: product._id } });
      if (slugExists) {
        slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
      }
      product.slug = slug;
    }

    // 3. Manual Merge
    const excludedFields = ['_id', 'id', 'slug', 'createdAt', 'updatedAt', '__v', 'totalStock', 'availableStock'];
    Object.keys(data).forEach(key => {
      if (!excludedFields.includes(key)) {
        product[key] = data[key];
      }
    });

    // 4. Save (triggers pre-save hooks for discountedPrice)
    const updatedProduct = await product.save();

    // 5. Notify Admin
    sendProductNotificationToAdmin(updatedProduct, 'updated').catch(() => {});

    return ApiResponse.success(res, { product: updatedProduct }, 'Product updated successfully');
  } catch (error) {
    console.error('DEBUG: Update Product Error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'unique field';
      return ApiResponse.error(res, `A product with this ${field} already exists.`, 400);
    }
    next(error);
  }
};

// DELETE /products/:id (Admin)
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return ApiResponse.notFound(res, 'Product not found');
    return ApiResponse.success(res, null, 'Product deleted permanently');
  } catch (error) { next(error); }
};

// PUT /admin/inventory/adjust (Admin)
exports.adjustStock = async (req, res, next) => {
  try {
    const { productId, size, color, type, quantity, reason } = req.body;
    const product = await Product.findById(productId);
    if (!product) return ApiResponse.notFound(res, 'Product not found');

    const variant = product.variants.find(v => v.size === size && v.color === color);
    if (!variant) return ApiResponse.error(res, 'Variant not found', 404);

    const numQuantity = Number(quantity);
    const stockBefore = variant.stock;
    if (type === 'add') variant.stock += numQuantity;
    else if (type === 'remove') variant.stock = Math.max(0, variant.stock - numQuantity);
    else if (type === 'set') variant.stock = numQuantity;

    await product.save();

    await StockMovement.create({
      productId, variant: { size, color }, type: 'adjustment',
      quantity: numQuantity, reason: reason || 'Manual Adjustment', performedBy: req.user._id,
      stockBefore, stockAfter: variant.stock,
    });

    return ApiResponse.success(res, { stock: variant.stock }, 'Stock adjusted successfully');
  } catch (error) { next(error); }
};
