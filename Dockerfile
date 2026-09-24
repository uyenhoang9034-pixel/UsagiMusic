FROM node:22-alpine

WORKDIR /app

# Copy package descriptors first to leverage Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Set production environment and launch single-process controller with memory optimization flags
ENV NODE_ENV=production
CMD ["node", "--optimize-for-size", "--max-old-space-size=96", "--expose-gc", "src/app.js"]
