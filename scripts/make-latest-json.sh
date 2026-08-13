#!/usr/bin/env bash
# 업데이터 매니페스트(latest.json)를 만든다.
#
# ⚠️ Universal binary 는 파일 하나지만, Tauri 업데이터는 아키텍처별 키를 요구한다.
#    darwin-aarch64 와 darwin-x86_64 가 같은 .app.tar.gz 를 가리키게 한다.
#
# 사용:
#   bash scripts/make-latest-json.sh <R2_PUBLIC_BASE_URL>
# 예:
#   bash scripts/make-latest-json.sh https://dl.getpes.com
#   → https://dl.getpes.com/frai/releases/0.1.0/Frai.app.tar.gz 를 가리킨다
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "사용법: bash scripts/make-latest-json.sh <R2_PUBLIC_BASE_URL>" >&2
  echo "  R2 공개 접근 방식이 아직 미정이다(공개 r2.dev URL vs dl.getpes.com)." >&2
  exit 1
fi
BASE="${BASE%/}"

BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle"
SIG_FILE="$BUNDLE/macos/Frai.app.tar.gz.sig"
VERSION=$(node -p "require('./package.json').version")
OUT="dist-release/latest.json"

[ -f "$SIG_FILE" ] || { echo "❌ $SIG_FILE 이 없다. 먼저 빌드하고 서명하라." >&2; exit 1; }

SIG=$(cat "$SIG_FILE")
URL="$BASE/frai/releases/$VERSION/Frai.app.tar.gz"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p dist-release
cat > "$OUT" <<JSON
{
  "version": "$VERSION",
  "notes": "FRAI $VERSION",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIG",
      "url": "$URL"
    },
    "darwin-x86_64": {
      "signature": "$SIG",
      "url": "$URL"
    }
  }
}
JSON

echo "생성: $OUT"
echo "  version : $VERSION"
echo "  url     : $URL"
node -e "JSON.parse(require('fs').readFileSync('$OUT','utf8')); console.log('  JSON 유효성: OK')"
