FROM node:22-slim

WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Start the continuous Discord bot process
CMD ["node", "src/index.js"]
