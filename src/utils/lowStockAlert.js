const Settings = require('../models/Settings');
const whatsapp = require('../services/whatsapp.service');
const logger = require('./logger');

/**
 * Smart Stock Alert System
 * 
 * Logic: 
 * 1. Checks if alerts are enabled in Settings.
 * 2. Compares old stock vs new stock to avoid spam.
 * 3. Triggers only when stock hits/crosses the threshold downwards.
 * 
 * @param {Object} item - The current inventory document (with virtuals)
 * @param {Number} oldStock - (Optional) The stock level before adjustment
 */
const checkAndAlertLowStock = async (item, oldStock = null) => {
  try {
    if (!item) return;
    const settings = await Settings.findOne();
    if (!settings?.notifications?.lowStockAlert?.enabled) return;

    const threshold = item.lowStockThreshold || 5;
    
    // Formula from model: totalStock - onlineSold - offlineSold - reservedStock + returned - damaged
    const currentStock = Math.max(
      0,
      item.totalStock - item.onlineSold - item.offlineSold - (item.reservedStock || 0) + item.returned - item.damaged
    );

    let shouldSend = false;
    
    // If we have context of what it was before
    if (oldStock !== null) {
      // Alert when it FIRST hits or crosses the threshold
      if (oldStock > threshold && currentStock <= threshold) {
        shouldSend = true;
      }
      // Or when it hits zero exactly
      else if (oldStock > 0 && currentStock === 0) {
        shouldSend = true;
      }
    } else {
      // Fallback if no old stock context: only alert if it is currently low
      // Note: This might cause repeated alerts if called repeatedly without oldStock
      if (currentStock <= threshold) {
        shouldSend = true;
      }
    }

    if (shouldSend) {
      const { method } = settings.notifications.lowStockAlert;
      
      if (method === 'whatsapp' || method === 'both') {
        logger.info(`📱 WhatsApp Stock Alert: ${item.productName} (${currentStock} left)`);
        await whatsapp.sendStockAlertToAdmin(item, currentStock);
      }

      if (method === 'email' || method === 'both') {
        const { alertEmail } = settings.notifications.email;
        if (alertEmail) {
           const { sendLowStockEmail } = require('../services/email.service');
           await sendLowStockEmail(alertEmail, item, currentStock).catch(e => logger.error(`Email Alert Error: ${e.message}`));
        }
      }
    }
  } catch (error) {
    logger.error(`❌ Low stock check error: ${error.message}`);
  }
};

module.exports = { checkAndAlertLowStock };
