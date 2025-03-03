FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Tạo thư mục cho node_modules và cấu hình npm
RUN mkdir -p /opt/node_modules
# Cấu hình npm để sử dụng node_modules ở vị trí khác
RUN npm config set cache /opt/npm-cache

WORKDIR /workspace

ENV NODE_ENV=development
ENV PATH=$PATH:/workspace/node_modules/.bin

CMD ["bash"] 