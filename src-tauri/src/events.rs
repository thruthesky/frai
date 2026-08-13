//! 프론트로 내보내는 통일 이벤트.
//!
//! FRAI 의 핵심 규칙: 어떤 전송 방식(HTTP/SSE·서브프로세스·릴레이)을 쓰든
//! 프론트가 받는 이벤트의 형태는 **완전히 동일하다.** 프론트는 응답이
//! 어디서 왔는지 알 필요가 없다. 이 규칙이 깨지면 그리드 UI 가 프로바이더마다
//! 분기 처리로 오염된다.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 프론트가 `listen()` 할 단일 이벤트 이름.
/// 세션 구분은 이벤트 이름이 아니라 payload 의 `sessionId` 로 한다.
pub const EVENT_NAME: &str = "session-event";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    /// 실제로 청구된 비용(USD). CLI·로컬 모델처럼 추가 비용이 없는 경로는 `Some(0.0)`.
    pub cost_usd: Option<f64>,
    /// 기본 AI(릴레이) 사용 시 남은 무료 횟수. 그 외에는 None.
    pub remaining_free: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionEvent {
    #[serde(rename_all = "camelCase")]
    Started { session_id: String, provider: String },
    #[serde(rename_all = "camelCase")]
    Chunk { session_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    Done { session_id: String, usage: Usage },
    #[serde(rename_all = "camelCase")]
    Error { session_id: String, message: String },
}

/// 이벤트를 내보내는 통로. 어댑터는 이것만 통해 바깥과 대화한다.
///
/// 내부를 `AppHandle` 이 아니라 클로저로 둔 이유: 어댑터를 테스트할 때
/// Tauri 런타임을 띄우지 않아도 되게 하기 위해서다. 어댑터 입장에서는
/// "이벤트를 어디로 보내는지" 를 알 필요가 없다.
#[derive(Clone)]
pub struct EventSink {
    emit: std::sync::Arc<dyn Fn(SessionEvent) + Send + Sync>,
    session_id: String,
}

impl EventSink {
    pub fn new<R: tauri::Runtime>(app: AppHandle<R>, session_id: String) -> Self {
        Self {
            emit: std::sync::Arc::new(move |ev| {
                // 이벤트 전송 실패는 치명적이지 않다(창이 이미 닫혔을 수 있다).
                if let Err(e) = app.emit(EVENT_NAME, ev) {
                    log::warn!("이벤트 전송 실패: {e}");
                }
            }),
            session_id,
        }
    }

    /// 이벤트를 임의의 수집기로 보내는 sink. 테스트에서 프론트 대신 받는다.
    #[cfg(test)]
    pub fn from_fn(
        session_id: String,
        f: impl Fn(SessionEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            emit: std::sync::Arc::new(f),
            session_id,
        }
    }

    fn emit(&self, ev: SessionEvent) {
        (self.emit)(ev);
    }

    pub fn started(&self, provider: &str) {
        self.emit(SessionEvent::Started {
            session_id: self.session_id.clone(),
            provider: provider.to_string(),
        });
    }

    pub fn chunk(&self, text: impl Into<String>) {
        self.emit(SessionEvent::Chunk {
            session_id: self.session_id.clone(),
            text: text.into(),
        });
    }

    pub fn done(&self, usage: Usage) {
        self.emit(SessionEvent::Done {
            session_id: self.session_id.clone(),
            usage,
        });
    }

    pub fn error(&self, message: impl Into<String>) {
        self.emit(SessionEvent::Error {
            session_id: self.session_id.clone(),
            message: message.into(),
        });
    }
}
