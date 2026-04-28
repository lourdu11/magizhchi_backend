const express = require('express');
const r = express.Router();
const c = require('../controllers/bill.controller');
const { protect, isAdmin, isStaff } = require('../middlewares/auth');

r.post('/create', protect, isStaff, c.createBill);
r.get('/', protect, c.getBills);            // staff + admin can view
r.get('/daily-report', protect, c.getDailyReport);
r.get('/customer/:phone', protect, isStaff, c.lookupCustomer);
r.get('/:id', protect, c.getBill);


module.exports = r;
