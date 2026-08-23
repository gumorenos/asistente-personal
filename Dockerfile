FROM node:22.18.0-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY data ./data

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8787
CMD ["node", "src/index.ts"]
