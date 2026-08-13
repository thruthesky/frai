//! 프로바이더 추상화.
//!
//! 서로 다른 3가지 전송 방식을 하나의 트레이트로 감싼다.
//!   1. 릴레이   — getpes.com 을 거치는 기본 AI (DeepSeek)
//!   2. 서브프로세스 — 설치된 CLI (claude, codex, opencode, grok, kimi)
//!   3. HTTP/SSE — 사용자 API 키 직접 호출 (예정)

pub mod claude_cli;
pub mod detect;
pub mod relay;

use crate::events::{EventSink, Usage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub session_id: String,
    /// 프로바이더 식별자. `list_providers` 가 반환한 `id` 중 하나.
    pub provider: String,
    pub messages: Vec<Message>,
    /// CLI 세션 재개용. 없으면 새 대화로 시작한다.
    #[serde(default)]
    pub resume_id: Option<String>,
}

/// 프로바이더가 어떤 성격인지 — UI 가 비용·개인정보 표시를 결정하는 데 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    /// getpes.com 을 경유한다. 대화 내용이 서버를 지나므로 UI 에 반드시 고지한다.
    Relay,
    /// 로컬에 설치된 CLI 를 실행한다. 추가 비용 없음.
    Cli,
    /// 사용자 API 키로 직접 호출한다. 종량 과금.
    ApiKey,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    /// 지금 당장 쓸 수 있는가. CLI 는 탐지 결과에 따라 달라진다.
    pub available: bool,
    /// 사용 불가 사유 (설치 안 됨 / 경로 못 찾음 등). 사용자에게 그대로 보여준다.
    pub reason: Option<String>,
    /// 실행 파일 경로 (CLI 만 해당). 문제 진단용으로 UI 에 노출한다.
    pub path: Option<String>,
    /// 대화가 로컬을 벗어나는가. Relay 만 true.
    pub leaves_device: bool,
}

#[async_trait::async_trait]
pub trait Provider: Send + Sync {
    /// 응답을 스트리밍한다. 청크는 `sink` 로 내보내고, 최종 사용량을 반환한다.
    ///
    /// 취소는 이 future 를 abort 하는 방식으로 이뤄진다. 따라서 구현체는
    /// **abort 시점에 자식 프로세스나 연결이 확실히 정리되도록** 해야 한다
    /// (예: `Command::kill_on_drop(true)`).
    async fn stream(&self, req: ChatRequest, sink: EventSink) -> Result<Usage, String>;
}

/// 요청의 프로바이더 id 로 구현체를 고른다.
pub fn resolve(id: &str) -> Result<Box<dyn Provider>, String> {
    match id {
        relay::PROVIDER_ID => Ok(Box::new(relay::RelayProvider::default())),
        _ => match detect::cli_spec(id) {
            Some(spec) => Ok(Box::new(claude_cli::CliProvider::new(spec))),
            None => Err(format!("알 수 없는 프로바이더입니다: {id}")),
        },
    }
}

/// 마지막 사용자 메시지를 프롬프트로 뽑는다.
/// CLI 는 대화 히스토리를 자체 세션으로 관리하므로 마지막 발화만 넘긴다.
pub fn last_user_prompt(messages: &[Message]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
}
