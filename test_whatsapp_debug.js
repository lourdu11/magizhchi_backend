const { initWhatsApp, sendMessage, isReady } = require('./src/services/whatsapp.service');
const logger = require('./src/utils/logger');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

async function testWhatsApp() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/magizhchi');
        console.log('Connected to MongoDB');

        console.log('Initializing WhatsApp...');
        await initWhatsApp();

        // Wait for connection
        console.log('Waiting for WhatsApp to be ready...');
        for (let i = 0; i < 30; i++) {
            if (isReady()) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!isReady()) {
            console.error('❌ WhatsApp failed to connect within 30s. Please check terminal for QR code.');
            process.exit(1);
        }

        console.log('✅ WhatsApp is READY. Sending test message to 9384765475...');
        const result = await sendMessage('9384765475', '🤖 *SYSTEM TEST*\nThis is a test notification from your ERP system.');
        
        if (result) {
            console.log('✅ Test message sent successfully!');
        } else {
            console.log('❌ Failed to send message.');
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

testWhatsApp();
