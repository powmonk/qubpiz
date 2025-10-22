# QubPiz - Quiz Application

A real-time quiz application with peer marking functionality built with Angular and Node.js.

## 🚀 Deployment Files

This project includes everything you need for easy deployment to DigitalOcean:

- **[QUICK_START.md](QUICK_START.md)** - Fast deployment guide (start here!)
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Comprehensive deployment documentation
- **[deploy.sh](deploy.sh)** - Automated deployment script

## 📦 Quick Deploy

```bash
# First time: Follow QUICK_START.md to set up your droplet

# Then, to deploy or update:
./deploy.sh YOUR_DROPLET_IP
```

## 🛠️ Local Development

```bash
# Install dependencies
cd qubPiz
npm install
cd server
npm install

# Set up environment
cp server/.env.example server/.env
# Edit server/.env with your local database credentials

# Start development servers
npm run dev  # Starts both frontend and backend
```

## 📋 Project Structure

```
qubPiz/
├── src/                  # Angular frontend source
├── server/               # Express backend
│   ├── index.js         # Main server file
│   ├── .env.example     # Environment variables template
│   └── uploads/         # Quiz image uploads (created on first run)
├── dist/                # Built frontend (after npm run build)
├── package.json         # Frontend dependencies
└── server/package.json  # Backend dependencies
```

## 🔧 Technologies

- **Frontend:** Angular 20, RxJS, TypeScript
- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL
- **Deployment:** Nginx, PM2

## 📝 Environment Variables

Required in `server/.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qubpiz
DB_USER=qubpiz_user
DB_PASSWORD=your_password
PORT=3000
NODE_ENV=production
```

## 🎯 Features

- Real-time quiz gameplay
- Picture and question rounds
- Peer marking system
- Image upload for questions
- MC (Master of Ceremonies) control panel
- Automatic player routing
- Responsive design

## 📚 Documentation

- [Quick Start Guide](QUICK_START.md) - Get deployed in minutes
- [Full Deployment Guide](DEPLOYMENT.md) - Complete setup instructions
- [Deployment Script](deploy.sh) - Automated deployment tool

## 🔐 Security Notes

- Never commit `.env` files
- Use strong PostgreSQL passwords
- Set up SSL/HTTPS in production (see DEPLOYMENT.md)
- Keep dependencies updated

## 🆘 Support

Check the troubleshooting sections in:
- [QUICK_START.md](QUICK_START.md) - Common issues
- [DEPLOYMENT.md](DEPLOYMENT.md) - Detailed troubleshooting

## 📄 License

[Your License Here]
