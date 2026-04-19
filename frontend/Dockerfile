# Build stage
FROM node:24-slim AS builder

WORKDIR /app

# Copy frontend package files and install deps
COPY frontend/package.json ./
RUN npm install

# Copy frontend source
COPY frontend/ .

# Build frontend
ARG VITE_DEV
RUN npm run build

# Serve stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
