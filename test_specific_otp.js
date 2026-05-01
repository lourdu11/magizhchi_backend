require('dotenv').config();
const { initWhatsApp, sendMessage } = require('./src/services/whatsapp.service');
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');

const test = async () => {
    try {
        await connectDB();
        console.log('Connected to MongoDB');
        
        console.log('Initializing WhatsApp...');
        await initWhatsApp();
        
        // Wait for ready
        console.log('Waiting for WhatsApp to be READY...');
        await new Promise(r => setTimeout(r, 15000));
        
        const phone = '9344881275';
        const otp = '123456';
        const msg = `🔐 *TEST OTP*: ${otp}`;
        
        console.log(`Sending TEST OTP to ${phone}...`);
        await sendMessage(phone, msg);
        console.log('✅ TEST OTP SENT SUCCESSFULLY!');
        
        process.exit(0);
    } catch (err) {
        console.error('❌ TEST FAILED:', err.message);
        process.exit(1);
    }
};

test();
