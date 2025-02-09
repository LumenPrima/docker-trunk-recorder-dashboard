FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and curl for healthcheck
RUN apt-get update && apt-get install -y curl \
    && if [ "$NODE_ENV" = "production" ]; then \
        npm install --omit=dev; \
    else \
        npm install; \
    fi \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY src/ ./src/
COPY public/ ./public/

# Set permissions for app directory
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose port for the main dashboard
EXPOSE 3000

# Use nodemon in development, node in production
CMD if [ "$NODE_ENV" = "production" ]; then \
        node src/server.js; \
    else \
        npm run dev; \
    fi
