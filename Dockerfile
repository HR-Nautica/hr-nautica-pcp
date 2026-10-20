FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY scripts/copy-vendor.js scripts/write-release-metadata.js ./scripts/

ARG APP_COMMIT_SHA=development
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY scripts/db ./scripts/db
COPY scripts/auth ./scripts/auth
COPY database/migrations ./database/migrations
COPY --from=build /app/dist ./dist

ARG APP_COMMIT_SHA=development
ENV NODE_ENV=production \
    APP_COMMIT_SHA=${APP_COMMIT_SHA} \
    PORT=3001 \
    HOST=0.0.0.0

LABEL org.opencontainers.image.revision=${APP_COMMIT_SHA}

EXPOSE 3001

USER node

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server/index.js"]
