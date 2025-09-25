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
    this.processedMessageIds = new Set(); // Track processed Message-IDs to prevent duplicates
    this.isConnected = false;

    // Add global error handler to prevent crashes from IMAP errors
    process.on('uncaughtException', (err) => {
      if (err.code === 'ECONNRESET' && err.message) {
        console.error('❌ Caught IMAP ECONNRESET error - reconnecting:', err.message);
        this.isConnected = false;
        setTimeout(() => {
          console.log('🔄 Attempting email monitor reconnection after ECONNRESET...');
          this.connect();
        }, 30000);
        return; // Don't crash the process
      }

      // For other errors, log and exit gracefully
      console.error('❌ Uncaught exception:', err);
      process.exit(1);
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.imap.once('ready', () => {
      console.log('✅ Email monitor connected to Gmail');
      this.isConnected = true;
      this.openInbox();
    });

    this.imap.on('error', (err) => {
      console.error('❌ Email monitor error:', err.message || err);
      this.isConnected = false;

      // Clean up and prevent crash
      try {
        this.imap.end();
      } catch (endErr) {
        console.error('Error ending IMAP connection:', endErr.message);
      }

      // Reconnect after 30 seconds
      setTimeout(() => {
        console.log('🔄 Attempting email monitor reconnection...');
        this.connect();
      }, 30000);
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
      // Recreate IMAP connection if needed
      if (!this.imap || this.imap.state === 'disconnected') {
        this.imap = new Imap({
          user: process.env.EMAIL_USER,
          password: process.env.EMAIL_PASS,
          host: 'imap.gmail.com',
          port: 993,
          tls: true,
          tlsOptions: { rejectUnauthorized: false }
        });
        this.setupEventHandlers();
      }
      this.imap.connect();
    } catch (error) {
      console.error('❌ Failed to connect to IMAP:', error.message);
      this.isConnected = false;
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
      console.log('🔍 Processing all emails from the last 10 minutes (seen and unseen) to catch replies');
      
      // Listen for new messages
      this.imap.on('mail', (numNewMsgs) => {
        console.log(`📧 ${numNewMsgs} new email(s) received`);
        this.fetchNewMessages();
      });

      // Only check for very recent messages on startup (last 10 minutes)
      console.log('🚀 Ready to process new incoming emails...');
      this.fetchNewMessages();
    });
  }

  fetchNewMessages() {
    // Search for emails from the last 10 minutes, both seen and unseen to catch replies
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const searchCriteria = [
      ['SINCE', tenMinutesAgo]
    ];

    this.imap.search(searchCriteria, (err, results) => {
      if (err) {
        console.error('❌ Email search error:', err.message);
        return;
      }

      if (!results || results.length === 0) {
        console.log('📭 No new recent emails');
        return;
      }

      console.log(`📨 Found ${results.length} recent email(s) to check`);

      const fetch = this.imap.fetch(results, {
        bodies: '',
        markSeen: false // Don't mark as seen yet, we'll do it after processing
      });

      fetch.on('message', (msg, seqno) => {
        let buffer = '';
        let uid = null;
        let shouldProcess = false;
        
        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
        });

        msg.once('attributes', (attrs) => {
          uid = attrs.uid;
          
          // Skip if already processed
          if (this.processedMessages.has(uid)) {
            console.log(`⏭️  Skipping already processed email UID: ${uid}`);
            shouldProcess = false;
            return;
          }
          
          shouldProcess = true;
          this.processedMessages.add(uid);
        });

        msg.once('end', async () => {
          if (!shouldProcess) {
            return;
          }
          
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
      const messageId = email.messageId;

      // Check if we've already processed this specific email by Message-ID
      if (messageId && this.processedMessageIds.has(messageId)) {
        console.log(`⏭️  Skipping already processed email Message-ID: ${messageId}`);
        return;
      }

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

      // Mark this Message-ID as processed to prevent duplicate responses
      if (messageId) {
        this.processedMessageIds.add(messageId);
      }

      // Call our existing email processing endpoint
      const apiBase = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const response = await fetch(`${apiBase}/email-notify`, {
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