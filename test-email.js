require('dotenv').config();
const nodemailer = require('nodemailer');

// Configure NodeMailer with SMTP settings from .env
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER || 'bukkyglory2020@gmail.com',
    pass: process.env.SMTP_PASS || 'yimy lawo fnxj bqei',
  },
  tls: {
    rejectUnauthorized: false
  }
});

const mailOptions = {
  from: `TableNow Test <${process.env.EMAIL_FROM || 'bukkyglory2020@gmail.com'}>`,
  to: 'emmanuelwritecode@gmail.com',
  subject: 'Test Email from TableNow (SMTP)',
  text: 'This is a test email to verify that the Gmail SMTP configuration is working properly!',
  html: '<strong>This is a test email to verify that the Gmail SMTP configuration is working properly!</strong>',
};

console.log('Attempting to send test email via SMTP...');

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Error sending test email via SMTP:');
    console.error(error.message);
  } else {
    console.log('✅ Test email sent successfully to emmanuelwritecode@gmail.com');
    console.log('Message ID:', info.messageId);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
  }
});
