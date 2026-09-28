FROM node:22-alpine
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY web ./web
COPY extension/lib ./extension/lib
COPY extension/content/scrape-page.cjs ./extension/content/scrape-page.cjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "require('http').get('http://127.0.0.1:8787/healthz',{headers:{host:new URL(process.env.PUBLIC_ORIGIN).host}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "web/server.js"]
