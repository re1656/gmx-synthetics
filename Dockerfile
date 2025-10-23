# 基于 Node 20 官方镜像（已经内置 Corepack）
FROM node:20-bookworm

# 安装常用构建工具（可选）
RUN apt-get update && apt-get install -y git python3 make g++ curl \
  && rm -rf /var/lib/apt/lists/*

# 启用 yarn（Corepack 默认支持）
RUN corepack enable && corepack prepare yarn@4.3.0 --activate

# 设置工作目录
WORKDIR /work

# 保持容器空环境，yarn install 在容器中或宿主机执行
CMD ["bash"]
