FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js levels.js oauth.js worlds.js mcp-app.js franks.js index.html landing.html admin.html level.html build.html chart.min.js core.js audio.js save.js net.js account.js game.js sw.js manifest.json icon-180.png icon-512.png glyphh-logo.png glyphh-spike.png glyphh-logo-black.png favicon.ico favicon-16.png favicon-32.png apple-touch-icon.png icon-192.png icon-maskable-512.png ./
COPY samples ./samples
COPY music ./music
COPY landing ./landing
COPY marketing/instagram-ad/free-fall-frank-ad.mp4 marketing/instagram-ad/cover.jpg marketing/instagram-ad/free-fall-frank-insane.mp4 marketing/instagram-ad/cover-insane.jpg marketing/instagram-ad/free-fall-frank-claude.mp4 marketing/instagram-ad/cover-claude.jpg marketing/instagram-ad/free-fall-frank-full.mp4 marketing/instagram-ad/cover-full.jpg ./marketing/instagram-ad/
ENV PORT=8080 DATA_DIR=/data NODE_NO_WARNINGS=1
CMD ["node", "server.js"]
