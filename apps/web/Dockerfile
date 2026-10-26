FROM node:22.12-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @lunch/shared && npm run build -w @lunch/web

FROM node:22.12-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S lunch && adduser -S -G lunch lunch
COPY --from=build --chown=lunch:lunch /app/apps/web/.next/standalone ./
COPY --from=build --chown=lunch:lunch /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=lunch:lunch /app/apps/web/public ./apps/web/public
USER lunch
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
