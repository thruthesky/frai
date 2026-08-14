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

# ⚠️ `dmg` 키는 업데이터가 아니라 **랜딩 페이지**(web/src/routes/frai/+page.svelte)가 읽는다.
#    거기서 `release.dmg.url` 이 없으면 다운로드 버튼 자체가 렌더되지 않는다.
#    이 키가 빠진 매니페스트를 올리면 홈페이지에서 내려받을 수단이 사라지므로 필수다.
DMG_FILE="$BUNDLE/dmg/Frai_${VERSION}_universal.dmg"
[ -f "$DMG_FILE" ] || { echo "❌ $DMG_FILE 이 없다. 먼저 빌드하라(랜딩 다운로드 링크에 필요)." >&2; exit 1; }
DMG_SIZE=$(stat -f%z "$DMG_FILE")

SIG=$(cat "$SIG_FILE")
URL="$BASE/frai/releases/$VERSION/Frai.app.tar.gz"
DMG_URL="$BASE/frai/releases/$VERSION/Frai_${VERSION}_universal.dmg"
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
  },
  "dmg": {
    "url": "$DMG_URL",
    "size": $DMG_SIZE
  }
}
JSON

echo "생성: $OUT"
echo "  version : $VERSION"
echo "  url     : $URL"
echo "  dmg     : $DMG_URL ($((DMG_SIZE / 1024 / 1024))MB)"
# 랜딩 페이지가 읽는 키까지 확인한다 — 형식만 맞고 dmg 가 없으면 버튼이 사라진다.
node -e "
const j = JSON.parse(require('fs').readFileSync('$OUT','utf8'));
if (!j.dmg || !j.dmg.url || !j.dmg.size) { console.error('  ❌ dmg 키 누락 — 랜딩 다운로드 버튼이 죽는다'); process.exit(1); }
if (!j.platforms['darwin-aarch64'] || !j.platforms['darwin-aarch64'].signature) { console.error('  ❌ 업데이터 서명 누락'); process.exit(1); }
console.log('  JSON 유효성: OK (dmg·platforms 키 확인)');
"
