FROM golang:1.26.5-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  gcc \
  git \
  make \
  sudo \
  && rm -rf /var/lib/apt/lists/*
