# QubPiz Deployment Guide

This guide will help you deploy your quiz application to a DigitalOcean droplet.

## Prerequisites

- A DigitalOcean droplet running Ubuntu 20.04 or later
- SSH access to your droplet
- A domain name (optional but recommended)
- Your droplet's IP address

## Step 1: Prepare Your Droplet

SSH into your droplet:
```bash
ssh root@your_droplet_ip
```

### Install Required Software

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js (v20.x)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node.js installation
node --version  # Should show v20.x
npm --version

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx
sudo apt install -y nginx

# Install PM2 (Node.js process manager)
sudo npm install -g pm2

# Install Git (if not already installed)
sudo apt install -y git
```

## Step 2: Configure PostgreSQL

```bash
# Switch to postgres user and open PostgreSQL prompt
sudo -u postgres psql
```

In the PostgreSQL prompt, run:
```sql
CREATE DATABASE qubpiz;
CREATE USER qubpiz_user WITH ENCRYPTED PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE qubpiz TO qubpiz_user;
\c qubpiz
GRANT ALL ON SCHEMA public TO qubpiz_user;
\q
```

**Important:** Replace `your_secure_password_here` with a strong password!

## Step 3: Deploy Your Application

### Option A: Deploy from Local Machine

On your **local machine**, build and package your app:

```bash
# Navigate to your project
cd /path/to/qubpiz/qubPiz

# Build the Angular app
npm run build

# Create a deployment package (excludes node_modules and dev files)
cd ..
tar -czf qubpiz-deploy.tar.gz \
  --exclude='qubPiz/node_modules' \
  --exclude='qubPiz/server/node_modules' \
  --exclude='qubPiz/.angular' \
  --exclude='qubPiz/server/uploads' \
  qubPiz/

# Copy to your droplet (replace with your droplet IP)
scp qubpiz-deploy.tar.gz root@your_droplet_ip:~/
```

On your **droplet**:

```bash
# Create app directory
mkdir -p /var/www/qubpiz
cd /var/www/qubpiz

# Extract the package
tar -xzf ~/qubpiz-deploy.tar.gz --strip-components=1
rm ~/qubpiz-deploy.tar.gz

# Install server dependencies
cd server
npm install --production

# Create uploads directory
mkdir -p uploads/quiz-images

# Go back to main directory
cd ..
```

### Option B: Deploy from Git Repository (if you have one)

```bash
# Clone your repository
cd /var/www
git clone your_repository_url qubpiz
cd qubpiz/qubPiz

# Install dependencies and build
npm install
npm run build

# Install server dependencies
cd server
npm install --production

# Create uploads directory
mkdir -p uploads/quiz-images
```

## Step 4: Configure Environment Variables

Create a `.env` file in the server directory:

```bash
cd /var/www/qubpiz/qubPiz/server
nano .env
```

Add the following content:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qubpiz
DB_USER=qubpiz_user
DB_PASSWORD=your_secure_password_here
PORT=3000
NODE_ENV=production
```

**Important:** Replace `your_secure_password_here` with the password you created in Step 2!

Save and exit (Ctrl+X, then Y, then Enter).

## Step 5: Set Up PM2 to Run Your App

```bash
# Start the server with PM2
cd /var/www/qubpiz/qubPiz/server
pm2 start index.js --name qubpiz

# Save PM2 configuration
pm2 save

# Set PM2 to start on system boot
pm2 startup systemd
# Follow the command it outputs (copy and paste it)

# Check status
pm2 status
pm2 logs qubpiz
```

## Step 6: Configure Nginx as Reverse Proxy

Create an Nginx configuration file:

```bash
sudo nano /etc/nginx/sites-available/qubpiz
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your_domain.com;  # Replace with your domain or droplet IP

    # Increase max upload size for image uploads
    client_max_body_size 10M;

    # Enable gzip compression (reduces bandwidth by 70-90%)
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;
    gzip_min_length 1000;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and restart Nginx:

```bash
# Create symbolic link to enable the site
sudo ln -s /etc/nginx/sites-available/qubpiz /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Enable Nginx to start on boot
sudo systemctl enable nginx
```

## Step 7: Configure Firewall

```bash
# Allow SSH, HTTP, and HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

## Step 8: (Optional) Set Up SSL with Let's Encrypt

If you have a domain name:

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your_domain.com

# Certbot will automatically configure Nginx for HTTPS
# Follow the prompts
```

## Step 9: (Recommended) Performance Optimizations for 1GB Droplet

Your app is already optimized, but these additional steps will help on a low-spec server:

### Enable Swap Memory (Safety Net)

Adds 1GB virtual memory to prevent crashes:

```bash
# Create 1GB swap file
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
sudo swapon --show
```

### Optimize PostgreSQL for Low Memory

Edit PostgreSQL config:

```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
```

Find and update these lines:

```
shared_buffers = 128MB          # Down from 256MB
effective_cache_size = 256MB    # Down from 512MB
maintenance_work_mem = 64MB     # Down from 128MB
max_connections = 50            # Down from 100
```

Restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

### Monitor Resource Usage

```bash
# Check memory usage
free -h

# Check disk usage
df -h

# Monitor processes
htop  # Install with: sudo apt install htop

# Watch PM2 stats
pm2 monit
```

## Step 10: Test Your Deployment

Visit your application:
- Without domain: `http://your_droplet_ip`
- With domain: `http://your_domain.com`
- With SSL: `https://your_domain.com`

## Useful Commands

### PM2 Management
```bash
pm2 status              # Check app status
pm2 logs qubpiz        # View logs
pm2 restart qubpiz     # Restart app
pm2 stop qubpiz        # Stop app
pm2 start qubpiz       # Start app
pm2 monit              # Monitor resources
```

### Update Your App
```bash
# On your local machine, rebuild
cd /path/to/qubpiz/qubPiz
npm run build

# Create new package
cd ..
tar -czf qubpiz-deploy.tar.gz \
  --exclude='qubPiz/node_modules' \
  --exclude='qubPiz/server/node_modules' \
  --exclude='qubPiz/.angular' \
  qubPiz/

# Copy to droplet
scp qubpiz-deploy.tar.gz root@your_droplet_ip:~/

# On droplet
cd /var/www/qubpiz
tar -xzf ~/qubpiz-deploy.tar.gz --strip-components=1
cd server
npm install --production
pm2 restart qubpiz
```

### Database Management
```bash
# Connect to database
sudo -u postgres psql -d qubpiz

# Backup database
sudo -u postgres pg_dump qubpiz > backup.sql

# Restore database
sudo -u postgres psql qubpiz < backup.sql
```

### View Logs
```bash
# Application logs
pm2 logs qubpiz

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

## Troubleshooting

### App won't start
```bash
# Check PM2 logs
pm2 logs qubpiz

# Check if port 3000 is in use
sudo lsof -i :3000

# Restart everything
pm2 restart qubpiz
sudo systemctl restart nginx
```

### Database connection issues
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check .env file has correct credentials
cat /var/www/qubpiz/qubPiz/server/.env

# Test database connection
sudo -u postgres psql -d qubpiz -c "SELECT 1;"
```

### Nginx issues
```bash
# Test configuration
sudo nginx -t

# Check status
sudo systemctl status nginx

# Restart Nginx
sudo systemctl restart nginx
```

### Permission issues with uploads
```bash
# Set correct permissions
cd /var/www/qubpiz/qubPiz/server
sudo chown -R www-data:www-data uploads/
sudo chmod -R 755 uploads/
```

## Security Recommendations

1. **Change default PostgreSQL password** - Use a strong, unique password
2. **Set up SSL/HTTPS** - Use Let's Encrypt (free)
3. **Configure firewall** - Only allow necessary ports
4. **Regular updates** - Keep system and packages updated
5. **Backup database** - Set up automated backups
6. **Use environment variables** - Never commit `.env` to git
7. **Limit file upload size** - Already configured in Nginx (10MB)

## Performance Tips

1. **Enable Nginx caching** for static assets
2. **Use connection pooling** for PostgreSQL (already configured)
3. **Monitor with PM2** - `pm2 monit` shows CPU/memory usage
4. **Set up log rotation** - PM2 handles this automatically
5. **Consider CDN** for static assets if needed

---

## Quick Reference

**App location:** `/var/www/qubpiz/qubPiz`
**Server code:** `/var/www/qubpiz/qubPiz/server`
**Built frontend:** `/var/www/qubpiz/qubPiz/dist/qubPiz/browser`
**Nginx config:** `/etc/nginx/sites-available/qubpiz`
**Environment:** `/var/www/qubpiz/qubPiz/server/.env`

**Start app:** `pm2 start qubpiz`
**Restart app:** `pm2 restart qubpiz`
**View logs:** `pm2 logs qubpiz`
**App status:** `pm2 status`
