FROM node:22.12-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @lunch/shared && npm run build -w @lunch/api
RUN npm prune --omit=dev

FROM node:22.12-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S lunch && adduser -S -G lunch lunch
COPY --from=build --chown=lunch:lunch /app/node_modules ./node_modules
COPY --from=build --chown=lunch:lunch /app/packages/shared ./packages/shared
COPY --from=build --chown=lunch:lunch /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=lunch:lunch /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=lunch:lunch /app/apps/api/package.json ./apps/api/package.json
COPY --chown=lunch:lunch package.json ./package.json
USER lunch
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
