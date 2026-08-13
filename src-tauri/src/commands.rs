//! 프론트에서 부를 수 있는 명령.
//!
//! ⚠️ 최소 권한 원칙: 여기 없는 것은 프론트가 할 수 없다.
//! 특히 **임의 명령 실행을 받는 명령을 만들지 않는다.** CLI 실행은
//! `CLI_SPECS` 허용 목록을 통해서만 이뤄진다.

use crate::provider::detect::{find_executable, CLI_SPECS};
use crate::provider::relay::PROVIDER_ID as RELAY_ID;
use crate::provider::{ChatRequest, ProviderInfo, ProviderKind};
use crate::session::SessionManager;
use tauri::{AppHandle, State};

/// 지금 쓸 수 있는 프로바이더 목록. 앱 시작 시와 설정 변경 시 호출한다.
#[tauri::command]
pub fn list_providers() -> Vec<ProviderInfo> {
    let mut out = Vec::with_capacity(CLI_SPECS.len() + 1);

    // 기본 AI — 설정 없이 즉시 쓸 수 있는 경로. 항상 첫 번째에 둔다.
    out.push(ProviderInfo {
        id: RELAY_ID.to_string(),
        label: "기본 AI (무료)".to_string(),
        kind: ProviderKind::Relay,
        available: true,
        reason: None,
        path: None,
        leaves_device: true,
    });

    for spec in CLI_SPECS {
        let found = find_executable(spec.bin);
        let (available, reason) = match (&found, spec.verified) {
            (None, _) => (
                false,
                Some(format!("`{}` 를 찾지 못했습니다.", spec.bin)),
            ),
            (Some(_), false) => (
                true,
                Some("실험적 지원 — 출력 형식이 검증되지 않았습니다.".to_string()),
            ),
            (Some(_), true) => (true, None),
        };

        out.push(ProviderInfo {
            id: spec.id.to_string(),
            label: spec.label.to_string(),
            kind: ProviderKind::Cli,
            available,
            reason,
            path: found.map(|p| p.display().to_string()),
            leaves_device: false,
        });
    }

    out
}

/// 세션에 메시지를 보내고 응답 스트리밍을 시작한다.
/// 응답은 반환값이 아니라 `session-event` 이벤트로 흘러온다.
#[tauri::command]
pub fn send_message(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    request: ChatRequest,
) -> Result<(), String> {
    sessions.reap_finished();
    sessions.start(app, request)
}

/// 진행 중인 세션을 중단한다.
#[tauri::command]
pub fn cancel_session(sessions: State<'_, SessionManager>, session_id: String) {
    sessions.cancel(&session_id);
}

// ── 계정 (PES 호환 로그인) ────────────────────────────────
//
// ⚠️ 세션 토큰을 반환하는 명령은 만들지 않는다. 프론트에는 "로그인했는가",
// "누구인가" 만 알려준다. 토큰은 키체인에만 있고 Rust 안에서만 쓰인다.

#[tauri::command]
pub fn auth_status() -> crate::auth::AuthStatus {
    crate::auth::status()
}

/// 시스템 브라우저를 열고 로그인이 끝날 때까지 기다린다(최대 5분).
#[tauri::command]
pub async fn auth_sign_in() -> Result<crate::auth::AuthStatus, String> {
    crate::auth::sign_in().await
}

#[tauri::command]
pub fn auth_sign_out() -> Result<crate::auth::AuthStatus, String> {
    crate::auth::sign_out()?;
    Ok(crate::auth::status())
}

/// 진단용 — 로그인 셸에서 확보한 PATH 를 그대로 보여준다.
/// `.app` 배포본에서 CLI 를 못 찾을 때 원인 파악에 쓴다.
#[tauri::command]
pub fn diagnostics() -> serde_json::Value {
    serde_json::json!({
        "path": crate::provider::detect::user_path(),
        "shell": std::env::var("SHELL").unwrap_or_default(),
    })
}
