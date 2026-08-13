#!/usr/bin/env bash
# 빌드 산출물을 배포 전에 검증한다.
#
# 확인 항목:
#   1. 세 아티팩트가 모두 생성되었는가 (DMG / .app.tar.gz / .sig)
#      ⚠️ 업데이터가 받는 것은 DMG 가 아니라 .app.tar.gz 다. 둘 다 있어야 한다.
#   2. Universal binary 인가 (arm64 + x86_64)
#   3. Developer ID 로 서명되었는가
#   4. 공증(notarization)까지 되었는가 — 안 되어 있으면 사용자가 Gatekeeper 경고를 본다
#
# 사용: bash scripts/verify-release.sh
set -uo pipefail

cd "$(dirname "$0")/.."
BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle"
FAIL=0

ok()   { printf "  ✅ %s\n" "$1"; }
bad()  { printf "  ❌ %s\n" "$1"; FAIL=1; }
warn() { printf "  ⚠️  %s\n" "$1"; }

echo "═══ 1. 아티팩트 ═══"
APP=$(find "$BUNDLE/macos" -maxdepth 1 -name "*.app" 2>/dev/null | head -1)
DMG=$(find "$BUNDLE/dmg" -maxdepth 1 -name "*.dmg" 2>/dev/null | head -1)
TARGZ=$(find "$BUNDLE/macos" -maxdepth 1 -name "*.app.tar.gz" 2>/dev/null | head -1)
SIG=$(find "$BUNDLE/macos" -maxdepth 1 -name "*.app.tar.gz.sig" 2>/dev/null | head -1)

[ -n "$APP" ]   && ok ".app       $(basename "$APP")"            || bad ".app 없음"
[ -n "$DMG" ]   && ok "DMG        $(basename "$DMG") ($(du -h "$DMG" | cut -f1))" || bad "DMG 없음"
[ -n "$TARGZ" ] && ok "업데이터    $(basename "$TARGZ") ($(du -h "$TARGZ" | cut -f1))" \
                || bad ".app.tar.gz 없음 — bundle.createUpdaterArtifacts 확인"
[ -n "$SIG" ]   && ok "서명파일    $(basename "$SIG")" || bad ".sig 없음 — TAURI_SIGNING_PRIVATE_KEY 확인"

echo
echo "═══ 2. Universal binary ═══"
if [ -n "$APP" ]; then
  BIN="$APP/Contents/MacOS/$(basename "${APP%.app}")"
  ARCHS=$(lipo -archs "$BIN" 2>/dev/null)
  if echo "$ARCHS" | grep -q arm64 && echo "$ARCHS" | grep -q x86_64; then
    ok "arm64 + x86_64 ($ARCHS)"
  else
    bad "Universal 이 아님: ${ARCHS:-확인 실패}"
  fi
fi

echo
echo "═══ 3. 코드서명 ═══"
if [ -n "$APP" ]; then
  if codesign --verify --deep --strict "$APP" 2>/dev/null; then
    ok "서명 유효"
    AUTH=$(codesign -dv --verbose=4 "$APP" 2>&1 | grep "^Authority=" | head -1 | sed 's/(.*)/(<TEAM_ID>)/')
    ok "${AUTH:-서명자 확인 불가}"
  else
    bad "서명 검증 실패"
  fi
fi

echo
echo "═══ 4. 공증 (Gatekeeper) ═══"
if [ -n "$APP" ]; then
  ASSESS=$(spctl -a -vvv -t install "$APP" 2>&1)
  if echo "$ASSESS" | grep -q "accepted"; then
    ok "Gatekeeper 통과 — 공증됨"
  else
    warn "공증되지 않음. 사용자가 처음 열 때 경고를 본다."
    warn "  APPLE_ID · APPLE_PASSWORD(앱 전용 암호) · APPLE_TEAM_ID 를 넣고 다시 빌드해야 한다."
  fi
  # staple 여부는 별도로 확인한다(공증 후 티켓이 앱에 박혔는가).
  xcrun stapler validate "$APP" >/dev/null 2>&1 && ok "staple 완료" || warn "staple 없음"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "결과: 필수 항목 통과"
else
  echo "결과: 실패 항목 있음"
fi
exit "$FAIL"
