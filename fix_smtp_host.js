const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

async function fixSettings() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/magizhchi');
    console.log('Connected to MongoDB');

    const update = {
      $set: {
        'notifications.email.host': 'smtp.gmail.com',
        'notifications.email.port': 587,
        'notifications.email.user': 'lncoderise@gmail.com',
        'notifications.email.password': 'dvfs rtps yand igpx', // Using spaces as provided
        'notifications.email.alertEmail': 'lncoderise@gmail.com',
        'store.email': 'lncoderise@gmail.com'
      }
    };

    const result = await mongoose.connection.db.collection('settings').updateOne({}, update);
    console.log('Settings fixed successfully');
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fixSettings();
