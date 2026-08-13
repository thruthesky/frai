//! 기본 AI — getpes.com 을 경유하는 DeepSeek 릴레이.
//!
//! 목적: 아무 설정 없이 **즉시, 무료로** 인공지능을 쓸 수 있게 한다.
//! BYOK 앱의 가장 큰 진입 장벽인 "API 키 발급"을 첫 경험에서 제거한다.
//!
//! 구조:
//!   FRAI ──POST──> https://getpes.com/frai/api/chat ──> api.deepseek.com
//!        <──SSE──                                  <──
//!
//! DeepSeek API 키는 **서버에만** 있고 앱에는 절대 내려오지 않는다.
//!
//! ⚠️ 개인정보: 이 경로는 대화 내용이 getpes.com 서버를 지난다. FRAI 의
//! "대화는 로컬을 벗어나지 않는다" 원칙의 유일한 예외이므로, UI 에서 반드시
//! 명시적으로 고지해야 한다(`ProviderKind::Relay`, `leaves_device: true`).

use super::{ChatRequest, Message, Provider};
use crate::events::{EventSink, Usage};
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::OnceLock;

pub const PROVIDER_ID: &str = "frai-default";

/// 릴레이 엔드포인트. 개발 중에는 `FRAI_RELAY_URL` 로 로컬 서버를 가리킬 수 있다.
fn relay_url() -> String {
    std::env::var("FRAI_RELAY_URL")
        .unwrap_or_else(|_| "https://getpes.com/frai/api/chat".to_string())
}

#[derive(Default)]
pub struct RelayProvider {
    /// 테스트에서 모의 서버를 가리키기 위한 주입점.
    /// 전역 환경변수를 쓰면 병렬 테스트끼리 서로의 값을 덮어써서 조용히 잘못된 결과가 나온다.
    override_url: Option<String>,
}

impl RelayProvider {
    #[cfg(test)]
    pub fn with_url(url: impl Into<String>) -> Self {
        Self {
            override_url: Some(url.into()),
        }
    }

    fn endpoint(&self) -> String {
        self.override_url.clone().unwrap_or_else(relay_url)
    }
}

#[derive(Serialize)]
struct RelayRequest<'a> {
    messages: &'a [Message],
}

#[async_trait::async_trait]
impl Provider for RelayProvider {
    async fn stream(&self, req: ChatRequest, sink: EventSink) -> Result<Usage, String> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("FRAI/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| format!("HTTP 클라이언트 생성 실패: {e}"))?;

        let mut builder = client
            .post(self.endpoint())
            .header("X-Frai-Device", device_id())
            .header("X-Frai-Version", env!("CARGO_PKG_VERSION"));

        // 로그인했으면 계정 기준으로 쿼터를 센다(익명 5회 → 로그인 20회).
        // 토큰은 여기서만 쓰이고 프론트로 나가지 않는다.
        if let Some(auth) = crate::auth::bearer() {
            builder = builder.header("Authorization", auth);
        }

        let resp = builder
            .json(&RelayRequest {
                messages: &req.messages,
            })
            .send()
            .await
            .map_err(|e| format!("서버에 연결하지 못했습니다: {e}"))?;

        // 일일 무료 한도 초과 — 사용자에게 다음 행동을 안내해야 하는 중요한 상태다.
        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(
                "오늘의 무료 사용 횟수를 모두 썼습니다. 설정에서 개인 API 키를 등록하거나 \
                 설치된 CLI(claude 등)를 연결하면 계속 쓸 수 있습니다."
                    .to_string(),
            );
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let body = body.chars().take(300).collect::<String>();
            return Err(format!("서버 오류 ({status}): {body}"));
        }

        sink.started(PROVIDER_ID);

        let mut usage = Usage::default();
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("스트림 수신 중 오류: {e}"))?;
            buf.push_str(&String::from_utf8_lossy(&bytes));

            // SSE 는 줄 단위다. 마지막 조각은 아직 완성되지 않았을 수 있으므로 남겨 둔다.
            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim_end_matches('\r').to_string();
                buf.drain(..=idx);
                match parse_sse_line(&line) {
                    SseEvent::Chunk(text) => sink.chunk(text),
                    SseEvent::Done(u) => {
                        usage = u;
                        return Ok(usage);
                    }
                    SseEvent::Error(msg) => {
                        sink.error(msg);
                        return Ok(usage);
                    }
                    SseEvent::Stop => return Ok(usage),
                    SseEvent::Ignore => {}
                }
            }
        }

        Ok(usage)
    }
}

/// `parse_sse_line` 의 결과. 부수효과와 파싱을 분리해 테스트 가능하게 둔다.
#[derive(Debug, PartialEq)]
pub enum SseEvent {
    Chunk(String),
    Done(Usage),
    Error(String),
    /// `data: [DONE]` — 사용량 정보 없이 스트림만 끝난 경우.
    Stop,
    Ignore,
}

/// SSE 한 줄을 해석한다.
///
/// 서버가 보내는 이벤트 형식 (FRAI 릴레이 API 규약):
///   data: {"type":"chunk","text":"..."}
///   data: {"type":"done","usage":{"inputTokens":..,"outputTokens":..,"costUsd":..,"remainingFree":19}}
///   data: {"type":"error","message":"..."}
///   data: [DONE]
pub fn parse_sse_line(line: &str) -> SseEvent {
    let Some(payload) = line.strip_prefix("data:") else {
        // 주석(`:`)·`event:`·빈 줄 등 SSE 의 다른 필드는 이 규약에서 쓰지 않는다.
        return SseEvent::Ignore;
    };
    let payload = payload.trim();

    if payload.is_empty() {
        return SseEvent::Ignore;
    }
    if payload == "[DONE]" {
        return SseEvent::Stop;
    }

    let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
        return SseEvent::Ignore;
    };

    match v.get("type").and_then(|t| t.as_str()) {
        Some("chunk") => match v.get("text").and_then(|t| t.as_str()) {
            Some(text) if !text.is_empty() => SseEvent::Chunk(text.to_string()),
            _ => SseEvent::Ignore,
        },
        Some("done") => {
            let u = v.get("usage");
            SseEvent::Done(Usage {
                input_tokens: u.and_then(|u| u.get("inputTokens")).and_then(|x| x.as_u64()),
                output_tokens: u.and_then(|u| u.get("outputTokens")).and_then(|x| x.as_u64()),
                cost_usd: u.and_then(|u| u.get("costUsd")).and_then(|x| x.as_f64()),
                remaining_free: u
                    .and_then(|u| u.get("remainingFree"))
                    .and_then(|x| x.as_u64())
                    .map(|x| x as u32),
            })
        }
        Some("error") => SseEvent::Error(
            v.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("서버에서 알 수 없는 오류가 발생했습니다.")
                .to_string(),
        ),
        _ => SseEvent::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_에서_본문을_뽑는다() {
        assert_eq!(
            parse_sse_line(r#"data: {"type":"chunk","text":"안녕"}"#),
            SseEvent::Chunk("안녕".into())
        );
    }

    /// `data:` 뒤 공백이 없는 형태도 SSE 규격상 유효하다.
    #[test]
    fn data_뒤_공백이_없어도_해석한다() {
        assert_eq!(
            parse_sse_line(r#"data:{"type":"chunk","text":"x"}"#),
            SseEvent::Chunk("x".into())
        );
    }

    #[test]
    fn done_에서_사용량과_남은_무료횟수를_뽑는다() {
        let line = r#"data: {"type":"done","usage":{"inputTokens":10,"outputTokens":20,"costUsd":0.0005,"remainingFree":19}}"#;
        assert_eq!(
            parse_sse_line(line),
            SseEvent::Done(Usage {
                input_tokens: Some(10),
                output_tokens: Some(20),
                cost_usd: Some(0.0005),
                remaining_free: Some(19),
            })
        );
    }

    /// usage 가 통째로 빠져도 죽지 않아야 한다(서버 구현이 아직 유동적이다).
    #[test]
    fn usage_가_없는_done_도_처리한다() {
        assert_eq!(
            parse_sse_line(r#"data: {"type":"done"}"#),
            SseEvent::Done(Usage::default())
        );
    }

    #[test]
    fn error_는_메시지를_전달한다() {
        assert_eq!(
            parse_sse_line(r#"data: {"type":"error","message":"한도 초과"}"#),
            SseEvent::Error("한도 초과".into())
        );
    }

    #[test]
    fn done_마커는_스트림을_끝낸다() {
        assert_eq!(parse_sse_line("data: [DONE]"), SseEvent::Stop);
    }

    #[test]
    fn data_가_아닌_줄과_빈_청크는_무시된다() {
        assert_eq!(parse_sse_line(": keep-alive"), SseEvent::Ignore);
        assert_eq!(parse_sse_line("event: ping"), SseEvent::Ignore);
        assert_eq!(parse_sse_line(""), SseEvent::Ignore);
        assert_eq!(parse_sse_line("data:"), SseEvent::Ignore);
        assert_eq!(
            parse_sse_line(r#"data: {"type":"chunk","text":""}"#),
            SseEvent::Ignore
        );
        assert_eq!(parse_sse_line("data: not-json"), SseEvent::Ignore);
    }
}

/// 익명 기기 식별자. 무료 사용량을 세는 기준이 된다.
///
/// ⚠️ 이것만으로는 남용을 막지 못한다. 파일을 지우거나 앱을 재설치하면 새 ID 가 발급된다.
/// 서버 쪽에 **전역 일일 예산 상한**과 추가 방어(계정 로그인 등)가 반드시 필요하다.
/// 자세한 내용은 CLAUDE.md 의 "기본 AI 릴레이" 절 참고.
fn device_id() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| {
        let path = device_id_path();

        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(existing) = std::fs::read_to_string(&path) {
            let trimmed = existing.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }

        let fresh = uuid::Uuid::new_v4().to_string();
        if let Err(e) = std::fs::write(&path, &fresh) {
            log::warn!("기기 ID 저장 실패({}): {e}", path.display());
        }
        fresh
    })
}

fn device_id_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home)
        .join("Library/Application Support/com.getpes.frai")
        .join("device-id")
}
