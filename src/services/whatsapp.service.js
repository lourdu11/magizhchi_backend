const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const logger = require('../utils/logger');
const Settings = require('../models/Settings');

let sock = null;
let isReady = false;
let isInitializing = false;

/**
 * ARCHITECTURE: PURE SOCKET MODE (NO BROWSER)
 * 1. Uses Baileys to connect directly to WhatsApp via WebSockets.
 * 2. No Chrome, No Puppeteer, No memory-heavy processes.
 * 3. Session stored in .whatsapp-session/baileys-auth.
 */

const getAdminSettings = async () => {
  try {
    const settings = await Settings.findOne();
    return {
      adminPhone: settings?.notifications?.whatsapp?.adminPhone || process.env.STORE_PHONE,
      storeName: settings?.storeName || 'Magizhchi Garments'
    };
  } catch (err) {
    return { adminPhone: process.env.STORE_PHONE, storeName: 'Magizhchi Garments' };
  }
};

const initWhatsApp = async () => {
    if (isInitializing) return;
    isInitializing = true;

    const sessionPath = path.resolve(__dirname, '../../.whatsapp-session/baileys-auth');
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    logger.info('📱 WhatsApp: Initializing Pure Socket Client (Baileys)...');

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false, // Handled manually for better logging
        logger: pino({ level: 'silent' }),
        browser: ['Magizhchi API', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('📱 WhatsApp: Scan this QR Code to connect:');
            qrcode.generate(qr, { small: true });
            
            // Also provide a clickable link for cloud environments where terminal QR might be distorted
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            logger.info(`🔗 QR Link (if terminal QR is distorted): ${qrLink}`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.warn(`⚠️ WhatsApp: Connection closed. Reason: ${lastDisconnect?.error?.message}. Reconnecting: ${shouldReconnect}`);
            isReady = false;
            isInitializing = false;
            if (shouldReconnect) initWhatsApp();
        } else if (connection === 'open') {
            isReady = true;
            isInitializing = false;
            logger.info('✅ WhatsApp Ready: [Socket Connected]');
        }
    });

    return sock;
};

const sendMessage = async (phone, message, retries = 3) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const withCountry = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
    const jid = `${withCountry}@s.whatsapp.net`;

    for (let i = 0; i < retries; i++) {
        try {
            if (!isReady || !sock) {
                await initWhatsApp();
                // Wait for connection to be ready (short poll)
                for (let j = 0; j < 10; j++) {
                    if (isReady) break;
                    await new Promise(r => setTimeout(r, 1000));
                }
                if (!isReady) throw new Error('WhatsApp socket not ready');
            }

            await sock.sendMessage(jid, { text: message });
            logger.info(`✅ WhatsApp message sent to +${withCountry}`);
            return true;
        } catch (err) {
            logger.warn(`⚠️ WhatsApp Send Attempt ${i + 1} failed: ${err.message}`);
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
};

const sendContactMessageNotificationToAdmin = async (contact) => {
    const { adminPhone } = await getAdminSettings();
    if (!adminPhone) return;

    const msg = `📩 *NEW CONTACT MESSAGE*\n` +
                `*Magizhchi Garments*\n` +
                `──────────────────\n\n` +
                `👤 *Name:* ${contact.name}\n` +
                `📞 *Phone:* ${contact.phone}\n` +
                `📧 *Email:* ${contact.email || 'N/A'}\n` +
                `🏷️ *Subject:* ${contact.subject || 'N/A'}\n\n` +
                `💬 *Message:*\n_${contact.message}_\n\n` +
                `──────────────────\n` +
                `*Please respond promptly.*`;
                
    return await sendMessage(adminPhone, msg);
};

const sendOrderNotificationToAdmin = async (order) => {
    const { adminPhone } = await getAdminSettings();
    if (!adminPhone) return;

    const itemsSummary = order.items.map(item => `- ${item.productName} (${item.variant.size}/${item.variant.color}) x${item.quantity}`).join('\n');

    const msg = `🛍️ *NEW ORDER RECEIVED!*\n` +
                `*Magizhchi Garments*\n` +
                `──────────────────\n\n` +
                `📦 *Order ID:* #${order.orderNumber}\n` +
                `👤 *Customer:* ${order.shippingAddress.name}\n` +
                `📞 *Phone:* ${order.shippingAddress.phone}\n` +
                `💰 *Total:* ₹${order.pricing.totalAmount.toLocaleString('en-IN')}\n` +
                `💳 *Payment:* ${order.paymentMethod.toUpperCase()}\n\n` +
                `🛒 *Items:*\n${itemsSummary}\n\n` +
                `──────────────────\n` +
                `*Check the Admin Dashboard for details.*`;

    return await sendMessage(adminPhone, msg);
};

const sendOrderCancellationNotificationToAdmin = async (order, reason) => {
    const { adminPhone } = await getAdminSettings();
    if (!adminPhone) return;

    const msg = `🚫 *ORDER CANCELLED*\n` +
                `*Magizhchi Garments*\n` +
                `──────────────────\n\n` +
                `📦 *Order ID:* #${order.orderNumber}\n` +
                `👤 *Customer:* ${order.shippingAddress.name}\n` +
                `💰 *Total:* ₹${order.pricing.totalAmount.toLocaleString('en-IN')}\n\n` +
                `⚠️ *Reason:* ${reason || 'Not provided'}\n\n` +
                `──────────────────`;

    return await sendMessage(adminPhone, msg);
};

const sendWhatsAppOTP = async (phone, otp) => {
    const { storeName } = await getAdminSettings();
    const msg = `🔐 *SECURE OTP*\n` +
                `*${storeName.toUpperCase()}*\n` +
                `──────────────────\n\n` +
                `Your verification code is:\n` +
                `*${otp}*\n\n` +
                `Valid for 10 minutes. Please do not share this code with anyone.\n\n` +
                `──────────────────`;
    return await sendMessage(phone, msg);
};

const sendWhatsAppNotification = async (phone, message) => {
    const { storeName } = await getAdminSettings();
    const msg = `📢 *OFFICIAL NOTIFICATION*\n` +
                `*${storeName}*\n` +
                `──────────────────\n\n` +
                `${message}\n\n` +
                `──────────────────`;
    return await sendMessage(phone, msg);
};

module.exports = {
    initWhatsApp,
    sendMessage,
    sendWhatsAppOTP,
    sendWhatsAppNotification,
    sendOrderNotificationToAdmin,
    sendOrderCancellationNotificationToAdmin,
    sendContactMessageNotificationToAdmin,
    isReady: () => isReady
};
