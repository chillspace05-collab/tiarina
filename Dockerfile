FROM node:22-slim

ENV TZ=Asia/Jakarta \
    NODE_ENV=production

# ffmpeg + font untuk render video/subtitle
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core fonts-liberation tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "start.js"]
