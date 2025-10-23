# Quick Deploy Reference

## Initial Setup

```bash
# 1. Copy script to server
scp server-setup.sh root@YOUR_SERVER_IP:~/

# 2. SSH and run
ssh root@YOUR_SERVER_IP
chmod +x server-setup.sh
./server-setup.sh
```

## Update App

```bash
# On server
cd /var/www/qubpiz && ./server-update.sh

# Or remotely
ssh root@YOUR_SERVER_IP 'cd /var/www/qubpiz && ./server-update.sh'
```

## Auto-Deploy with GitHub Webhook

```bash
# 1. Add secret to server
echo "WEBHOOK_SECRET=$(openssl rand -base64 32)" | sudo tee -a /var/www/qubpiz/qubPiz/server/.env
pm2 restart qubpiz

# 2. Get secret
grep WEBHOOK_SECRET /var/www/qubpiz/qubPiz/server/.env

# 3. Add webhook in GitHub:
# Settings → Webhooks → Add webhook
# URL: http://YOUR_SERVER_IP/api/deploy-webhook
# Content type: application/json
# Secret: (paste from step 2)
```

## Common Commands

```bash
pm2 logs qubpiz          # View logs
pm2 status               # Check status
pm2 restart qubpiz       # Restart app
curl http://localhost:3000/api/game/status  # Test API
```

## Troubleshooting

```bash
# App won't start
pm2 logs qubpiz --err
sudo systemctl status postgresql

# Update failed
cd /var/www/qubpiz
git status
chmod +x server-update.sh

# Out of memory
free -h
pm2 restart qubpiz
```
