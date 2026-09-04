# Build and run the public Next.js shell plus the local Nexus IQ backend.
# Multi-stage: the builder's toolchain never reaches the runtime image.
FROM node:20.20.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build

FROM node:20.20.1-alpine
WORKDIR /app
RUN chown node:node /app
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/vendor ./vendor
COPY --from=builder --chown=node:node /app/next.config.js ./next.config.js
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/pages ./pages
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/demo ./demo
RUN mkdir -p projects vaults config && chown node:node projects vaults config
USER node
# runtime needs production deps only (next/react/parsers); devDependencies are
# build-time
RUN npm ci --omit=dev
# Only 3000 is reachable: the backend binds 127.0.0.1 INSIDE the container, so
# publishing 7341 could never work — the Next shell on 3000 proxies /api to it.
EXPOSE 3000
CMD ["npm","run","start:docker"]
