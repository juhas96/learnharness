FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && node scripts/build-server.mjs

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 LH_DATA_DIR=/var/lib/learnharness/data LH_AUTH_FILE=/var/lib/learnharness/auth/auth.json CHROME_PATH=/usr/bin/chromium
COPY --from=build --chown=node:node /app/.next/standalone ./
RUN mkdir -p /var/lib/learnharness/data /var/lib/learnharness/auth && chown -R node:node /var/lib/learnharness
USER node
VOLUME ["/var/lib/learnharness"]
EXPOSE 3000
CMD ["node", "server.js"]
