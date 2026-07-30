# Mnemosyne Rerank 服务镜像
# 基于 python:3.11-slim，运行 Cross-Encoder 重排服务
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY requirements.txt ./

# 安装依赖（不缓存 pip 下载以减小镜像体积）
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app.py ./

# 暴露服务端口
EXPOSE 8001

# HuggingFace 模型缓存卷，加速重建（挂载点）
VOLUME ["/root/.cache/huggingface"]

# 启动 uvicorn 服务
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
