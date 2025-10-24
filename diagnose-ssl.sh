#!/bin/bash

# SSL Diagnostic Script for qubpiz.com
echo "========================================="
echo "SSL Diagnostic for qubpiz.com"
echo "========================================="
echo ""

# Check 1: SSL Certificate Files
echo "1. Checking SSL certificate files..."
if [ -d "/etc/letsencrypt/live/qubpiz.com" ]; then
    echo "✅ SSL directory exists"
    ls -lh /etc/letsencrypt/live/qubpiz.com/
else
    echo "❌ SSL directory NOT found at /etc/letsencrypt/live/qubpiz.com"
    echo "   Certificates need to be generated"
fi
echo ""

# Check 2: Nginx Status
echo "2. Checking nginx status..."
systemctl status nginx --no-pager | head -10
echo ""

# Check 3: Nginx Configuration
echo "3. Checking nginx configuration..."
nginx -t 2>&1
echo ""

# Check 4: Active nginx config
echo "4. Current nginx sites enabled..."
ls -la /etc/nginx/sites-enabled/
echo ""

# Check 5: Port 443 listening
echo "5. Checking if port 443 is listening..."
ss -tlnp | grep :443 || echo "❌ Port 443 is NOT listening"
echo ""

# Check 6: Port 80 listening
echo "6. Checking if port 80 is listening..."
ss -tlnp | grep :80 || echo "❌ Port 80 is NOT listening"
echo ""

# Check 7: Firewall status
echo "7. Checking firewall (ufw)..."
ufw status | head -20
echo ""

# Check 8: Let's Encrypt webroot
echo "8. Checking Let's Encrypt webroot..."
if [ -d "/var/www/letsencrypt" ]; then
    echo "✅ /var/www/letsencrypt exists"
    ls -lhd /var/www/letsencrypt
else
    echo "❌ /var/www/letsencrypt NOT found"
    echo "   Creating directory..."
    sudo mkdir -p /var/www/letsencrypt
    sudo chmod 755 /var/www/letsencrypt
    echo "✅ Created /var/www/letsencrypt"
fi
echo ""

# Check 9: Certbot installation
echo "9. Checking certbot installation..."
which certbot && certbot --version || echo "❌ certbot is NOT installed"
echo ""

# Check 10: DNS Resolution
echo "10. Checking DNS resolution..."
dig +short qubpiz.com A
dig +short www.qubpiz.com A
echo ""

echo "========================================="
echo "Diagnostic complete!"
echo "========================================="
echo ""

# Provide recommendations
if [ ! -d "/etc/letsencrypt/live/qubpiz.com" ]; then
    echo "RECOMMENDATION:"
    echo "SSL certificates are missing. To fix this:"
    echo ""
    echo "1. Ensure /var/www/letsencrypt exists (just created above if missing)"
    echo "2. Ensure ports 80 and 443 are open in firewall"
    echo "3. Run the setup-ssl.sh script:"
    echo "   cd /var/www/qubpiz"
    echo "   bash /path/to/setup-ssl.sh"
    echo ""
fi
