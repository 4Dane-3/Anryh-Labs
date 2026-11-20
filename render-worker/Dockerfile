# The Migz render worker: Node 22, ffmpeg and the libraries headless Chrome needs (HyperFrames downloads its own
# Chrome on first use; the warm-up render below does it at build time).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates fonts-liberation fonts-noto-color-emoji \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 \
    python3 python3-pip curl \
  && rm -rf /var/lib/apt/lists/*

# The person cut-out for cards behind the head (matte.py): MediaPipe and its selfie segmenter model
RUN pip3 install --no-cache-dir --break-system-packages mediapipe opencv-python-headless numpy \
  && mkdir -p /app/models \
  && curl -sfL -o /app/models/selfie_segmenter.tflite https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npx --yes hyperframes browser ensure || true
COPY . .

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
