const express = require('express');
const r = express.Router();
const c = require('../controllers/admin.controller');
const productController = require('../controllers/product.controller');
const { protect, isAdmin } = require('../middlewares/auth');

r.use(protect, isAdmin);
r.get('/dashboard', c.getDashboardStats);
r.get('/analytics/sales', c.getSalesAnalytics);
r.get('/users', c.getAllUsers);
r.put('/users/:id/toggle-block', c.toggleBlockUser);
r.get('/staff', c.getStaff);
r.post('/staff', c.createStaff);
r.delete('/staff/:id', c.deleteStaff);
r.get('/products', productController.getAdminProducts);
r.get('/inventory/low-stock', c.getLowStock);
r.put('/inventory/adjust', productController.adjustStock);
r.get('/settings', c.getSettings);
r.put('/settings', c.updateSettings);

module.exports = r;
