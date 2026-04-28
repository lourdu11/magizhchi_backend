const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    store: {
      name: { type: String, default: 'Magizhchi Garments' },
      logo: String,
      favicon: String,
      email: String,
      phone: String,
      address: String,
      gstin: String,
      whatsapp: String,
    },
    shipping: {
      flatRate: { type: Number, default: 50 },
      freeShippingThreshold: { type: Number, default: 999 },
      estimatedDays: {
        metro: { type: Number, default: 3 },
        other: { type: Number, default: 6 },
        remote: { type: Number, default: 10 },
      },
    },
    gst: {
      rate: { type: Number, default: 18 },
      enabled: { type: Boolean, default: true },
      cgst: { type: Number, default: 9 },
      sgst: { type: Number, default: 9 },
    },
    social: {
      facebook: String,
      instagram: String,
      twitter: String,
      youtube: String,
    },
    payment: {
      razorpayKeyId: String,
      razorpayKeySecret: { type: String, select: false },
      codEnabled: { type: Boolean, default: true },
      codCharges: { type: Number, default: 50 },
      codThreshold: { type: Number, default: 5000 },
    },
    notifications: {
      email: {
        host: String,
        port: { type: Number, default: 587 },
        user: String,
        password: { type: String, select: false },
      },
      whatsapp: {
        adminPhone: { type: String, default: '7358885452' },
        apiKey: { type: String, select: false },
      },
    },

    seo: {
      metaTitle: { type: String, default: 'Magizhchi Garments - Premium Men\'s Clothing' },
      metaDescription: String,
      googleAnalyticsId: String,
      facebookPixelId: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', settingsSchema);
