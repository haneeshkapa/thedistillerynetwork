# Credentials Setup Guide

## 📁 Files Ready for Your Credentials:

### 1. SSH Private Key
**Location:** `~/.ssh/bluehost_key`
**Action:** Paste your entire private key here (including BEGIN/END lines)

### 2. Environment Variables  
**Location:** `.env.bluehost`
**Action:** Fill in your actual values

### 3. Deployment Configuration
**Location:** `deploy-bluehost.sh` 
**Action:** Update REMOTE_HOST and REMOTE_USER

---

## 🔧 Next Steps:

1. **Open SSH key file:**
```bash
nano ~/.ssh/bluehost_key
```
Paste your private key, then Ctrl+X, Y, Enter

2. **Set SSH permissions:**
```bash
chmod 600 ~/.ssh/bluehost_key
```

3. **Edit environment file:**
```bash
nano .env.bluehost
```
Fill in your database and API credentials

4. **Edit deployment script:**  
```bash
nano deploy-bluehost.sh
```
Update lines 8-9 with your domain and username

5. **Deploy:**
```bash
./deploy-bluehost.sh
```

**I've prepared everything - just paste your credentials in the right files!**