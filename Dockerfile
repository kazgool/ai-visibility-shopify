FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Dev deps are needed for the build (vite, prisma, tsx); pruned after.
RUN npm ci && npm cache clean --force

COPY . .

RUN npx prisma generate && npm run build

# web:    npm run docker-start  (migrate + serve)
# worker: npm run worker        (graphile-worker via tsx)
CMD ["npm", "run", "docker-start"]
