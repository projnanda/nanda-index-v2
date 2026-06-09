FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY db/migrations ./db/migrations
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["./entrypoint.sh"]
