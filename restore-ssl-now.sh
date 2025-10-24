#!/bin/bash

# Quick SSL Restore Script

echo "Restoring SSL configuration..."

# Update nginx config with SSL
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

# Test and reload
echo "Testing nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "Reloading nginx..."
    sudo systemctl reload nginx
    echo "✅ SSL restored successfully!"
    echo ""
    echo "Checking ports..."
    ss -tlnp | grep -E ':(80|443)'
else
    echo "❌ Nginx configuration error!"
    exit 1
fi
