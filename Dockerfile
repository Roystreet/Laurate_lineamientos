FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./web
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/* && corepack enable && corepack prepare pnpm@11.15.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
COPY scripts ./scripts
COPY --from=build /app/web/dist ./web/dist
RUN mkdir /app/storage && chown node:node /app/storage
USER node
EXPOSE 8008
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 CMD node --input-type=module -e "const response=await fetch('http://127.0.0.1:8008/api/health');process.exit(response.ok?0:1)"
CMD ["node","scripts/start.js"]
