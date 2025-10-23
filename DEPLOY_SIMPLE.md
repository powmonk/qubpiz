# Simple GitHub-Based Deployment Guide

This guide shows you how to deploy QubPiz using GitHub as your source of truth. No local builds needed!

## Prerequisites

- A DigitalOcean droplet (1GB RAM minimum)
- GitHub repository with your QubPiz code
- SSH access to your server

---

## 🚀 Initial Setup (One Time Only)

### 1. Update the setup script

Before running the setup, edit `server-setup.sh` and change:

```bash
GITHUB_REPO="https://github.com/YOUR_USERNAME/qubpiz.git"
```

to your actual GitHub repository URL.

### 2. Copy setup script to your server

```bash
# On your local machine (or in GitHub codespace)
scp server-setup.sh root@YOUR_SERVER_IP:~/

# SSH into your server
ssh root@YOUR_SERVER_IP
```

### 3. Run the setup script

```bash
# Make it executable
chmod +x server-setup.sh

# Run the setup (this takes 5-10 minutes)
./server-setup.sh
```

The script will:
- Install Node.js, PostgreSQL, Nginx, PM2
- Clone your repository from GitHub
- Set up the database
- Build and start your application
- Configure firewall and swap memory

### 4. Access your app

Once complete, visit `http://YOUR_SERVER_IP` in your browser!

---

## 🔄 Updating Your App (After Code Changes)

You have **three options** to deploy updates:

### Option 1: Manual Update (Simplest)

SSH into your server and run:

```bash
cd /var/www/qubpiz
./server-update.sh
```

This will:
- Pull latest code from GitHub
- Install dependencies
- Rebuild frontend
- Restart the application

**Time:** ~2-3 minutes

### Option 2: GitHub Webhook (Automatic)

Set up automatic deployments when you push to GitHub:

#### a. Add webhook secret to server

SSH into your server:

```bash
# Add webhook secret to .env
echo "WEBHOOK_SECRET=$(openssl rand -base64 32)" | sudo tee -a /var/www/qubpiz/qubPiz/server/.env

# Restart app to load new secret
pm2 restart qubpiz
```

#### b. Get the webhook secret

```bash
# Show your webhook secret
grep WEBHOOK_SECRET /var/www/qubpiz/qubPiz/server/.env
```

Copy the value (everything after `WEBHOOK_SECRET=`)

#### c. Configure GitHub webhook

1. Go to your GitHub repository
2. Click **Settings** → **Webhooks** → **Add webhook**
3. Set **Payload URL**: `http://YOUR_SERVER_IP/api/deploy-webhook`
4. Set **Content type**: `application/json`
5. Set **Secret**: Paste your webhook secret from step b
6. Select **Just the push event**
7. Click **Add webhook**

**Now every push to main branch will auto-deploy!**

### Option 3: Quick One-Liner (From Anywhere)

If you just want to trigger an update remotely without SSH:

```bash
ssh root@YOUR_SERVER_IP 'cd /var/www/qubpiz && ./server-update.sh'
```

---

## 📋 Common Commands

### On Your Server

```bash
# View application logs
pm2 logs qubpiz

# Check application status
pm2 status

# Restart application
pm2 restart qubpiz

# Stop application
pm2 stop qubpiz

# Check if app is responding
curl http://localhost:3000/api/game/status

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### From Your Local Machine

```bash
# SSH into server
ssh root@YOUR_SERVER_IP

# Trigger update remotely
ssh root@YOUR_SERVER_IP 'cd /var/www/qubpiz && ./server-update.sh'

# View logs remotely
ssh root@YOUR_SERVER_IP 'pm2 logs qubpiz --lines 50'
```

---

## 🔧 Troubleshooting

### Application won't start

```bash
# Check logs for errors
pm2 logs qubpiz --err

# Check if database is running
sudo systemctl status postgresql

# Test database connection
cd /var/www/qubpiz/qubPiz/server
node -e "require('dotenv').config(); const {Pool} = require('pg'); new Pool().query('SELECT NOW()').then(r => console.log('DB OK:', r.rows[0])).catch(e => console.error('DB ERROR:', e.message))"
```

### Update script fails

```bash
# Check if script is executable
ls -la /var/www/qubpiz/server-update.sh

# Make it executable
chmod +x /var/www/qubpiz/server-update.sh

# Check git status
cd /var/www/qubpiz
git status
git log -1
```

### Webhook not triggering

```bash
# Check webhook secret is set
grep WEBHOOK_SECRET /var/www/qubpiz/qubPiz/server/.env

# Check PM2 logs for webhook requests
pm2 logs qubpiz | grep webhook

# Test webhook manually
curl -X POST http://YOUR_SERVER_IP/api/deploy-webhook \
  -H "Content-Type: application/json" \
  -d '{"ref":"refs/heads/main"}'
```

### Out of memory

```bash
# Check memory usage
free -h

# Check if swap is active
swapon --show

# Restart application to free memory
pm2 restart qubpiz
```

---

## 🎯 Workflow Summary

Your typical workflow:

1. **Develop locally** or in GitHub Codespaces
2. **Commit and push** to GitHub main branch
3. **Deploy automatically** (if webhook set up) or run `./server-update.sh` on server
4. **App updates** in 2-3 minutes

That's it! No manual builds, no file copying, just push to GitHub and go.

---

## 📊 Performance Notes

This setup is optimized for 1GB servers:

- **Polling interval**: 5 seconds (reduces load by 40% vs 3s)
- **Database connections**: Max 10 (prevents memory exhaustion)
- **Gzip compression**: Enabled (reduces bandwidth by 70-90%)
- **Swap memory**: 1GB safety net
- **Expected capacity**: 20-30 concurrent players

For larger games, consider upgrading to 2GB droplet.
