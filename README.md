# AppOS
OS for Your self-hosted Apps

## Spec Conventions

- `specs/planning-artifacts/epics.md` is an index only.
- Do not write full story content in `epics.md`.
- Epic-level detail belongs in `specs/implementation-artifacts/epic*.md`.
- Implementation-ready story detail belongs in `specs/implementation-artifacts/story*.md`.

## Install

```
docker run -d --name appos-demo --restart unless-stopped -p 9092:80 -p 9223:2222 -v appos_data:/appos/data websoft9dev/appos:dev
```
