# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3 AS base
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM base AS server-build
ENV NODE_ENV=production
RUN bun run --cwd apps/server build

FROM oven/bun:1.3.3-slim AS server
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=server-build /app/package.json /app/bun.lock /app/turbo.json ./
COPY --from=server-build /app/apps/server ./apps/server
COPY --from=server-build /app/packages ./packages
COPY --from=server-build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/server", "start"]

FROM base AS web-build
ENV NODE_ENV=production \
    API_INTERNAL_URL=http://server:3000
RUN bun run --cwd apps/web build

FROM oven/bun:1.3.3-slim AS web
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    API_INTERNAL_URL=http://server:3000
COPY --from=web-build /app/package.json /app/bun.lock /app/turbo.json ./
COPY --from=web-build /app/apps/web ./apps/web
COPY --from=web-build /app/packages ./packages
COPY --from=web-build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["bun", "run", "--cwd", "apps/web", "start"]
