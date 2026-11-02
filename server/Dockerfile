FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# App files stay root-owned (read-only to the process); the server and its
# migrations (entrypoint.sh) only read them.
COPY --from=builder /app/dist ./dist
COPY db/migrations ./db/migrations
COPY entrypoint.sh ./
RUN chmod 755 entrypoint.sh
USER node
EXPOSE 3001
ENTRYPOINT ["./entrypoint.sh"]
