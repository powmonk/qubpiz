# Quick Start Deployment Guide

## First Time Setup (Do this once)

### 1. On Your Droplet

SSH into your droplet and run these commands:

```bash
# Install everything
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs postgresql postgresql-contrib nginx
sudo npm install -g pm2

# Set up database
sudo -u postgres psql << EOF
CREATE DATABASE qubpiz;
CREATE USER qubpiz_user WITH ENCRYPTED PASSWORD 'CHANGE_THIS_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE qubpiz TO qubpiz_user;
\c qubpiz
GRANT ALL ON SCHEMA public TO qubpiz_user;
EOF

# Create app directory
sudo mkdir -p /var/www/qubpiz
sudo chown $USER:$USER /var/www/qubpiz
```

### 2. Configure Nginx

```bash
sudo tee /etc/nginx/sites-available/qubpiz > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;  # Replace with your domain if you have one
    client_max_body_size 10M;

    # Enable gzip compression for better performance
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml;
    gzip_min_length 1000;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/qubpiz /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

## Deploy Your App

### Option 1: Use the Deployment Script (Easiest)

On your **local machine**:

```bash
cd /workspaces/qubpiz
./deploy.sh YOUR_DROPLET_IP
```

That's it! The script will build, package, upload, and deploy everything.

### Option 2: Manual Deployment

On your **local machine**:

```bash
cd /workspaces/qubpiz/qubPiz
npm run build
cd ..
tar -czf qubpiz-deploy.tar.gz \
  --exclude='qubPiz/node_modules' \
  --exclude='qubPiz/server/node_modules' \
  --exclude='qubPiz/.angular' \
  qubPiz/
scp qubpiz-deploy.tar.gz root@YOUR_DROPLET_IP:~/
```

On your **droplet**:

```bash
cd /var/www/qubpiz
tar -xzf ~/qubpiz-deploy.tar.gz --strip-components=1

# Create .env file
cd server
cp .env.example .env
nano .env  # Edit with your database password

# Install and start
npm install --production
mkdir -p uploads/quiz-images
pm2 start index.js --name qubpiz
pm2 save
pm2 startup  # Copy and run the command it outputs
```

## After First Deployment

Visit: `http://YOUR_DROPLET_IP`

You should see your quiz app!

### (Optional) Performance Boost for 1GB Droplet

Your app is already optimized, but these quick commands will help on low-spec servers:

```bash
# Enable swap memory (1GB safety net)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Check memory usage
free -h
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for more performance tips.

## Future Updates

Just run:
```bash
./deploy.sh YOUR_DROPLET_IP
```

## Useful Commands

```bash
# View app logs
ssh root@YOUR_DROPLET_IP "pm2 logs qubpiz"

# Restart app
ssh root@YOUR_DROPLET_IP "pm2 restart qubpiz"

# Check app status
ssh root@YOUR_DROPLET_IP "pm2 status"

# Backup database
ssh root@YOUR_DROPLET_IP "sudo -u postgres pg_dump qubpiz > ~/qubpiz-backup-$(date +%Y%m%d).sql"
```

## Troubleshooting

**App won't start?**
```bash
ssh root@YOUR_DROPLET_IP
pm2 logs qubpiz
```

**Database connection error?**
- Check `/var/www/qubpiz/qubPiz/server/.env` has correct password
- Verify PostgreSQL is running: `sudo systemctl status postgresql`

**Can't access the site?**
- Check Nginx: `sudo nginx -t && sudo systemctl status nginx`
- Check firewall: `sudo ufw status`

For full documentation, see [DEPLOYMENT.md](DEPLOYMENT.md)
