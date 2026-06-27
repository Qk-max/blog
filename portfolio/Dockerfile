FROM node:24-alpine
WORKDIR /app
COPY server.mjs /app/server.mjs
ENV SITE_ROOT=/app/site \
    CONTENT_ROOT=/app/content \
    NODE_ENV=production
CMD ["node", "server.mjs"]
