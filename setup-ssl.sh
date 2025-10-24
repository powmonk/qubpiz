#!/bin/bash

# Script to set up SSL for qubpiz.com using Let's Encrypt

echo "Setting up SSL for qubpiz.com..."

# Step 1: Obtain SSL certificate
echo "Step 1: Obtaining SSL certificate from Let's Encrypt..."
sudo certbot certonly --webroot \
  -w /var/www/letsencrypt \
  -d qubpiz.com \
  -d www.qubpiz.com \
  --non-interactive \
  --agree-tos \
  --email aldron@qubpiz.com \
  --keep-until-expiring

if [ $? -ne 0 ]; then
    echo "Failed to obtain certificate. Check that:"
    echo "1. DNS points to this server"
    echo "2. Port 80 is accessible from the internet"
    echo "3. Nginx is running"
    exit 1
fi

# Step 2: Create new nginx configuration with SSL
echo "Step 2: Creating nginx configuration with SSL..."
sudo tee /etc/nginx/sites-available/qubpiz > /dev/null <<'EOF'
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
EOF

# Step 3: Test nginx configuration
echo "Step 3: Testing nginx configuration..."
sudo nginx -t

if [ $? -ne 0 ]; then
    echo "Nginx configuration test failed!"
    exit 1
fi

# Step 4: Reload nginx
echo "Step 4: Reloading nginx..."
sudo systemctl reload nginx

# Step 5: Set up auto-renewal
echo "Step 5: Setting up certificate auto-renewal..."
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

echo ""
echo "✅ SSL setup complete!"
echo ""
echo "Your site should now be accessible at:"
echo "  - https://qubpiz.com"
echo "  - https://www.qubpiz.com"
echo ""
echo "HTTP traffic will automatically redirect to HTTPS."
echo "Certificates will auto-renew via systemd timer."
