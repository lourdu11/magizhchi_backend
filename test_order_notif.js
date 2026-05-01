const { sendOrderNotificationToAdmin } = require('./src/services/whatsapp.service');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

async function testOrderNotification() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/magizhchi');
        console.log('Connected to MongoDB');

        const dummyOrder = {
            orderNumber: 'TEST-12345',
            items: [
                { productName: 'Premium Cotton Shirt', variant: { size: 'XL', color: 'White' }, quantity: 2 }
            ],
            shippingAddress: { name: 'Test Customer', phone: '9123456789' },
            pricing: { totalAmount: 1499 },
            paymentMethod: 'cod'
        };

        console.log('Sending New Order Notification to Admin...');
        const result = await sendOrderNotificationToAdmin(dummyOrder);
        
        if (result) {
            console.log('✅ Order notification sent to Admin WhatsApp!');
        } else {
            console.log('❌ Failed to send order notification.');
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

testOrderNotification();
