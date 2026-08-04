{ pkgs ? import <nixpkgs> {} }:

pkgs.buildEnv {
  name = "appos-dev";
  paths = with pkgs; [
    go
    nodejs_22
    python3
    docker
    golangci-lint
    actionlint
    govulncheck
    gitleaks
  ];
}
