FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY server ./server
COPY scripts/db ./scripts/db
COPY scripts/auth ./scripts/auth
COPY database/migrations ./database/migrations
COPY api ./api
COPY public ./public
COPY index.html ./

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["node", "server/index.js"]
