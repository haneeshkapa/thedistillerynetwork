/**
 * Email Monitor - Watches Gmail inbox and processes incoming emails
 * Automatically triggers AI responses for customer emails
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fetch = require('node-fetch');
require('dotenv').config();

class EmailMonitor {
  constructor() {
    this.imap = new Imap({
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    this.processedMessages = new Set(); // Track processed message UIDs
    this.isConnected = false;
    
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.imap.once('ready', () => {
      console.log('✅ Email monitor connected to Gmail');
      this.isConnected = true;
      this.openInbox();
    });

    this.imap.once('error', (err) => {
      console.error('❌ Email monitor error:', err.message);
      this.isConnected = false;
      // Reconnect after 30 seconds
      setTimeout(() => this.connect(), 30000);
    });

    this.imap.once('end', () => {
      console.log('📧 Email monitor connection ended');
      this.isConnected = false;
      // Reconnect after 10 seconds
      setTimeout(() => this.connect(), 10000);
    });
  }

  connect() {
    if (this.isConnected) return;
    
    console.log('🔧 Connecting to Gmail IMAP...');
    try {
      this.imap.connect();
    } catch (error) {
      console.error('❌ Failed to connect to IMAP:', error.message);
      setTimeout(() => this.connect(), 30000);
    }
  }

  openInbox() {
    this.imap.openBox('INBOX', false, (err, box) => {
      if (err) {
        console.error('❌ Failed to open inbox:', err.message);
        return;
      }

      console.log(`📬 Monitoring inbox with ${box.messages.total} total messages`);
      
      // Listen for new messages
      this.imap.on('mail', (numNewMsgs) => {
        console.log(`📧 ${numNewMsgs} new email(s) received`);
        this.fetchNewMessages();
      });

      // Process any unread messages on startup
      this.fetchNewMessages();
    });
  }

  fetchNewMessages() {
    // Search for unread messages
    this.imap.search(['UNSEEN'], (err, results) => {
      if (err) {
        console.error('❌ Email search error:', err.message);
        return;
      }

      if (!results || results.length === 0) {
        console.log('📭 No new unread emails');
        return;
      }

      console.log(`📨 Found ${results.length} unread email(s)`);

      const fetch = this.imap.fetch(results, {
        bodies: '',
        markSeen: true
      });

      fetch.on('message', (msg, seqno) => {
        let buffer = '';
        
        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
        });

        msg.once('attributes', (attrs) => {
          const uid = attrs.uid;
          
          // Skip if already processed
          if (this.processedMessages.has(uid)) {
            return;
          }
          this.processedMessages.add(uid);
        });

        msg.once('end', async () => {
          try {
            const parsed = await simpleParser(buffer);
            await this.processEmail(parsed);
          } catch (error) {
            console.error('❌ Error processing email:', error.message);
          }
        });
      });

      fetch.once('error', (err) => {
        console.error('❌ Fetch error:', err.message);
      });
    });
  }

  async processEmail(email) {
    try {
      const fromEmail = email.from?.value?.[0]?.address?.toLowerCase();
      const subject = email.subject || 'No Subject';
      const body = email.text || email.html || 'No content';
      const toEmail = email.to?.value?.[0]?.address?.toLowerCase();

      console.log(`📧 Processing email from ${fromEmail}: "${subject}"`);

      // Skip emails from ourselves to avoid loops
      if (fromEmail === process.env.EMAIL_USER?.toLowerCase()) {
        console.log('⏭️  Skipping email from self');
        return;
      }

      // Skip if not sent to our monitored email
      if (toEmail !== process.env.EMAIL_USER?.toLowerCase()) {
        console.log('⏭️  Skipping email not sent to monitored address');
        return;
      }

      // Call our existing email processing endpoint
      const response = await fetch('http://localhost:3000/email-notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from_email: fromEmail,
          subject: subject,
          body: body,
          to_email: toEmail
        })
      });

      const result = await response.json();
      
      if (result.success !== false) {
        console.log(`✅ Email processed successfully for ${fromEmail}`);
        if (result.email_sent) {
          console.log(`📤 AI response sent to ${fromEmail}`);
        }
      } else {
        console.log(`⚠️  Email processed but no response sent: ${result.message}`);
      }

    } catch (error) {
      console.error('❌ Error in processEmail:', error.message);
    }
  }

  start() {
    console.log('🚀 Starting email monitor...');
    this.connect();
  }

  stop() {
    if (this.imap) {
      this.imap.end();
    }
  }
}

// For use in server.js
module.exports = EmailMonitor;

// For standalone running
if (require.main === module) {
  const monitor = new EmailMonitor();
  monitor.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📧 Stopping email monitor...');
    monitor.stop();
    process.exit(0);
  });
}