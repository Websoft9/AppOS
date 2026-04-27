#!/bin/bash
# Websoft9 Docker installer
#
# Purpose:
# - Install Docker Engine and Docker Compose with a success-first strategy.
# - Prefer the official Docker installer when allowed.
# - Fall back to a distribution-aware package-manager flow when the official
#   installer is unsupported, times out, or fails verification.
#
# Execution stages:
# 1. Parse CLI arguments and resolve install policy.
# 2. Download the official installer script into a temporary directory.
# 3. Optionally run the official installer with the configured mirror policy.
# 4. Fall back to a custom apt/dnf/yum-based install flow when needed.
# 5. Enable/start Docker and verify both docker and docker compose.
#
# Supported parameters:
# - --distro <id>
#     Explicitly sets the target distribution ID instead of auto-detecting it
#     from /etc/os-release. Example: ubuntu, debian, rhel, centos, amzn.
# - --mirror-policy <policy>
#     Controls the preferred ordering of download sources, repo sources, and
#     official-installer mirror arguments.
#     Allowed values:
#       official-first : official upstream first, then China mirrors
#       china-first    : China mirrors first, then official upstream
#       official-only  : official upstream only
#       mirror-only    : China mirrors only
# - --skip-official
#     Skips the official get.docker.com installer entirely and goes straight to
#     the custom package-manager flow.
# - --help
#     Prints this help text and exits.
#
# Examples:
#   ./docker-install.sh
#   ./docker-install.sh --skip-official
#   ./docker-install.sh --distro ubuntu --mirror-policy china-first
#   ./docker-install.sh --distro amzn --mirror-policy mirror-only
#
# Distribution-specific note:
# - Amazon Linux uses a fixed Docker CE repository path under rhel/9 rather than
#   relying on Amazon Linux releasever expansion. This avoids generating invalid
#   repository URLs such as rhel/2023.x/...
PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin:~/bin
export PATH

set -u
set -o pipefail

SCRIPT_NAME="docker-install"
SCRIPT_VERSION="2026-04-27"
DOWNLOAD_RETRIES=5
DOWNLOAD_TIMEOUT=10
OFFICIAL_INSTALL_TIMEOUT=300
OVERRIDE_DISTRO=""
MIRROR_POLICY="official-first"
SKIP_OFFICIAL=0
AMZN_DOCKER_REPO_FILE="/etc/yum.repos.d/docker-ce.repo"
AMZN_DOCKER_REPO_SOURCE="https://download.docker.com/linux/rhel/docker-ce.repo"
DOCKER_PACKAGES=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
DEFAULT_DOCKER_SCRIPT_URLS=(
  "https://get.docker.com"
  "https://proxy.websoft9.com/?url=https://get.docker.com"
)
DEFAULT_DOCKER_REPO_BASES=(
  "https://download.docker.com/linux"
  "https://mirrors.aliyun.com/docker-ce/linux"
  "https://mirror.azure.cn/docker-ce/linux"
)
ACTIVE_DOCKER_SCRIPT_URLS=()
ACTIVE_DOCKER_REPO_BASES=()
OFFICIAL_INSTALL_MIRRORS=()

TMP_DIR="$(mktemp -d -t docker-install.XXXXXX)"
DOWNLOADED_SCRIPT="$TMP_DIR/get-docker.sh"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

print_usage() {
  cat <<'EOF'
Usage:
  docker-install.sh [--distro <id>] [--mirror-policy <policy>] [--skip-official] [--help]

Options:
  --distro <id>            Override distribution detection (for example: ubuntu, debian, amzn).
  --mirror-policy <policy> One of: official-first, china-first, official-only, mirror-only.
  --skip-official          Skip the official Docker installer and use only the custom flow.
  --help                   Show this help text and exit.
EOF
}

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  local level="$1"
  local stage="$2"
  shift 2
  printf '%s [%s] [%s] %s\n' "$(timestamp)" "$level" "$stage" "$*"
}

log_info() {
  log "INFO" "$1" "$2"
}

log_warn() {
  log "WARN" "$1" "$2"
}

log_error() {
  log "ERROR" "$1" "$2"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --distro)
        if [ "$#" -lt 2 ]; then
          log_error "args" "--distro requires a value"
          return 1
        fi
        OVERRIDE_DISTRO="$2"
        shift 2
        ;;
      --mirror-policy)
        if [ "$#" -lt 2 ]; then
          log_error "args" "--mirror-policy requires a value"
          return 1
        fi
        MIRROR_POLICY="$2"
        shift 2
        ;;
      --skip-official)
        SKIP_OFFICIAL=1
        shift
        ;;
      --help)
        print_usage
        exit 0
        ;;
      *)
        log_error "args" "Unknown argument: $1"
        print_usage
        return 1
        ;;
    esac
  done

  return 0
}

configure_mirror_policy() {
  case "$MIRROR_POLICY" in
    official-first)
      ACTIVE_DOCKER_SCRIPT_URLS=(
        "${DEFAULT_DOCKER_SCRIPT_URLS[0]}"
        "${DEFAULT_DOCKER_SCRIPT_URLS[1]}"
      )
      ACTIVE_DOCKER_REPO_BASES=(
        "${DEFAULT_DOCKER_REPO_BASES[0]}"
        "${DEFAULT_DOCKER_REPO_BASES[1]}"
        "${DEFAULT_DOCKER_REPO_BASES[2]}"
      )
      OFFICIAL_INSTALL_MIRRORS=("" "Aliyun" "AzureChinaCloud")
      ;;
    china-first)
      ACTIVE_DOCKER_SCRIPT_URLS=(
        "${DEFAULT_DOCKER_SCRIPT_URLS[1]}"
        "${DEFAULT_DOCKER_SCRIPT_URLS[0]}"
      )
      ACTIVE_DOCKER_REPO_BASES=(
        "${DEFAULT_DOCKER_REPO_BASES[1]}"
        "${DEFAULT_DOCKER_REPO_BASES[2]}"
        "${DEFAULT_DOCKER_REPO_BASES[0]}"
      )
      OFFICIAL_INSTALL_MIRRORS=("Aliyun" "AzureChinaCloud" "")
      ;;
    official-only)
      ACTIVE_DOCKER_SCRIPT_URLS=("${DEFAULT_DOCKER_SCRIPT_URLS[0]}")
      ACTIVE_DOCKER_REPO_BASES=("${DEFAULT_DOCKER_REPO_BASES[0]}")
      OFFICIAL_INSTALL_MIRRORS=("")
      ;;
    mirror-only)
      ACTIVE_DOCKER_SCRIPT_URLS=("${DEFAULT_DOCKER_SCRIPT_URLS[1]}")
      ACTIVE_DOCKER_REPO_BASES=(
        "${DEFAULT_DOCKER_REPO_BASES[1]}"
        "${DEFAULT_DOCKER_REPO_BASES[2]}"
      )
      OFFICIAL_INSTALL_MIRRORS=("Aliyun" "AzureChinaCloud")
      ;;
    *)
      log_error "args" "Unsupported mirror policy: $MIRROR_POLICY"
      print_usage
      return 1
      ;;
  esac

  log_info "args" "Resolved options: distro=${OVERRIDE_DISTRO:-auto-detect} mirror_policy=$MIRROR_POLICY skip_official=$SKIP_OFFICIAL"
  return 0
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return $?
  fi

  if ! command_exists sudo; then
    log_error "preflight" "sudo is required when running as a non-root user"
    return 1
  fi

  sudo "$@"
}

detect_distribution() {
  if [ -r /etc/os-release ]; then
    . /etc/os-release
    printf '%s\n' "${ID:-unknown}" | tr '[:upper:]' '[:lower:]'
    return 0
  fi

  return 1
}

verify_downloaded_script() {
  [ -s "$DOWNLOADED_SCRIPT" ]
}

download_file() {
  local tool="$1"
  local url="$2"

  if [ "$tool" = "curl" ]; then
    curl -fsSL --max-time "$DOWNLOAD_TIMEOUT" "$url" -o "$DOWNLOADED_SCRIPT"
  else
    wget --timeout="$DOWNLOAD_TIMEOUT" -O "$DOWNLOADED_SCRIPT" "$url"
  fi
}

download_docker_script() {
  local tool
  local url
  local attempt
  local tools=()

  command_exists curl && tools+=("curl")
  command_exists wget && tools+=("wget")

  if [ ${#tools[@]} -eq 0 ]; then
    log_error "download" "Neither curl nor wget is available"
    return 1
  fi

  log_info "download" "Starting official Docker installer download; destination=$DOWNLOADED_SCRIPT"

  for tool in "${tools[@]}"; do
    for url in "${ACTIVE_DOCKER_SCRIPT_URLS[@]}"; do
      attempt=1
      while [ "$attempt" -le "$DOWNLOAD_RETRIES" ]; do
        log_info "download" "Attempt $attempt/$DOWNLOAD_RETRIES via tool=$tool url=$url"
        rm -f "$DOWNLOADED_SCRIPT"
        if download_file "$tool" "$url" && verify_downloaded_script; then
          chmod +x "$DOWNLOADED_SCRIPT"
          log_info "download" "Downloaded official Docker installer successfully via tool=$tool url=$url"
          return 0
        fi
        log_warn "download" "Download attempt failed via tool=$tool url=$url"
        attempt=$((attempt + 1))
      done
    done
  done

  log_error "download" "Failed to download official Docker installer after exhausting all tools and URLs"
  return 1
}

rpm_package_manager() {
  if command_exists dnf5; then
    printf '%s\n' "dnf5"
  elif command_exists dnf; then
    printf '%s\n' "dnf"
  else
    printf '%s\n' "yum"
  fi
}

remove_podman_if_present() {
  if command_exists dnf || command_exists dnf5; then
    run_root dnf remove -y podman >/dev/null 2>&1 || true
    return 0
  fi

  if command_exists yum; then
    run_root yum remove -y podman >/dev/null 2>&1 || true
  fi
}

install_compose_for_amzn() {
  local compose_binary="/usr/local/lib/docker/cli-plugins/docker-compose"
  run_root mkdir -p /usr/local/lib/docker/cli-plugins
  run_root curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o "$compose_binary"
  run_root chmod +x "$compose_binary"
}

install_for_amzn() {
  log_info "custom-rpm" "Detected Amazon Linux; installing Docker CE from fixed rhel/9 repository mapping"
  run_root dnf -y install dnf-plugins-core || return 1
  run_root dnf config-manager addrepo --save-filename=docker-ce.repo --from-repofile="$AMZN_DOCKER_REPO_SOURCE" || return 1
  run_root sed -i 's|\$releasever|9|g' "$AMZN_DOCKER_REPO_FILE" || return 1
  run_root dnf makecache || return 1
  run_root dnf install -y "${DOCKER_PACKAGES[@]}" --enablerepo=docker-ce-stable || return 1
  return 0
}

install_from_rpm_repo() {
  local repo_url="$1"
  local package_manager

  package_manager="$(rpm_package_manager)"
  log_info "custom-rpm" "Preparing repo with package_manager=$package_manager repo=$repo_url"

  case "$package_manager" in
    dnf5)
      run_root dnf -y -q install dnf-plugins-core || return 1
      run_root dnf5 config-manager addrepo --save-filename=docker-ce.repo --from-repofile="$repo_url" || return 1
      run_root dnf makecache || return 1
      run_root dnf5 install -y "${DOCKER_PACKAGES[@]}" || return 1
      ;;
    dnf)
      run_root dnf -y -q install dnf-plugins-core || return 1
      run_root dnf config-manager --add-repo "$repo_url" || return 1
      run_root dnf makecache || return 1
      run_root dnf install -y "${DOCKER_PACKAGES[@]}" || return 1
      ;;
    yum)
      run_root yum -y -q install yum-utils || return 1
      run_root yum-config-manager --add-repo "$repo_url" || return 1
      run_root yum makecache || return 1
      run_root yum install -y "${DOCKER_PACKAGES[@]}" || return 1
      ;;
  esac

  return 0
}

install_for_rpm_family() {
  local distro="$1"
  local repo_base
  local repo_url
  local fallback

  if [ "$distro" = "amzn" ]; then
    install_for_amzn || return 1
    return 0
  fi

  if [ "$distro" = "openeuler" ]; then
    log_info "custom-rpm" "Detected openEuler; applying special repo preparation"
    run_root dnf update -y || return 1
    run_root dnf -y install dnf-plugins-core || return 1
    run_root dnf config-manager --add-repo="https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo" || return 1
    run_root sed -i 's+$releasever+8+' /etc/yum.repos.d/docker-ce.repo || return 1
    run_root dnf makecache || return 1
    run_root dnf install -y "${DOCKER_PACKAGES[@]}" || return 1
    return 0
  fi

  if [ "$distro" = "ol" ] && grep -q 'VERSION_ID="7' /etc/os-release; then
    log_info "custom-rpm" "Detected Oracle Linux 7; enabling required preview repository"
    run_root yum install -y oraclelinux-developer-release-el7 || return 1
    run_root yum-config-manager --enable ol7_preview || return 1
  fi

  remove_podman_if_present

  for repo_base in "${ACTIVE_DOCKER_REPO_BASES[@]}"; do
    repo_url="$repo_base/$distro/docker-ce.repo"
    if install_from_rpm_repo "$repo_url"; then
      log_info "custom-rpm" "Docker packages installed successfully from repo=$repo_url"
      return 0
    fi
    log_warn "custom-rpm" "Repo attempt failed for repo=$repo_url"
  done

  log_warn "custom-rpm" "Primary distro repos failed for distro=$distro; trying fallback distros rhel and centos"
  for fallback in rhel centos; do
    for repo_base in "${ACTIVE_DOCKER_REPO_BASES[@]}"; do
      repo_url="$repo_base/$fallback/docker-ce.repo"
      if install_from_rpm_repo "$repo_url"; then
        log_info "custom-rpm" "Docker packages installed successfully from fallback repo=$repo_url"
        return 0
      fi
      log_warn "custom-rpm" "Fallback repo attempt failed for repo=$repo_url"
    done
  done

  return 1
}

install_for_apt_family() {
  local repo_base

  for repo_base in "${ACTIVE_DOCKER_REPO_BASES[@]}"; do
    log_info "custom-apt" "Preparing apt repo base=$repo_base"
    run_root apt-get update || return 1
    run_root apt-get install -y ca-certificates curl || return 1
    run_root install -m 0755 -d /etc/apt/keyrings || return 1
    run_root curl -fsSL "$repo_base/gpg" -o /etc/apt/keyrings/docker.asc || return 1
    run_root chmod a+r /etc/apt/keyrings/docker.asc || return 1
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] %s %s stable\n' \
      "$(dpkg --print-architecture)" \
      "$repo_base" \
      "$(. /etc/os-release && echo "$VERSION_CODENAME")" | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null || return 1
    run_root apt-get update || return 1
    if run_root apt-get install -y "${DOCKER_PACKAGES[@]}"; then
      log_info "custom-apt" "Docker packages installed successfully from repo base=$repo_base"
      return 0
    fi
    log_warn "custom-apt" "Package installation failed for repo base=$repo_base"
  done

  return 1
}

verify_docker_installation() {
  log_info "verify" "Starting post-install verification"

  if ! run_root systemctl enable docker; then
    log_error "verify" "Failed to enable docker service"
    return 1
  fi

  if ! run_root systemctl start docker; then
    log_error "verify" "Failed to start docker service"
    return 1
  fi

  if ! command_exists docker; then
    log_error "verify" "docker command not found after installation"
    return 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log_error "verify" "docker compose plugin not available after installation"
    return 1
  fi

  log_info "verify" "Docker and Docker Compose verified successfully"
  return 0
}

install_docker_custom() {
  local distro="${1:-}"

  if [ -z "$distro" ]; then
    distro="${OVERRIDE_DISTRO:-}"
  fi

  if [ -z "$distro" ]; then
    distro="$(detect_distribution)" || {
      log_error "custom" "Unable to determine Linux distribution from /etc/os-release"
      return 1
    }
  fi

  distro="$(printf '%s' "$distro" | tr '[:upper:]' '[:lower:]')"
  log_info "custom" "Starting custom Docker installation for distribution=$distro"

  if command_exists dnf5 || command_exists dnf || command_exists yum; then
    install_for_rpm_family "$distro" || {
      log_error "custom" "RPM-family installation failed for distribution=$distro"
      return 1
    }
  elif command_exists apt-get; then
    install_for_apt_family || {
      log_error "custom" "APT-family installation failed for distribution=$distro"
      return 1
    }
  else
    log_error "custom" "Unsupported system: no known package manager found"
    return 1
  fi

  verify_docker_installation
}

extract_unsupported_distribution() {
  local output="$1"
  printf '%s\n' "$output" | awk -F"'" '/ERROR: Unsupported distribution/ {print $2; exit}'
}

run_official_install_attempt() {
  local param="$1"
  local output
  local cmd=(sh "$DOWNLOADED_SCRIPT")

  if [ -n "$param" ]; then
    cmd+=("--mirror" "$param")
  fi

  log_info "official" "Running official installer command=${cmd[*]} timeout=${OFFICIAL_INSTALL_TIMEOUT}s"
  if ! output="$(timeout "$OFFICIAL_INSTALL_TIMEOUT" "${cmd[@]}" 2>&1)"; then
    printf '%s\n' "$output"
    return 1
  fi

  printf '%s\n' "$output"
  return 0
}

install_docker_official() {
  local mirror
  local output
  local distro=""

  for mirror in "${OFFICIAL_INSTALL_MIRRORS[@]}"; do
    if [ -n "$mirror" ]; then
      log_info "official" "Starting official installation attempt with mirror=$mirror"
    else
      log_info "official" "Starting official installation attempt with default upstream"
    fi

    if output="$(run_official_install_attempt "$mirror")"; then
      printf '%s\n' "$output"
      if verify_docker_installation; then
        log_info "official" "Official installer completed successfully"
        return 0
      fi
      log_warn "official" "Official installer exited successfully but verification failed; switching to custom flow"
      break
    fi

    printf '%s\n' "$output"

    if printf '%s\n' "$output" | grep -q "ERROR: Unsupported distribution"; then
      distro="$(extract_unsupported_distribution "$output")"
      log_warn "official" "Official installer does not support distribution=${distro:-unknown}; switching to custom flow"
      break
    fi

    if printf '%s\n' "$output" | grep -qi "timeout"; then
      log_warn "official" "Official installer attempt timed out; continuing with next mirror"
      continue
    fi

    log_warn "official" "Official installer attempt failed; trying next mirror or fallback"
  done

  if [ -z "$distro" ]; then
    distro="$(detect_distribution 2>/dev/null || true)"
  fi

  log_info "fallback" "Switching to custom installation flow with distribution=${distro:-auto-detect}"
  install_docker_custom "$distro"
}

main() {
  if ! parse_args "$@"; then
    return 1
  fi

  if ! configure_mirror_policy; then
    return 1
  fi

  log_info "main" "Starting $SCRIPT_NAME version=$SCRIPT_VERSION"

  if [ "$SKIP_OFFICIAL" -ne 1 ]; then
    if ! download_docker_script; then
      log_error "main" "Docker installer download stage failed"
      return 1
    fi

    if ! install_docker_official; then
      log_error "main" "Docker installation failed after official and custom flows"
      return 1
    fi
  else
    log_info "main" "Skipping official installer as requested; entering custom installation flow"
    if ! install_docker_custom "$OVERRIDE_DISTRO"; then
      log_error "main" "Docker installation failed in custom-only mode"
      return 1
    fi
  fi

  log_info "main" "Docker installation finished successfully"
  return 0
}

main "$@"