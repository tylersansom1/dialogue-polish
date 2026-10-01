FROM node:20-slim

# Install FFmpeg (audio processing) and Python 3 + pip (analysis engine)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python DSP libraries
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
