# SimFar — image untuk self-host (CasaOS, dll). Menyajikan front-end + REST API + SQLite.
FROM node:20-bookworm-slim

# Build deps untuk better-sqlite3 (dipakai bila prebuilt binary tak tersedia utk arsitektur).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev

# Kode aplikasi: backend + front-end statis.
WORKDIR /app
COPY index.html peminjaman-ruangan.html ./
COPY server ./server

WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Data persisten (database SQLite + lampiran).
VOLUME ["/app/server/data", "/app/server/uploads"]

CMD ["node", "server.js"]
