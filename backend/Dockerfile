FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# --- deps: dependências completas para compilar ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- build: compila TypeScript -> dist ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- production: só runtime + dependências de produção ---
FROM base AS production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

# --- development: hot reload, usado pelo compose de dev ---
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]
