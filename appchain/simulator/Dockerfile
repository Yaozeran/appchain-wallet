FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY engine.mjs server.mjs ./
USER node
EXPOSE 8090
CMD ["node", "server.mjs"]
