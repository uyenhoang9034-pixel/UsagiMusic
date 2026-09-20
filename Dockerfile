FROM node:22-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ARG LAVALINK_VERSION=4.2.0
RUN curl -fL --retry 5 --retry-delay 2 "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar" -o /app/lavalink/Lavalink.jar
RUN chmod +x /app/lavalink/start.sh
CMD ["/app/lavalink/start.sh"]
