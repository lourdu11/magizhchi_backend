const nodemailer = require('nodemailer');

async function testEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'lncoderise@gmail.com',
      pass: 'dvfsrtpsyandigpx', // The app password
    },
  });

  try {
    console.log('Testing SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP Connection is valid!');

    console.log('Sending test email...');
    const info = await transporter.sendMail({
      from: '"Magizhchi Test" <lncoderise@gmail.com>',
      to: 'lncoderise@gmail.com',
      subject: 'SMTP Test',
      text: 'If you see this, your SMTP settings are working!',
    });
    console.log('✅ Email sent:', info.messageId);
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.response) console.error('Response:', err.response);
  }
}

testEmail();
