FROM node:22-slim AS build
WORKDIR /app
# Placeholder only so `prisma generate` can read prisma.config.ts at build time.
ENV DATABASE_URL=postgresql://build@localhost:5432/build
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json /app/prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/prisma ./prisma
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
