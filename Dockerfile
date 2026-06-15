FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# --legacy-peer-deps: the Agents SDK requires zod 4 (a required peer), while the
# openai SDK lists zod 3 only as an OPTIONAL peer. npm ci is strict about that
# optional conflict; the flag lets it install the correct zod 4.
RUN npm ci --omit=dev --legacy-peer-deps

COPY src ./src

EXPOSE 8787

CMD ["node", "src/server.js"]
