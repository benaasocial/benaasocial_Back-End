# Benaa Social Backend

Backend service for managing social media integrations and publishing content across multiple platforms from one place.

---

## Overview

Benaa Social Backend allows users to connect their social media accounts and publish a single post across multiple platforms at the same time.

The system currently supports integrations with:

- Facebook
- Instagram
- TikTok
- YouTube

The main goal of the project is to simplify social publishing by allowing users to create one post and distribute it to all connected platforms through a unified backend API.

In addition, the system supports role-based access control where the owner/admin can create and manage users inside the platform.

---

## Features

- User authentication and authorization
- Role-based access control
- Owner/Admin can create users
- Facebook OAuth integration
- Instagram Business account integration
- TikTok integration
- YouTube integration
- Connect and manage social accounts
- Publish one post across multiple platforms
- Secure token handling
- RESTful API architecture
- TypeScript-based backend
- Environment-based configuration

---

## Tech Stack

- Node.js
- Express.js
- TypeScript
- MongoDB / Mongoose
- OAuth 2.0
- Meta Graph API
- TikTok API
- YouTube API

---

# Getting Started

## 1. Clone the repository

```bash
git clone https://github.com/benaasocial/benaasocial_Back-End.git
cd benaasocial_Back-End
```

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Create `.env` file

Create a `.env` file in the root directory and add the following variables:

```env
PORT=5000
NODE_ENV=development

MONGO_URI=your_mongodb_connection_string

JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

FRONTEND_URL=http://localhost:3000

# Meta
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_REDIRECT_URI=http://localhost:5000/api/meta/callback

# TikTok
TIKTOK_CLIENT_KEY=your_tiktok_client_key
TIKTOK_CLIENT_SECRET=your_tiktok_client_secret
TIKTOK_REDIRECT_URI=http://localhost:5000/api/tiktok/callback

# YouTube
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/youtube/callback
```

---

# Running Locally

## Development Mode

```bash
npm run dev
```

Runs TypeScript compiler in watch mode and automatically restarts the server using Nodemon.

---

## Build Project

```bash
npm run build
```

---

## Start Production Build

```bash
npm start
```

---

# Available Scripts

```json
{
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "concurrently \"tsc -w\" \"nodemon dist/index.js\""
}
```

---

# Social Publishing Flow

1. User connects social media accounts.
2. Backend handles OAuth authentication.
3. Access tokens are securely stored.
4. User creates a post from the dashboard.
5. Backend publishes the same content across selected platforms.

---

# Supported Platforms

- Facebook Pages
- Instagram Business Accounts
- TikTok
- YouTube

---

# Meta Integration Notes

The system uses Meta Graph API for Facebook and Instagram integrations.


# Important Notes

- OAuth redirect URLs must exactly match provider dashboard settings.
- Never commit `.env` files.
- Access tokens should be securely stored.
- Some platform APIs require app review before production usage.

---

# License

Private project for internal usage.
