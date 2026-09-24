# syntax=docker/dockerfile:1.7
# Standalone sample app. Build with:
#   docker compose build
# which passes additional_contexts.vapi-studio → sibling ../guidify-ai (or set VAPI_STUDIO_CONTEXT).
FROM node:24-bookworm-slim AS build

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

WORKDIR /pkg/vapi-studio
COPY --from=vapi-studio package.json tsconfig.json ./
COPY --from=vapi-studio src ./src
COPY --from=vapi-studio studio-ui ./studio-ui
COPY --from=vapi-studio test ./test
COPY --from=vapi-studio scripts ./scripts
COPY --from=vapi-studio docs ./docs
COPY --from=vapi-studio agent ./agent
RUN yarn install && yarn build
RUN mkdir -p /pkg/vapi-studio-pub \
  && cp package.json /pkg/vapi-studio-pub/ \
  && cp -R dist /pkg/vapi-studio-pub/dist \
  && cp -R scripts /pkg/vapi-studio-pub/scripts \
  && cp -R docs /pkg/vapi-studio-pub/docs \
  && cp -R agent /pkg/vapi-studio-pub/agent
RUN rm -rf node_modules

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY config ./config
COPY test ./test
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.dependencies['@guidify-ai/vapi-studio']='file:/pkg/vapi-studio-pub'; fs.writeFileSync('package.json', JSON.stringify(p,null,2));" \
  && yarn install && yarn build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /pkg/vapi-studio-pub /pkg/vapi-studio
COPY --from=build /app /app
RUN mkdir -p /pkg && ln -sfn /pkg/vapi-studio /pkg/vapi-studio-link
ENV NODE_ENV=production
ENV CONFIG_DIR=/app/config
ENV PORT=9998
RUN mkdir -p logs
EXPOSE 9998
CMD ["node", "dist/main.js"]
