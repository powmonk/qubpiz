#!/bin/bash

# QubPiz Deployment Script
# This script helps you deploy updates to your DigitalOcean droplet

set -e  # Exit on error

echo "=== QubPiz Deployment Script ==="
echo ""

# Check if droplet IP is provided
if [ -z "$1" ]; then
    echo "Usage: ./deploy.sh <droplet_ip_or_domain>"
    echo "Example: ./deploy.sh 157.245.123.45"
    exit 1
fi

DROPLET=$1
DEPLOY_USER="root"  # Change if you use a different user

echo "Deploying to: $DROPLET"
echo ""

# Build the Angular app
echo "📦 Building Angular application..."
cd qubPiz
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"
echo ""

# Create deployment package
echo "📦 Creating deployment package..."
cd ..
tar -czf qubpiz-deploy.tar.gz \
  --exclude='qubPiz/node_modules' \
  --exclude='qubPiz/server/node_modules' \
  --exclude='qubPiz/.angular' \
  --exclude='qubPiz/server/uploads' \
  qubPiz/

echo "✅ Package created!"
echo ""

# Upload to droplet
echo "📤 Uploading to droplet..."
scp qubpiz-deploy.tar.gz ${DEPLOY_USER}@${DROPLET}:~/

if [ $? -ne 0 ]; then
    echo "❌ Upload failed!"
    rm qubpiz-deploy.tar.gz
    exit 1
fi

echo "✅ Upload successful!"
echo ""

# Deploy on droplet
echo "🚀 Deploying on droplet..."
ssh ${DEPLOY_USER}@${DROPLET} << 'ENDSSH'
    set -e

    echo "Extracting files..."
    cd /var/www/qubpiz
    tar -xzf ~/qubpiz-deploy.tar.gz --strip-components=1
    rm ~/qubpiz-deploy.tar.gz

    echo "Installing server dependencies..."
    cd server
    npm install --production

    echo "Restarting application..."
    pm2 restart qubpiz

    echo "✅ Deployment complete!"

    echo ""
    echo "Application status:"
    pm2 status qubpiz
ENDSSH

# Clean up local package
rm qubpiz-deploy.tar.gz

echo ""
echo "🎉 Deployment successful!"
echo ""
echo "Your app should now be running at:"
echo "http://${DROPLET}"
echo ""
echo "To view logs, SSH into your droplet and run:"
echo "pm2 logs qubpiz"
