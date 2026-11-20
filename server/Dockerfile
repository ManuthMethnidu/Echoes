FROM node:20-alpine

WORKDIR /app

# Install python3, py3-pip, ffmpeg, and latest yt-dlp for YouTube audio streaming
RUN apk update && apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg && \
    pip3 install --no-cache-dir -U yt-dlp --break-system-packages

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

USER node

CMD ["node", "src/index.js"]
