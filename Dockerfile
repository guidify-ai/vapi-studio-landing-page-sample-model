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
# Local framework build only when package.json pins file:… (make STUDIO_SOURCE=local);
# otherwise the app installs @guidify-ai/vapi-studio from the npm registry.
COPY package.json /tmp/app-package.json
RUN mkdir -p /pkg/vapi-studio-pub \
  && if node -e "process.exit(/^file:/.test(require('/tmp/app-package.json').dependencies['@guidify-ai/vapi-studio']||'')?0:1)"; then \
       yarn install && yarn build \
       && cp package.json /pkg/vapi-studio-pub/ \
       && cp -R dist scripts docs agent /pkg/vapi-studio-pub/ \
       && rm -rf node_modules; \
     fi

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY config ./config
COPY test ./test
RUN if [ -f /pkg/vapi-studio-pub/package.json ]; then \
       node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.dependencies['@guidify-ai/vapi-studio']='file:/pkg/vapi-studio-pub'; fs.writeFileSync('package.json', JSON.stringify(p,null,2));"; \
     fi \
  && yarn install && yarn build \
  && node -e "const p=JSON.parse(require('fs').readFileSync('node_modules/@guidify-ai/vapi-studio/package.json','utf8')); console.log('vapi-studio', p.version, require.resolve('@guidify-ai/vapi-studio'))"

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
