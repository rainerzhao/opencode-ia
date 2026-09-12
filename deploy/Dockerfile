FROM node:24-bookworm-slim

WORKDIR /opt/opencode-ia
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
RUN install -d -o node -g node \
    /var/lib/opencode-workbench \
    /var/lib/opencode-workbench/runtime \
    /var/lib/opencode-workbench/workspaces \
    /var/lib/opencode-workbench/skill-installations \
    /var/lib/opencode-workbench/tmp/uploads

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/opt/opencode-ia/dist/web \
    OPENCODE_CWD=/var/lib/opencode-workbench/runtime \
    GATEWAY_WORKSPACE_ROOT=/var/lib/opencode-workbench/workspaces \
    SKILL_INSTALL_ROOT=/var/lib/opencode-workbench/skill-installations \
    UPLOAD_TEMP_DIR=/var/lib/opencode-workbench/tmp/uploads

USER node
EXPOSE 3000
CMD ["node", "scripts/start-production.js"]
