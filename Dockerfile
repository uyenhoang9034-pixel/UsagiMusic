FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless curl ca-certificates python3 python3-pip ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ARG LAVALINK_VERSION=4.2.0
RUN curl -fL --retry 5 --retry-delay 2 "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar" -o /app/lavalink/Lavalink.jar
RUN chmod +x /app/lavalink/start.sh

ENV NODE_ENV=production
CMD ["/app/lavalink/start.sh"]
