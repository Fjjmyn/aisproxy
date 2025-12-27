# Dockerfile (基于 Ellinav/ais2apiapi 原始配置)
FROM node:18-slim
WORKDIR /app

# 1. 安装最稳定、最不常变化的系统依赖。
RUN apt-get update && apt-get install -y \
    curl \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-6 \
    libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxrandr2 libxss1 libxtst6 xvfb \
    && rm -rf /var/lib/apt/lists/*

# 2. 拷贝 package.json 并安装依赖。
COPY package*.json ./
RUN npm install --production

# 3. 【核心】下载并安装 Camoufox 浏览器（原项目配置）
ARG CAMOUFOX_URL
RUN curl -sSL ${CAMOUFOX_URL} -o camoufox-linux.tar.gz && \
    tar -xzf camoufox-linux.tar.gz && \
    rm camoufox-linux.tar.gz && \
    chmod +x /app/camoufox-linux/camoufox

# 设置 Camoufox 可执行文件路径环境变量
ENV CAMOUFOX_EXECUTABLE_PATH=/app/camoufox-linux/camoufox

# 4. 拷贝代码文件（移除 black-browser.js，添加 lib/ 目录）
COPY unified-server.js ./
COPY lib/ ./lib/
COPY save-auth.js ./

# 5. 创建目录并设置权限。
RUN mkdir -p ./auth && chown -R node:node /app

# 切换到非 root 用户
USER node

# 暴露服务端口
EXPOSE 7860

# 定义容器启动命令
CMD ["node", "unified-server.js"]
