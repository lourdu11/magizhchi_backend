const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ApiResponse = require('../utils/apiResponse');

exports.getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ userId: req.user._id })
      .populate('items.productId', 'name images sellingPrice discountedPrice isActive variants');
    if (!cart) cart = { items: [] };
    return ApiResponse.success(res, { cart });
  } catch (error) { next(error); }
};

exports.addToCart = async (req, res, next) => {
  try {
    const { productId, size, color, quantity = 1 } = req.body;
    const product = await Product.findById(productId);
    if (!product || !product.isActive) return ApiResponse.notFound(res, 'Product not found');

    const variant = product.variants.find(v => v.size === size && v.color === color);
    if (!variant) return ApiResponse.error(res, 'Variant not found', 404);

    const available = variant.stock - variant.reservedStock;
    if (available < quantity) return ApiResponse.error(res, `Only ${available} items available`, 400);

    let cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) cart = await Cart.create({ userId: req.user._id, items: [] });

    const existingIdx = cart.items.findIndex(
      i => i.productId.toString() === productId && i.variant.size === size && i.variant.color === color
    );

    if (existingIdx > -1) {
      cart.items[existingIdx].quantity = Math.min(10, cart.items[existingIdx].quantity + quantity);
    } else {
      cart.items.push({ productId, variant: { size, color }, quantity });
    }

    await cart.save();
    await cart.populate('items.productId', 'name images sellingPrice discountedPrice variants');
    return ApiResponse.success(res, { cart }, 'Added to cart');
  } catch (error) { next(error); }
};

exports.updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) return ApiResponse.notFound(res, 'Cart not found');

    const item = cart.items.id(req.params.itemId);
    if (!item) return ApiResponse.notFound(res, 'Item not found');

    if (quantity <= 0) {
      item.deleteOne();
    } else {
      item.quantity = Math.min(10, quantity);
    }

    await cart.save();
    return ApiResponse.success(res, { cart }, 'Cart updated');
  } catch (error) { next(error); }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) return ApiResponse.notFound(res, 'Cart not found');

    cart.items = cart.items.filter(i => i._id.toString() !== req.params.itemId);
    await cart.save();
    return ApiResponse.success(res, { cart }, 'Item removed');
  } catch (error) { next(error); }
};

exports.clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate({ userId: req.user._id }, { items: [] });
    return ApiResponse.success(res, null, 'Cart cleared');
  } catch (error) { next(error); }
};
