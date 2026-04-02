#!/usr/bin/env bash
set -e

echo "==> Installing client dependencies..."
cd client
npm ci --production=false
echo "==> Building client..."
npm run build
cd ..

echo "==> Installing server dependencies..."
cd server
npm ci --omit=dev
cd ..

echo "==> Build complete!"
