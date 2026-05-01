const { sendOTP } = require('./src/services/otp.service');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

async function testOTPFlow() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/magizhchi');
        console.log('Connected to MongoDB');

        console.log('--- TESTING EMAIL OTP ---');
        const emailResult = await sendOTP('lncoderise@gmail.com', 'register');
        console.log('Email Result:', emailResult);

        console.log('\n--- TESTING WHATSAPP OTP ---');
        // This will attempt to use the existing socket if running, 
        // but since this is a separate process, it will try to initWhatsApp()
        const whatsappResult = await sendOTP('9384765475', 'register');
        console.log('WhatsApp Result:', whatsappResult);

        process.exit(0);
    } catch (err) {
        console.error('❌ Error during OTP flow:', err);
        process.exit(1);
    }
}

testOTPFlow();
