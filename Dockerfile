FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
USER node
CMD ["node", "src/main.js", "run"]
