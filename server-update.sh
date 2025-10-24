#!/bin/bash

# QubPiz Server Update Script
# Run this directly on your DigitalOcean server to pull latest code from GitHub

set -e  # Exit on any error

echo "🚀 QubPiz Update Script"
echo "======================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}→ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }

# Configuration
APP_DIR="/var/www/qubpiz"
BRANCH="main"

# Check if we're in the right directory
if [ ! -d "$APP_DIR" ]; then
    print_error "Application directory not found: $APP_DIR"
    print_info "Please run the initial setup first"
    exit 1
fi

cd $APP_DIR

# Check if it's a git repository
if [ ! -d ".git" ]; then
    print_error "Not a git repository!"
    print_info "Please run initial setup first"
    exit 1
fi

# Stop the application
print_info "Stopping application..."
pm2 stop qubpiz 2>/dev/null || true
print_success "Application stopped"

# Backup .env file
print_info "Backing up .env file..."
cp qubPiz/server/.env /tmp/.env.backup
print_success ".env backed up"

# Pull latest code
print_info "Pulling latest code from GitHub..."
git fetch origin
git reset --hard origin/$BRANCH
print_success "Code updated to latest version"

# Restore .env file
print_info "Restoring .env file..."
cp /tmp/.env.backup qubPiz/server/.env
print_success ".env restored"

# Install/update server dependencies
print_info "Installing server dependencies..."
cd qubPiz/server
npm install --production
print_success "Server dependencies updated"

# Build frontend
print_info "Building Angular frontend..."
cd ..
npm install
npm run build
print_success "Frontend built successfully"

# Update Nginx configuration (preserving SSL if it exists)
print_info "Checking Nginx configuration..."

# Check if SSL is already configured
if [ -f /etc/letsencrypt/live/qubpiz.com/fullchain.pem ]; then
    print_info "SSL certificate detected - updating with HTTPS configuration..."
    sudo tee /etc/nginx/sites-available/qubpiz > /dev/null <<'NGINX_EOF'
# HTTP server - redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name qubpiz.com www.qubpiz.com;

    # Let's Encrypt verification
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
        allow all;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name qubpiz.com www.qubpiz.com;

    # SSL certificate configuration
    ssl_certificate /etc/letsencrypt/live/qubpiz.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qubpiz.com/privkey.pem;

    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml;
    gzip_min_length 1000;

    # Serve Angular app
    location / {
        root /var/www/qubpiz/qubPiz/dist/qubPiz/browser;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Express
    location /api {
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

    # Serve uploaded images
    location /uploads {
        alias /var/www/qubpiz/qubPiz/server/uploads;
    }
}
NGINX_EOF
    print_success "Nginx configuration updated with SSL preserved"
else
    print_info "No SSL certificate detected - using HTTP configuration..."
    sudo tee /etc/nginx/sites-available/qubpiz > /dev/null <<'NGINX_EOF'
server {
    listen 80;
    server_name qubpiz.com www.qubpiz.com _;

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml;
    gzip_min_length 1000;

    # Let's Encrypt verification (must be before / location)
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
        allow all;
    }

    # Serve Angular app
    location / {
        root /var/www/qubpiz/qubPiz/dist/qubPiz/browser;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Express
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Serve uploaded images
    location /uploads {
        alias /var/www/qubpiz/qubPiz/server/uploads;
    }
}
NGINX_EOF
    print_success "Nginx configuration updated with HTTP only"
fi

sudo nginx -t && sudo systemctl reload nginx

# Restart application
print_info "Starting application..."
cd server
pm2 start index.js --name qubpiz 2>/dev/null || pm2 restart qubpiz
pm2 save
print_success "Application started"

# Show status
echo ""
print_success "✨ Update complete!"
echo ""
print_info "Application status:"
pm2 list
echo ""
print_info "Useful commands:"
echo "  • View logs:    pm2 logs qubpiz"
echo "  • Restart app:  pm2 restart qubpiz"
echo "  • Stop app:     pm2 stop qubpiz"
echo "  • App status:   pm2 status"
