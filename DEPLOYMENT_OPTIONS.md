# 🚀 Deployment Options for Bluehost SMS Bot

You have **4 different ways** to deploy code changes to your Bluehost production server. Choose the method that best fits your workflow:

---

## 🤖 **Option 1: GitHub Actions Auto-Deploy** (Recommended)

**Automatically deploys when you push to GitHub**

### How it works:
- Push code to `main` branch on GitHub
- GitHub Actions automatically builds and deploys to Bluehost
- Zero manual intervention required
- Includes rollback capabilities

### Setup:
1. **Add GitHub Secrets** (Repository Settings → Secrets and Variables → Actions):
   ```
   BLUEHOST_SSH_KEY - Your private SSH key
   BLUEHOST_HOST - Your domain (e.g., yourdomain.com)
   BLUEHOST_USER - Your Bluehost username
   ```

2. **Generate SSH Key** (run on your local machine):
   ```bash
   ssh-keygen -t rsa -b 4096 -C "github-actions@yourdomain.com"
   # Copy the public key to your Bluehost server
   ssh-copy-id your-username@yourdomain.com
   ```

3. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   # ✨ Deployment happens automatically!
   ```

### ✅ **Pros:**
- Fully automated
- No manual work required
- Built-in verification and rollback
- Perfect for teams
- Deployment logs in GitHub

### ❌ **Cons:**
- Requires GitHub repository
- Need to set up SSH keys

---

## 🔗 **Option 2: Webhook Auto-Deploy**

**Deploy automatically via webhook when you push to GitHub**

### How it works:
- Push code to GitHub
- GitHub sends webhook to your server
- Server automatically pulls and deploys changes
- Runs directly on your Bluehost server

### Setup:
1. **Deploy webhook service** to your server:
   ```bash
   # Copy webhook files to server
   scp -r deploy/ your-username@yourdomain.com:/var/www/html/sms-bot/

   # SSH into server
   ssh your-username@yourdomain.com

   # Start webhook service
   cd /var/www/html/sms-bot/deploy
   pm2 start webhook-deploy.ecosystem.config.js
   pm2 save
   ```

2. **Configure GitHub webhook**:
   - Go to GitHub Repository → Settings → Webhooks
   - Add webhook URL: `https://yourdomain.com:9000/webhook`
   - Set content type: `application/json`
   - Add webhook secret (same as in config)
   - Select "Push events"

3. **Configure Nginx** for webhook port:
   ```nginx
   # Add to your Nginx config
   location /webhook-deploy {
       proxy_pass http://localhost:9000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
   }
   ```

### Usage:
```bash
git add .
git commit -m "Your changes"
git push origin main
# ✨ Webhook triggers automatic deployment!
```

### ✅ **Pros:**
- Automatic deployment
- Runs on your own server
- No external dependencies
- Real-time deployment logs

### ❌ **Cons:**
- Requires webhook setup
- Need to configure firewall/Nginx
- Server needs to be always running

---

## 🖱️ **Option 3: Manual Update Script** (Simplest)

**Run a simple script on the server to pull and deploy changes**

### How it works:
- SSH into your Bluehost server
- Run the update script
- Script handles everything automatically

### Setup:
```bash
# SSH into your server
ssh your-username@yourdomain.com

# Make sure script is executable
chmod +x /var/www/html/sms-bot/deploy/manual-update.sh
```

### Usage:
```bash
# 1. Push your changes to GitHub
git add .
git commit -m "Your changes"
git push origin main

# 2. SSH into server and run update
ssh your-username@yourdomain.com
cd /var/www/html/sms-bot
./deploy/manual-update.sh

# ✨ Updates deployed!
```

### Advanced options:
```bash
# Force update (even if no changes detected)
./deploy/manual-update.sh --force

# Skip backup creation (faster but risky)
./deploy/manual-update.sh --skip-backup

# Get help
./deploy/manual-update.sh --help
```

### ✅ **Pros:**
- Simple and reliable
- Full control over process
- No external setup required
- Built-in backup and rollback

### ❌ **Cons:**
- Manual process
- Need to SSH into server
- Requires remembering to deploy

---

## ⚙️ **Option 4: PM2 Deploy**

**Use PM2's built-in deployment system**

### How it works:
- Use PM2 commands to deploy from your local machine
- PM2 handles SSH, git pull, and application restart
- Professional deployment workflow

### Setup:
1. **Configure SSH access** from your local machine:
   ```bash
   ssh-copy-id your-username@yourdomain.com
   ```

2. **Update deployment config** in `deploy/pm2-deploy.config.js`:
   ```javascript
   user: 'your-bluehost-username',
   host: 'your-domain.com',
   repo: 'https://github.com/yourusername/your-repo.git'
   ```

3. **Initial setup** (run once):
   ```bash
   pm2 deploy deploy/pm2-deploy.config.js production setup
   ```

### Usage:
```bash
# Deploy from your local machine
pm2 deploy deploy/pm2-deploy.config.js production

# Deploy specific branch
pm2 deploy deploy/pm2-deploy.config.js production --force

# Check deployment status
pm2 deploy deploy/pm2-deploy.config.js production exec "pm2 status"
```

### ✅ **Pros:**
- Professional deployment workflow
- Built into PM2 ecosystem
- Supports multiple environments
- Command-line control

### ❌ **Cons:**
- More complex setup
- Requires PM2 knowledge
- Need SSH access configured

---

## 🎯 **Which Option Should You Choose?**

### **For Beginners:** → **Option 3 (Manual Update Script)**
- Simplest to understand and use
- No complex setup required
- Full control over when deployments happen

### **For Regular Development:** → **Option 1 (GitHub Actions)**
- Best developer experience
- Automatic deployments on push
- Professional CI/CD pipeline

### **For Advanced Users:** → **Option 2 (Webhook)**
- Real-time deployments
- Runs on your own infrastructure
- Maximum flexibility

### **For PM2 Experts:** → **Option 4 (PM2 Deploy)**
- Integrates with PM2 ecosystem
- Multiple environment support
- Command-line deployment control

---

## 🔄 **Deployment Process (All Options)**

Regardless of which option you choose, the deployment process includes:

1. **✅ Backup Creation** - Current code backed up automatically
2. **✅ Application Stop** - Graceful shutdown of current version
3. **✅ Code Update** - Pull latest changes from GitHub
4. **✅ Dependencies** - Install/update npm packages if needed
5. **✅ Database Migrations** - Run any database updates
6. **✅ Application Start** - Start new version with PM2
7. **✅ Health Check** - Verify deployment succeeded
8. **✅ Rollback** - Automatic rollback if anything fails

---

## 🚨 **Emergency Rollback**

If something goes wrong, you can rollback quickly:

### **Manual Rollback:**
```bash
# SSH into server
ssh your-username@yourdomain.com

# Find latest backup
ls -la /var/backups/sms-bot/

# Restore backup
cd /var/www/html
sudo tar -xzf /var/backups/sms-bot/backup-TIMESTAMP.tar.gz
pm2 restart sms-bot
```

### **Git Rollback:**
```bash
# SSH into server
ssh your-username@yourdomain.com
cd /var/www/html/sms-bot

# Rollback to previous commit
git reset --hard HEAD~1
npm install --production
pm2 restart sms-bot
```

---

## 📊 **Monitoring Your Deployments**

After deployment, monitor your application:

```bash
# Check application status
pm2 status

# View real-time logs
pm2 logs sms-bot --follow

# Monitor resources
pm2 monit

# Test health endpoint
curl https://yourdomain.com/health

# Check admin panel
curl https://yourdomain.com/admin/status
```

---

## 🎉 **Ready to Deploy!**

Choose your preferred deployment method and start deploying changes to your production SMS bot. All methods are production-ready and include proper error handling, backups, and verification steps.

**Need help?** Check the logs first:
```bash
pm2 logs sms-bot
```