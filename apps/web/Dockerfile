FROM node:22-slim AS deps
RUN corepack enable pnpm
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile || pnpm install

FROM node:22-slim AS build
RUN corepack enable pnpm
WORKDIR /repo
COPY --from=deps /repo /repo
COPY . .
RUN pnpm --filter web build

FROM node:22-slim
RUN corepack enable pnpm
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
