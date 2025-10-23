# GitHub to Droplet Deployment Guide

Deploy QubPiz directly from GitHub to your DigitalOcean droplet. Everything builds on the server - no local builds needed!

## Prerequisites

- DigitalOcean droplet (1GB RAM minimum, Ubuntu 22.04)
- GitHub repository with your QubPiz code
- SSH access to your droplet

---

## 🚀 Initial Setup (First Time Only)

### Step 1: Prepare Setup Script

On your local machine or in GitHub Codespaces:

```bash
# Edit server-setup.sh and update your GitHub repo URL
nano server-setup.sh

# Change this line:
GITHUB_REPO="https://github.com/YOUR_USERNAME/qubpiz.git"
```

### Step 2: Copy Script to Droplet

```bash
# Copy setup script to your droplet
scp server-setup.sh root@YOUR_DROPLET_IP:~/

# SSH into your droplet
ssh root@YOUR_DROPLET_IP
```

### Step 3: Run Setup

```bash
# Make executable and run
chmod +x server-setup.sh
./server-setup.sh
```

**Setup takes 5-10 minutes.** The script will:
- Install Node.js, PostgreSQL, Nginx, PM2
- Clone your GitHub repository
- Set up database
- Build Angular frontend
- Start the application
- Configure firewall

### Step 4: Access Your App

Visit `http://YOUR_DROPLET_IP` in your browser!

---

## 🔄 Deploying Updates

After you push code to GitHub, choose one of these options:

### Option A: Manual Update (Recommended)

SSH into your droplet:

```bash
ssh root@YOUR_DROPLET_IP
cd /var/www/qubpiz
./server-update.sh
```

**Takes 2-3 minutes.** Updates and restarts the app automatically.

### Option B: One-Line Remote Update

From your local machine (no SSH session needed):

```bash
ssh root@YOUR_DROPLET_IP 'cd /var/www/qubpiz && ./server-update.sh'
```

### Option C: Automatic GitHub Webhook

Set up once, then every push to main auto-deploys:

**On your droplet:**
```bash
# Generate and add webhook secret
echo "WEBHOOK_SECRET=$(openssl rand -base64 32)" | sudo tee -a /var/www/qubpiz/qubPiz/server/.env
pm2 restart qubpiz

# Get the secret (copy this)
grep WEBHOOK_SECRET /var/www/qubpiz/qubPiz/server/.env
```

**On GitHub:**
1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. Payload URL: `http://YOUR_DROPLET_IP/api/deploy-webhook`
3. Content type: `application/json`
4. Secret: Paste the secret from above
5. Select: **Just the push event**
6. Click **Add webhook**

Now every push to main branch deploys automatically!

---

## 📋 Useful Commands

### Check App Status

```bash
# View logs
pm2 logs qubpiz

# Check status
pm2 status

# Restart app
pm2 restart qubpiz

# Test if backend is responding
curl http://localhost:3000/api/game/status
```

### View Logs Remotely

```bash
# From your local machine
ssh root@YOUR_DROPLET_IP 'pm2 logs qubpiz --lines 50'
```

---

## 🔧 Troubleshooting

### App Won't Start

```bash
# Check error logs
pm2 logs qubpiz --err

# Verify database is running
sudo systemctl status postgresql

# Test database connection
cd /var/www/qubpiz/qubPiz/server
node -e "require('dotenv').config(); const {Pool} = require('pg'); new Pool().query('SELECT NOW()').then(r => console.log('DB OK:', r.rows[0])).catch(e => console.error('DB ERROR:', e.message))"
```

### Update Script Fails

```bash
# Check git status
cd /var/www/qubpiz
git status
git log -1

# Make script executable if needed
chmod +x /var/www/qubpiz/server-update.sh
```

### Out of Memory

```bash
# Check memory usage
free -h

# Verify swap is active
swapon --show

# Restart to free memory
pm2 restart qubpiz
```

---

## 🎯 Typical Workflow

1. **Code** in GitHub Codespaces or locally
2. **Commit and push** to GitHub main branch
3. **Deploy:**
   - With webhook: Automatic (wait 2-3 min)
   - Manual: SSH and run `./server-update.sh`
4. **Done!** App is live

---

## 📊 Server Specs

Optimized for 1GB droplets:
- **Concurrent players:** 20-30
- **Database connections:** Max 10
- **Swap memory:** 1GB safety buffer
- **Polling interval:** 5 seconds
- **Compression:** Gzip enabled

Need more capacity? Upgrade to 2GB droplet.
