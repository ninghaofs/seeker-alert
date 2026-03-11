# Privacy

## Overview

seeker alert is designed as a wallet-connected Solana alert application.
This repository is a public, sanitized codebase and does not include private runtime data, private signing keys, or private deployment credentials.

## Data the App May Process

Depending on how you deploy and operate seeker alert, the app and backend may process:

- public wallet addresses
- alert rules created by users
- alert history and notification events
- token contract addresses and token metadata lookups
- backend logs related to alert delivery and system health

## Sensitive Data

The app should not require users to enter private keys or seed phrases directly into the app UI.
If you deploy your own backend, you must not store private wallet material unless you have a clear security model and explicit user consent.

## Deployment Responsibility

If you run your own version of seeker alert, you are responsible for:

- securing backend infrastructure
- securing Firebase or cloud credentials
- securing Android signing keys
- defining and publishing your own privacy policy if you distribute the app publicly
- complying with applicable privacy, data protection, and consumer laws in your target regions

## Public Repository Scope

This public repository is intentionally sanitized.
It excludes:

- local environment files
- private Firebase bindings
- release keystores
- build outputs
- runtime data files
- local caches

## Third-Party Services

A deployment of seeker alert may depend on third-party services such as:

- Solana RPC providers
- Firebase
- Jupiter APIs
- wallet SDKs and mobile wallet adapters

Use of those services is subject to their own privacy terms and policies.
