#!/bin/bash

# QubPiz Initial Server Setup Script
# Run this once on a fresh DigitalOcean droplet to set up everything

set -e

echo "🚀 QubPiz Initial Setup"
echo "======================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}→ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }

# Configuration - UPDATE THESE
GITHUB_REPO="https://github.com/powmonk/qubpiz.git"
APP_DIR="/var/www/qubpiz"
BRANCH="main"

print_info "This script will set up QubPiz on your server"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "Please don't run as root. Run as regular user with sudo access."
    exit 1
fi

# Update system
print_info "Updating system packages..."
sudo apt update
sudo apt upgrade -y
print_success "System updated"

# Install Node.js 18
print_info "Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi
print_success "Node.js installed: $(node -v)"

# Install PostgreSQL
print_info "Installing PostgreSQL..."
if ! command -v psql &> /dev/null; then
    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
fi
print_success "PostgreSQL installed"

# Install PM2
print_info "Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    pm2 startup | tail -n 1 | sudo bash
fi
print_success "PM2 installed"

# Install Nginx
print_info "Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx
fi
print_success "Nginx installed"

# Clone repository
print_info "Cloning repository from GitHub..."
if [ -d "$APP_DIR" ]; then
    print_info "Directory already exists, pulling latest..."
    cd $APP_DIR
    git pull origin $BRANCH
else
    sudo mkdir -p $APP_DIR
    sudo chown $USER:$USER $APP_DIR
    git clone $GITHUB_REPO $APP_DIR
    cd $APP_DIR
    git checkout $BRANCH
fi
print_success "Repository cloned"

# Set up database
print_info "Setting up PostgreSQL database..."
echo ""
print_info "Please enter database details:"
read -p "Database name [qubpiz]: " DB_NAME
DB_NAME=${DB_NAME:-qubpiz}

read -p "Database user [qubpiz_user]: " DB_USER
DB_USER=${DB_USER:-qubpiz_user}

read -sp "Database password: " DB_PASSWORD
echo ""

sudo -u postgres psql <<EOF
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH ENCRYPTED PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF

print_success "Database created"

# Import database schema
if [ -f "$APP_DIR/database.sql" ]; then
    print_info "Importing database schema..."
    PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -f $APP_DIR/database.sql
    print_success "Database schema imported"
fi

# Create .env file
print_info "Creating .env file..."
cat > $APP_DIR/qubPiz/server/.env <<EOF
# Database Configuration
DB_USER=$DB_USER
DB_HOST=localhost
DB_NAME=$DB_NAME
DB_PASSWORD=$DB_PASSWORD
DB_PORT=5432

# Server Configuration
PORT=3000
NODE_ENV=production

# Session Secret (auto-generated)
SESSION_SECRET=$(openssl rand -base64 32)
EOF

print_success ".env file created"

# Install dependencies
print_info "Installing server dependencies..."
cd $APP_DIR/qubPiz/server
npm install --production
print_success "Server dependencies installed"

# Build frontend
print_info "Building Angular frontend..."
cd $APP_DIR/qubPiz
npm install
npm run build
print_success "Frontend built"

# Set up Nginx
print_info "Configuring Nginx..."
sudo tee /etc/nginx/sites-available/qubpiz > /dev/null <<'EOF'
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

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/qubpiz/qubPiz/dist/qubPiz/browser;
        try_files $uri =404;
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
EOF

sudo ln -sf /etc/nginx/sites-available/qubpiz /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
print_success "Nginx configured"

# Start application with PM2
print_info "Starting application..."
cd $APP_DIR/qubPiz/server
pm2 start index.js --name qubpiz
pm2 save
print_success "Application started"

# Set up swap memory (for 1GB droplet)
print_info "Setting up swap memory..."
if [ ! -f /swapfile ]; then
    sudo fallocate -l 1G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    print_success "Swap memory configured (1GB)"
else
    print_info "Swap already exists, skipping"
fi

# Set up firewall
print_info "Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
echo "y" | sudo ufw enable
print_success "Firewall configured"

# Final status
echo ""
echo "═══════════════════════════════════════"
print_success "✨ Setup Complete!"
echo "═══════════════════════════════════════"
echo ""
print_info "Your QubPiz installation is ready!"
echo ""
echo "📝 Next steps:"
echo "  1. Get your server's IP: curl ifconfig.me"
echo "  2. Visit http://YOUR_SERVER_IP"
echo "  3. Log in with default credentials (if configured)"
echo ""
echo "🔧 Useful commands:"
echo "  • View logs:      pm2 logs qubpiz"
echo "  • Restart app:    pm2 restart qubpiz"
echo "  • Stop app:       pm2 stop qubpiz"
echo "  • Update code:    ./server-update.sh"
echo ""
echo "📚 For updates from GitHub, run:"
echo "  cd $APP_DIR && ./server-update.sh"
echo ""
