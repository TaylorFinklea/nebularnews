FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--local", "--host", "0.0.0.0", "--port", "8787"]
