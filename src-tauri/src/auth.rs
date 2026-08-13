//! PES(getpes.com) 호환 로그인 — 시스템 브라우저 + 루프백 콜백 + PKCE.
//!
//! 왜 커스텀 스킴(`frai://`)이 아니라 루프백인가:
//!   - 커스텀 스킴은 `.app` 번들이 LaunchServices 에 등록돼야 동작한다.
//!     즉 `tauri dev` 에서는 재현되지 않고 배포본에서만 확인된다(PATH 함정과 같은 구조).
//!   - 브라우저가 사용자 제스처 없는 스킴 전환을 차단하는 경우가 있다.
//!   - macOS 는 다른 앱이 같은 스킴을 등록하는 것을 막지 않는다(하이재킹).
//!   루프백(127.0.0.1)은 RFC 8252 가 네이티브 앱에 권장하는 방식이며 위 문제가 없다.
//!
//! 흐름:
//!   1. verifier/challenge(PKCE) + state 생성, 127.0.0.1 임의 포트에 1회용 서버 기동
//!   2. 시스템 브라우저로 getpes.com 로그인 페이지 열기
//!   3. 로그인 성공 → 브라우저가 http://127.0.0.1:PORT/callback?code=..&state=.. 로 이동
//!   4. 앱이 code 를 받아 서버에 교환 요청(verifier 동봉) → 세션 토큰 획득
//!   5. 토큰은 **OS 키체인에** 저장한다. 웹뷰에는 절대 내려보내지 않는다.
//!
//! ⚠️ 루프백이라도 PKCE 는 반드시 쓴다. 같은 기기의 다른 프로세스가 code 를
//! 가로챌 가능성이 남아 있고, verifier 없이는 그 code 를 쓸 수 없어야 한다.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const KEYCHAIN_SERVICE: &str = "com.getpes.frai";
const KEYCHAIN_ACCOUNT: &str = "pes-session";

/// 로그인 시작 페이지. 개발 중에는 `FRAI_AUTH_BASE` 로 로컬 PES 를 가리킬 수 있다.
fn auth_base() -> String {
    std::env::var("FRAI_AUTH_BASE").unwrap_or_else(|_| "https://getpes.com".to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub signed_in: bool,
    pub uid: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeResponse {
    token: String,
    uid: String,
    #[serde(default)]
    display_name: Option<String>,
}

/// 키체인에 보관하는 값. 토큰 본체는 프론트로 나가지 않는다.
#[derive(Debug, Serialize, Deserialize)]
struct StoredSession {
    token: String,
    uid: String,
    display_name: Option<String>,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("키체인을 열 수 없습니다: {e}"))
}

fn load_session() -> Option<StoredSession> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_session(s: &StoredSession) -> Result<(), String> {
    let raw = serde_json::to_string(s).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&raw)
        .map_err(|e| format!("키체인 저장 실패: {e}"))
}

pub fn status() -> AuthStatus {
    match load_session() {
        Some(s) => AuthStatus {
            signed_in: true,
            uid: Some(s.uid),
            display_name: s.display_name,
        },
        None => AuthStatus {
            signed_in: false,
            uid: None,
            display_name: None,
        },
    }
}

pub fn sign_out() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        // 원래 없었으면 성공으로 본다.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("키체인 삭제 실패: {e}")),
    }
}

/// 서버 API 호출에 붙일 인증 헤더 값. 로그인하지 않았으면 None.
/// 토큰 자체는 이 모듈 밖으로 나가지 않는다.
pub fn bearer() -> Option<String> {
    load_session().map(|s| format!("Bearer {}", s.token))
}

/// 로그인 전체 흐름. 브라우저를 열고 콜백을 기다린 뒤 토큰을 저장한다.
pub async fn sign_in() -> Result<AuthStatus, String> {
    // 1. PKCE + state
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token();

    // 2. 1회용 루프백 서버. 포트 0 → OS 가 빈 포트를 준다.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("로컬 콜백 서버를 열 수 없습니다: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    // 3. 시스템 브라우저로 로그인 페이지 열기
    let url = format!(
        "{}/frai/auth?redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
        auth_base(),
        percent_encode(&redirect_uri),
        percent_encode(&state),
        percent_encode(&challenge),
    );
    open_browser(&url)?;

    // 4. 콜백 대기. 사용자가 로그인을 끝내지 않을 수 있으므로 반드시 타임아웃을 둔다.
    let received = tokio::time::timeout(Duration::from_secs(300), wait_for_callback(listener))
        .await
        .map_err(|_| "로그인 시간이 초과되었습니다. 다시 시도해 주세요.".to_string())??;

    if received.state != state {
        return Err("로그인 상태 값이 일치하지 않습니다. 보안을 위해 중단했습니다.".to_string());
    }

    // 5. code → 토큰 교환 (verifier 동봉)
    let client = reqwest::Client::builder()
        .user_agent(concat!("FRAI/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/frai/api/auth/exchange", auth_base()))
        .json(&serde_json::json!({
            "code": received.code,
            "codeVerifier": verifier,
            "redirectUri": redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| format!("인증 서버에 연결하지 못했습니다: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "로그인에 실패했습니다 ({status}): {}",
            body.chars().take(200).collect::<String>()
        ));
    }

    let parsed: ExchangeResponse = resp
        .json()
        .await
        .map_err(|e| format!("서버 응답을 해석하지 못했습니다: {e}"))?;

    save_session(&StoredSession {
        token: parsed.token,
        uid: parsed.uid,
        display_name: parsed.display_name,
    })?;

    Ok(status())
}

#[derive(Debug, PartialEq)]
struct Callback {
    code: String,
    state: String,
}

/// 콜백 요청 한 건만 받고 서버를 닫는다.
async fn wait_for_callback(listener: TcpListener) -> Result<Callback, String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|e| format!("콜백 수신 실패: {e}"))?;

        let mut buf = vec![0u8; 4096];
        let n = socket.read(&mut buf).await.unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);

        // "GET /callback?code=..&state=.. HTTP/1.1"
        let Some(line) = req.lines().next() else {
            continue;
        };
        let Some(path) = line.split_whitespace().nth(1) else {
            continue;
        };
        if !path.starts_with("/callback") {
            let _ = socket.write_all(response_html("이 페이지는 사용되지 않습니다.").as_bytes()).await;
            continue;
        }

        let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
        match parse_callback_query(query) {
            CallbackResult::Ok(cb) => {
                let _ = socket
                    .write_all(
                        response_html("로그인이 완료되었습니다. 이 창을 닫고 FRAI 로 돌아가세요.")
                            .as_bytes(),
                    )
                    .await;
                let _ = socket.shutdown().await;
                return Ok(cb);
            }
            CallbackResult::Denied(err) => {
                let _ = socket
                    .write_all(
                        response_html("로그인이 취소되었습니다. 앱으로 돌아가세요.").as_bytes(),
                    )
                    .await;
                return Err(format!("로그인이 취소되었습니다: {err}"));
            }
            CallbackResult::Invalid => {
                let _ = socket
                    .write_all(response_html("잘못된 콜백 요청입니다.").as_bytes())
                    .await;
            }
        }
    }
}

#[derive(Debug, PartialEq)]
enum CallbackResult {
    Ok(Callback),
    /// 서버가 `error=` 로 거절한 경우.
    Denied(String),
    /// code 나 state 가 빠진 요청. 서버를 닫지 않고 계속 기다린다.
    Invalid,
}

/// 콜백 URL 의 쿼리스트링을 해석한다.
fn parse_callback_query(query: &str) -> CallbackResult {
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("code", v)) => code = Some(percent_decode(v)),
            Some(("state", v)) => state = Some(percent_decode(v)),
            Some(("error", v)) => error = Some(percent_decode(v)),
            _ => {}
        }
    }

    if let Some(err) = error {
        return CallbackResult::Denied(err);
    }
    match (code, state) {
        (Some(code), Some(state)) => CallbackResult::Ok(Callback { code, state }),
        _ => CallbackResult::Invalid,
    }
}

fn response_html(message: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>FRAI</title>\
         <body style=\"font-family:-apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#16181d;color:#e6e8ec\">\
         <p>{message}</p></body>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

/// macOS 기본 브라우저로 URL 을 연다. 셸을 거치지 않는다.
fn open_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("브라우저를 열 수 없습니다: {e}"))
}

/// 128비트 이상의 무작위 문자열. uuid v4 두 개를 이어 쓴다(추가 의존성 없이 충분한 엔트로피).
fn random_token() -> String {
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 7636 부록 B 의 공식 예시. 우리 PKCE 계산이 표준과 일치하는지 확인한다.
    #[test]
    fn pkce_challenge_가_rfc7636_예시와_일치한다() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_token_은_매번_다르고_충분히_길다() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64); // uuid simple 32자 × 2
    }

    #[test]
    fn percent_encode_는_예약문자를_인코딩한다() {
        // redirect_uri 를 쿼리에 실을 때 깨지지 않아야 한다.
        assert_eq!(
            percent_encode("http://127.0.0.1:51234/callback"),
            "http%3A%2F%2F127.0.0.1%3A51234%2Fcallback"
        );
        // 비예약 문자는 그대로 둔다.
        assert_eq!(percent_encode("aZ0-_.~"), "aZ0-_.~");
    }

    #[test]
    fn percent_인코딩은_왕복해도_같다() {
        for s in [
            "http://127.0.0.1:1/callback",
            "한글 값",
            "a+b&c=d",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        ] {
            assert_eq!(percent_decode(&percent_encode(s)), s, "왕복 실패: {s}");
        }
    }

    #[test]
    fn 콜백_쿼리에서_code_와_state_를_뽑는다() {
        assert_eq!(
            parse_callback_query("code=abc123&state=xyz789"),
            CallbackResult::Ok(Callback {
                code: "abc123".into(),
                state: "xyz789".into()
            })
        );
    }

    #[test]
    fn 콜백_쿼리의_인코딩된_값을_디코딩한다() {
        assert_eq!(
            parse_callback_query("code=a%2Bb&state=%ED%95%9C%EA%B8%80"),
            CallbackResult::Ok(Callback {
                code: "a+b".into(),
                state: "한글".into()
            })
        );
    }

    #[test]
    fn 서버가_error_를_주면_거절로_해석한다() {
        assert_eq!(
            parse_callback_query("error=access_denied"),
            CallbackResult::Denied("access_denied".into())
        );
    }

    /// code 나 state 가 빠진 요청으로 로그인이 성립하면 안 된다.
    #[test]
    fn code_나_state_가_빠지면_무효다() {
        assert_eq!(parse_callback_query("code=abc"), CallbackResult::Invalid);
        assert_eq!(parse_callback_query("state=xyz"), CallbackResult::Invalid);
        assert_eq!(parse_callback_query(""), CallbackResult::Invalid);
    }
}
