# Free Deployment Options for Claude SMS Bot

## 🚀 Recommended: Railway (Best Balance)

### Why Railway?
- $5 free credits monthly (plenty for SMS bot)
- Easy GitHub deployment
- Environment variables support
- Custom domains
- No cold starts

### Deploy to Railway:
1. Create account at [railway.app](https://railway.app)
2. Connect your GitHub account
3. Push this code to a GitHub repo
4. Click "New Project" → "Deploy from GitHub repo"
5. Select your repository
6. Add environment variables:
   ```
   GOOGLE_SHEET_ID=your_sheet_id
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your_email
   GOOGLE_PRIVATE_KEY=your_private_key
   ANTHROPIC_API_KEY=your_claude_key
   PORT=3000
   ```
7. Deploy automatically happens
8. Get your public URL (like `https://your-app.railway.app`)

## 🆓 Alternative: Render (100% Free)

### Deploy to Render:
1. Create account at [render.com](https://render.com)
2. Click "New" → "Web Service"
3. Connect GitHub and select your repo
4. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node
5. Add environment variables (same as Railway)
6. Deploy (takes 5-10 minutes first time)

**⚠️ Note**: Render free tier sleeps after 15 minutes of inactivity. First request after sleep takes ~30 seconds.

## ⚡ Quick Option: Glitch (Instant)

### Deploy to Glitch:
1. Go to [glitch.com](https://glitch.com)
2. Click "New Project" → "Import from GitHub"
3. Enter your repo URL
4. Edit `.env` file directly in their editor
5. Project auto-deploys instantly
6. Get URL like `https://your-project-name.glitch.me`

**⚠️ Note**: Glitch sleeps after 5 minutes, but wakes up quickly.

## 🔧 For Advanced Users: Fly.io (Best Performance)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login and launch
fly auth login
fly launch

# Set secrets
fly secrets set GOOGLE_SHEET_ID=your_id
fly secrets set ANTHROPIC_API_KEY=your_key
fly secrets set GOOGLE_PRIVATE_KEY="your_key"
fly secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=your_email

# Deploy
fly deploy
```

## 📱 Update Tasker with Your Server URL

After deployment, update your Tasker HTTP Request action:
- **Railway**: `https://your-app.railway.app/reply`
- **Render**: `https://your-app-name.onrender.com/reply`  
- **Glitch**: `https://your-project-name.glitch.me/reply`
- **Fly.io**: `https://your-app-name.fly.dev/reply`

## 🧪 Test Your Deployment

```bash
# Test health endpoint
curl https://your-server-url.com/health

# Test SMS reply endpoint  
curl -X POST https://your-server-url.com/reply \
  -H "Content-Type: application/json" \
  -d '{"phone":"1234567890","message":"Where is my order?"}'
```

## 🔒 Security Notes

- Never commit `.env` file to git
- Keep your service account JSON file secure
- Use environment variables for all secrets
- Consider adding basic auth for production use

## 💰 Cost Comparison

| Platform | Free Tier | Pros | Cons |
|----------|-----------|------|------|
| Railway | $5/month credits | Fast, no cold start | Credits limit |
| Render | 100% free | Truly free | Cold starts |
| Glitch | 100% free | Instant deploy | Short sleep time |
| Fly.io | 3 VMs free | Best performance | CLI learning curve |

**Recommendation**: Start with Railway for reliability, switch to Render if you need truly free long-term.