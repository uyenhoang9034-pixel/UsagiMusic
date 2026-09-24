FROM node:22-alpine

WORKDIR /app

# Copy package descriptors first to leverage Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Set production environment and launch single-process controller with capped V8 heap
ENV NODE_ENV=production
CMD ["node", "--max-old-space-size=128", "src/app.js"]
