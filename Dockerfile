# syntax=docker/dockerfile:1
# Dev orchestration: use pivot-platform/compose.yml (includes backend + postgres + redis).
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build -- --configuration production

FROM nginx:alpine
RUN apk upgrade --no-cache
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
