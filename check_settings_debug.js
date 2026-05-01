const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

async function checkSettings() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/magizhchi');
    const settings = await mongoose.connection.db.collection('settings').findOne();
    console.log('Current Settings in DB:', JSON.stringify(settings, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSettings();
