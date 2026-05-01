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
      sort = '-createdAt', isFeatured, isBestSeller, isNewArrival,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Number(limit);

    // ─── 1. Initial Match Filter ────────────────────────────
    const match = { isActive: true };

    if (category && !search) {
      const Category = require('../models/Category');
      const cat = await Category.findOne({ slug: category });
      if (cat) match.category = cat._id;
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      match.$or = [
        { name: searchRegex },
        { sku: searchRegex },
        { tags: { $in: [searchRegex] } }
      ];
    }

    if (isFeatured === 'true') match.isFeatured = true;
    if (isBestSeller === 'true') match.isBestSeller = true;
    if (isNewArrival === 'true') match.isNewArrival = true;

    // ─── 2. Build Aggregation Pipeline ──────────────────────
    const pipeline = [
      { $match: match },
      // Join Category
      { $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
      }},
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      // Join Live Inventory
      { $lookup: {
          from: 'inventories', // Note: MongoDB collection name is usually plural
          let: { productName: '$name' },
          pipeline: [
            { $match: { 
                $expr: { $eq: ['$productName', '$$productName'] },
                onlineEnabled: true 
            }}
          ],
          as: 'liveInventory'
      }},
      // Map Inventory to Variants
      { $addFields: {
          variants: {
            $map: {
              input: '$liveInventory',
              as: 'inv',
              in: {
                size: '$$inv.size',
                color: '$$inv.color',
                stock: { $max: [0, { $subtract: [{ $add: ["$$inv.totalStock", "$$inv.returned"] }, { $add: ["$$inv.onlineSold", "$$inv.offlineSold", "$$inv.damaged", { $ifNull: ["$$inv.reservedStock", 0] }] }] }] },
                price: { $ifNull: ['$$inv.sellingPrice', '$sellingPrice'] },
                sku: { $ifNull: ['$$inv.sku', '$sku'] },
                barcode: '$$inv.barcode'
              }
            }
          }
      }},
      // Calculate Overall Availability
      { $addFields: {
          availableStock: { $sum: '$variants.stock' },
          isOutOfStock: { $eq: [{ $sum: '$variants.stock' }, 0] }
      }},
      // Sorting
      { $sort: sort === 'price-asc' ? { sellingPrice: 1 } : sort === 'price-desc' ? { sellingPrice: -1 } : { createdAt: -1 } },
      // Pagination
      { $facet: {
          metadata: [ { $count: 'total' } ],
          data: [ { $skip: skip }, { $limit: limitNum } ]
      }}
    ];

    const [results] = await Product.aggregate(pipeline);
    
    const total = results.metadata[0]?.total || 0;
    const products = results.data;

    return ApiResponse.paginated(res, products, {
      page: Number(page), limit: Number(limit),
      total, pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) { next(error); }
};

// GET /products/admin (Admin - No changes needed to query logic, but adding inventory merge)
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

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .sort(sortMap[sort] || { createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-__v');

    const total = await Product.countDocuments(query);

    // ─── INJECT AGGREGATED INVENTORY ───
    const productIds = products.map(p => p._id);
    const Inventory = require('../models/Inventory');
    const allInventory = await Inventory.find({ productRef: { $in: productIds } }).lean({ virtuals: true });

    const inventoryMap = allInventory.reduce((acc, item) => {
      const pId = item.productRef.toString();
      if (!acc[pId]) acc[pId] = { totalStock: 0, sizes: new Set(), colors: new Set(), variantCount: 0 };
      
      const avail = Math.max(0, (item.totalStock + (item.returned || 0)) - ((item.onlineSold || 0) + (item.offlineSold || 0) + (item.reservedStock || 0) + (item.damaged || 0)));
      acc[pId].totalStock += avail;
      if (item.size) acc[pId].sizes.add(item.size);
      if (item.color) acc[pId].colors.add(item.color);
      acc[pId].variantCount++;
      return acc;
    }, {});

    const processedProducts = products.map(p => {
      const inv = inventoryMap[p._id.toString()] || { totalStock: 0, sizes: new Set(), colors: new Set(), variantCount: 0 };
      return {
        ...p.toObject(),
        inventorySummary: {
          totalStock: inv.totalStock,
          sizes: Array.from(inv.sizes),
          colors: Array.from(inv.colors),
          variantCount: inv.variantCount
        }
      };
    });

    return ApiResponse.paginated(res, processedProducts, {
      page: Number(page), limit: Number(limit), total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) { next(error); }
};

// GET /products/admin/:id (Admin)
exports.getAdminProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name slug');
    if (!product) return ApiResponse.notFound(res, 'Product not found');
    return ApiResponse.success(res, { product });
  } catch (error) { next(error); }
};

// GET /products/:slug
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('category', 'name slug')
      .select('-costPrice -__v');
    
    if (!product) return ApiResponse.notFound(res, 'Product not found');

    // ─── Inject Live Inventory ───
    const Inventory = require('../models/Inventory');
    const liveItems = await Inventory.find({ 
      $or: [
        { productRef: product._id },
        { productName: { $regex: new RegExp('^' + product.name.trim() + '$', 'i') } }
      ],
      onlineEnabled: true 
    }).lean();

    const variants = liveItems.map(inv => ({
      size:     inv.size,
      color:    inv.color,
      // BUG FIX: include reservedStock so available count is accurate
      stock:    Math.max(0, inv.totalStock - inv.onlineSold - inv.offlineSold - (inv.reservedStock || 0) + inv.returned - inv.damaged),
      price:    inv.sellingPrice || product.sellingPrice,
      sku:      inv.sku || product.sku,
      barcode:  inv.barcode,
      _id:      inv._id,
    }));

    const productObj = product.toObject();
    productObj.variants = variants;
    productObj.availableStock = variants.reduce((sum, v) => sum + v.stock, 0);

    // Increment view count async
    Product.findByIdAndUpdate(product._id, { $inc: { viewCount: 1 } }).exec();
    
    return ApiResponse.success(res, { product: productObj });
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

    // For search results, we can just return the display profiles
    // The frontend usually navigates to details where we fetch live stock
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
    
    // 2. Link existing inventory items by name
    const Inventory = require('../models/Inventory');
    await Inventory.updateMany(
      { productName: { $regex: new RegExp('^' + product.name.trim() + '$', 'i') } },
      { productRef: product._id }
    );
    
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
      
      // ERP Logic: Re-link inventory if name changes
      const Inventory = require('../models/Inventory');
      // 1. Unlink old ones
      await Inventory.updateMany({ productRef: product._id }, { productRef: null });
      // 2. Link new ones
      await Inventory.updateMany(
        { productName: { $regex: new RegExp('^' + data.name.trim() + '$', 'i') } },
        { productRef: product._id }
      );
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
    
    // Unlink inventory
    const Inventory = require('../models/Inventory');
    await Inventory.updateMany({ productRef: product._id }, { productRef: null });

    return ApiResponse.success(res, null, 'Product deleted permanently');
  } catch (error) { next(error); }
};

// adjustStock has been moved to inventory.controller.js
// Use PUT /api/v1/admin/inventory/:id/adjust instead
