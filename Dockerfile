# Use Node.js 20 LTS as base
FROM node:20-slim

# Install system dependencies (needed for better-sqlite3 build and git)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application source
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose the application port
EXPOSE 3099

# Start the application
CMD ["npm", "start"]
