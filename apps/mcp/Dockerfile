FROM node:22-slim
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
EXPOSE 8765
WORKDIR /repo/apps/mcp
CMD ["pnpm", "start"]
