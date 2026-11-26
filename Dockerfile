# Ein Image für api, worker und migrate; die Oberfläche liegt mit im Image und wird von api ausgeliefert.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm test && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    MIGRATIONS_DIR=/app/server/migrations \
    WEB_DIR=/app/web
COPY --from=build /app/dist/server ./server
COPY --from=build /app/apps/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "server/api.mjs"]
