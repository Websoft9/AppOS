FROM nixos/nix

RUN echo "experimental-features = nix-command flakes" >> /etc/nix/nix.conf && \
  echo "filter-syscalls = false" >> /etc/nix/nix.conf

COPY .devcontainer/nix-shell.nix /tmp/nix-shell.nix

RUN nix-env -f /tmp/nix-shell.nix -i

RUN mkdir -p /home/dev/.cache && \
  chown -R 1000:1000 /home/dev

ENV HOME=/home/dev \
  GOMODCACHE=/home/dev/.cache/go-mod \
  GOCACHE=/home/dev/.cache/go-build \
  GOPROXY=https://proxy.golang.org,direct

WORKDIR /workspace

CMD ["sleep", "infinity"]
