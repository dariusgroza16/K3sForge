FROM ubuntu:24.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ansible \
    openssh-client \
    git \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install just command runner
RUN curl -Lo just.tar.gz https://github.com/casey/just/releases/download/1.35.0/just-1.35.0-x86_64-unknown-linux-musl.tar.gz && \
    tar -xzf just.tar.gz && \
    mv just /usr/local/bin/ && \
    rm just.tar.gz

# Copy application files
COPY ansible /app/ansible
COPY core-services /app/core-services
COPY frontend /app/frontend
COPY justfile /app/justfile

# Install Python dependencies
RUN pip3 install --no-cache-dir -r /app/frontend/requirements.txt --break-system-packages

# Expose Flask default port
EXPOSE 5000

# Set working directory to frontend
WORKDIR /app/frontend/src

# Run the Flask application
CMD ["python3", "main.py"]