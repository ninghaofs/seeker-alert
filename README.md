# seeker alert

seeker alert is a mobile-first Solana alert app built for Seeker users.
It helps users monitor token prices, wallet activity, and NFT-related signals from a phone instead of manually refreshing charts, wallets, and dashboards.

The app is designed around a simple flow:

1. Connect a wallet
2. Enter a Solana token CA or choose an alert type
3. Create an alert condition
4. Receive a mobile notification when the condition is triggered

## Project Overview

seeker alert focuses on turning a Seeker device into a real-time Solana monitoring tool.

Core capabilities in this repo:

- Native mobile wallet connect and sign-in
- Token CA input with automatic token metadata resolution
- Price alerts against USDC
- Wallet activity alerts
- Notification sound and system notification support
- English / Chinese UI toggle
- Local backend for development
- Firebase Functions backend for cloud deployment

## Why Seeker Users Would Use It

Seeker users need seeker alert because it turns their phone into a real-time Solana monitoring device, so they can catch price moves and wallet activity immediately instead of checking apps manually.

## Tech Stack

- Mobile: Expo, React Native, Android native project
- Wallet integration: Solana Mobile Wallet Adapter
- Backend: Node.js, TypeScript, Express, Firebase Functions
- Chain integrations: Solana RPC, Jupiter price and token metadata APIs

## Repo Layout

- `mobile/`: Expo / React Native Android app
- `src/`: backend API, alert engines, stores, Solana integrations
- `firebase.json`: Firebase Functions config

## Local Backend

```bash
npm install
cp .env.example .env
npm run dev
```

Default local server:

```text
http://localhost:3000
```

## Mobile App

```bash
cd mobile
npm install
npx expo run:android
```

The public mobile app uses a placeholder backend URL in `mobile/App.tsx`.
Set your own API base URL before running against your backend.

## Firebase Deployment

Set these environment variables before deploying:

- `FIREBASE_FUNCTIONS_REGION`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `SOLANA_RPC_URL`
- `AUTH_REQUIRED`

Then deploy:

```bash
npm run deploy:firebase
```



## Release Signing

This public repo does not include any release keystore.
To build a signed release APK, create your own keystore and fill in `mobile/android/keystore.properties` based on `mobile/android/keystore.properties.example`.
