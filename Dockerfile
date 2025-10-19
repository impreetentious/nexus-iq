# Build and run the public Next.js shell plus the local Nexus IQ backend.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN chown node:node /app
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/next.config.js ./next.config.js
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/pages ./pages
COPY --from=builder --chown=node:node /app/server ./server
USER node
RUN npm ci
EXPOSE 3000
EXPOSE 7341
CMD ["npm","run","start:docker"]
