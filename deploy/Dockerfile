FROM node:24-bookworm-slim

WORKDIR /opt/opencode-ia
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
RUN install -d -o node -g node -m 0700 \
    /var/lib/opencode-workbench \
    /var/lib/opencode-workbench/runtime \
    /var/lib/opencode-workbench/content-attachments \
    /var/lib/opencode-workbench/knowledge \
    /var/lib/opencode-workbench/skills \
    /var/lib/opencode-workbench/xdg/data \
    /var/lib/opencode-workbench/xdg/state \
    /var/lib/opencode-workbench/xdg/config \
    /var/lib/opencode-workbench/xdg/cache \
    /var/lib/opencode-workbench/workspaces \
    /var/lib/opencode-workbench/skill-installations \
    /var/lib/opencode-workbench/tmp/uploads

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/opt/opencode-ia/dist/web \
    WORKBENCH_DATA_DIR=/var/lib/opencode-workbench \
    XDG_DATA_HOME=/var/lib/opencode-workbench/xdg/data \
    XDG_STATE_HOME=/var/lib/opencode-workbench/xdg/state \
    XDG_CONFIG_HOME=/var/lib/opencode-workbench/xdg/config \
    XDG_CACHE_HOME=/var/lib/opencode-workbench/xdg/cache

USER node
EXPOSE 3000
CMD ["node", "scripts/start-production.js"]
