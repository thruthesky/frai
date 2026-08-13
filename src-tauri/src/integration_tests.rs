//! 통합 테스트 — 어댑터를 **실제로 끝까지 돌려** 이벤트가 제대로 나오는지 본다.
//!
//! 파싱 유닛 테스트(각 모듈의 `mod tests`)와 목적이 다르다. 여기서는
//! "프로세스 실행 → stdout 읽기 → 이벤트 emit" 또는 "HTTP 연결 → SSE 수신 → 이벤트 emit"
//! 전 구간이 실제로 이어지는지 확인한다.
//!
//! ⚠️ 이 테스트들은 **앱 창을 띄우지 않는다.** EventSink 를 클로저로 두었기 때문에
//! Tauri 런타임 없이도 어댑터의 실제 이벤트 흐름을 그대로 검증할 수 있다.

use crate::events::{EventSink, SessionEvent};
use crate::provider::{ChatRequest, Message, Provider};
use std::sync::{Arc, Mutex};

/// emit 된 이벤트를 모아 두는 수집기. 프론트 대신 우리가 받는다.
#[derive(Clone, Default)]
struct Collected {
    events: Arc<Mutex<Vec<SessionEvent>>>,
}

impl Collected {
    fn text(&self) -> String {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                SessionEvent::Chunk { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    fn kinds(&self) -> Vec<&'static str> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|e| match e {
                SessionEvent::Started { .. } => "started",
                SessionEvent::Chunk { .. } => "chunk",
                SessionEvent::Done { .. } => "done",
                SessionEvent::Error { .. } => "error",
            })
            .collect()
    }

    fn errors(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                SessionEvent::Error { message, .. } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    fn session_ids(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|e| match e {
                SessionEvent::Started { session_id, .. }
                | SessionEvent::Chunk { session_id, .. }
                | SessionEvent::Done { session_id, .. }
                | SessionEvent::Error { session_id, .. } => session_id.clone(),
            })
            .collect()
    }
}

/// 프론트 대신 이벤트를 받아 모으는 sink 를 만든다.
/// Tauri 런타임을 띄우지 않고도 어댑터의 실제 이벤트 흐름을 그대로 검증한다.
fn sink_with_collector(session_id: &str) -> (EventSink, Collected) {
    let collected = Collected::default();
    let events = collected.events.clone();
    let sink = EventSink::from_fn(session_id.to_string(), move |ev| {
        events.lock().unwrap().push(ev);
    });
    (sink, collected)
}

fn user_request(session_id: &str, provider: &str, prompt: &str) -> ChatRequest {
    ChatRequest {
        session_id: session_id.to_string(),
        provider: provider.to_string(),
        messages: vec![Message {
            role: "user".into(),
            content: prompt.into(),
        }],
        resume_id: None,
    }
}

// ── CLI 어댑터 (실제 프로세스 실행) ────────────────────────────

/// 설치된 `claude` 를 실제로 실행해 답을 받아온다.
/// FRAI 의 핵심 기능이므로 모의가 아니라 진짜로 돌려서 확인한다.
#[tokio::test(flavor = "multi_thread")]
async fn claude_cli_로_실제_응답을_받는다() {
    let Some(spec) = crate::provider::detect::cli_spec("claude") else {
        panic!("claude 스펙이 CLI_SPECS 에 없다");
    };
    if crate::provider::detect::find_executable(spec.bin).is_none() {
        eprintln!("claude 가 설치되어 있지 않아 건너뜀");
        return;
    }

    let (sink, collected) = sink_with_collector("t-claude");
    let provider = crate::provider::claude_cli::CliProvider::new(spec);

    let usage = provider
        .stream(
            user_request("t-claude", "claude", "다음 질문에 숫자만 답해라. 2 더하기 3은?"),
            sink,
        )
        .await
        .expect("claude 스트리밍이 실패했다");

    let text = collected.text();
    assert!(!text.is_empty(), "본문 청크가 하나도 오지 않았다");
    assert!(text.contains('5'), "기대한 답(5)이 없다. 실제 응답: {text:?}");

    let kinds = collected.kinds();
    assert_eq!(kinds.first(), Some(&"started"), "started 가 먼저 와야 한다");
    assert!(collected.errors().is_empty(), "오류 이벤트: {:?}", collected.errors());

    // claude 는 result 줄에 비용을 실어 준다. 비용 표시 기능의 근거다.
    assert!(usage.cost_usd.is_some(), "usage 에 비용이 없다");
    assert!(usage.output_tokens.is_some(), "usage 에 출력 토큰이 없다");
}

/// 모든 이벤트에 세션 ID 가 실려야 그리드에서 칸을 구분할 수 있다.
#[tokio::test(flavor = "multi_thread")]
async fn 모든_이벤트에_세션id_가_실린다() {
    let Some(spec) = crate::provider::detect::cli_spec("claude") else {
        return;
    };
    if crate::provider::detect::find_executable(spec.bin).is_none() {
        eprintln!("claude 가 설치되어 있지 않아 건너뜀");
        return;
    }

    let (sink, collected) = sink_with_collector("세션-A");
    let provider = crate::provider::claude_cli::CliProvider::new(spec);
    let _ = provider
        .stream(user_request("세션-A", "claude", "'ok' 라고만 답해라."), sink)
        .await;

    let ids = collected.session_ids();
    assert!(!ids.is_empty(), "이벤트가 없다");
    assert!(ids.iter().all(|id| id == "세션-A"), "세션 ID 가 섞였다: {ids:?}");
}

/// 없는 실행 파일을 지정하면 조용히 성공하지 않고 명확히 실패해야 한다.
#[tokio::test(flavor = "multi_thread")]
async fn 없는_cli_는_명확한_오류를_낸다() {
    use crate::provider::detect::{CliSpec, OutputFormat};
    static MISSING: CliSpec = CliSpec {
        id: "없는cli",
        bin: "존재할리없는명령어xyz",
        label: "없음",
        args: &[],
        format: OutputFormat::PlainText,
        verified: false,
    };

    let (sink, _collected) = sink_with_collector("t-missing");
    let provider = crate::provider::claude_cli::CliProvider::new(&MISSING);
    let err = provider
        .stream(user_request("t-missing", "없는cli", "안녕"), sink)
        .await
        .expect_err("없는 실행 파일인데 성공했다");
    assert!(err.contains("찾지 못했습니다"), "예상 밖 오류: {err}");
}

// ── 릴레이 어댑터 (모의 SSE 서버) ──────────────────────────────

/// 규약대로 SSE 를 내보내는 1회용 서버를 띄우고 그 주소를 돌려준다.
async fn spawn_mock_relay(body: &'static str, status_line: &'static str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = vec![0u8; 4096];
            let _ = socket.read(&mut buf).await;
            let resp = format!(
                "{status_line}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(resp.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    });

    format!("http://127.0.0.1:{port}/frai/api/chat")
}

#[tokio::test(flavor = "multi_thread")]
async fn 릴레이_sse_를_끝까지_수신한다() {
    let url = spawn_mock_relay(
        concat!(
            "data: {\"type\":\"chunk\",\"text\":\"안녕\"}\n\n",
            "data: {\"type\":\"chunk\",\"text\":\"하세요\"}\n\n",
            "data: {\"type\":\"done\",\"usage\":{\"inputTokens\":3,\"outputTokens\":7,\"costUsd\":0.0004,\"remainingFree\":19}}\n\n",
            "data: [DONE]\n\n"
        ),
        "HTTP/1.1 200 OK",
    )
    .await;

    let (sink, collected) = sink_with_collector("t-relay");
    let provider = crate::provider::relay::RelayProvider::with_url(url);
    let usage = provider
        .stream(user_request("t-relay", "frai-default", "안녕"), sink)
        .await
        .expect("릴레이 스트리밍이 실패했다");

    assert_eq!(collected.text(), "안녕하세요");
    assert_eq!(usage.remaining_free, Some(19), "남은 무료 횟수가 전달되지 않았다");
    assert_eq!(usage.output_tokens, Some(7));
    assert_eq!(usage.cost_usd, Some(0.0004));
}

/// 일일 한도(429)에 걸리면 다른 경로로 안내하는 메시지가 나와야 한다.
#[tokio::test(flavor = "multi_thread")]
async fn 릴레이_429_는_대안을_안내한다() {
    let url = spawn_mock_relay("", "HTTP/1.1 429 Too Many Requests").await;

    let (sink, _collected) = sink_with_collector("t-429");
    let provider = crate::provider::relay::RelayProvider::with_url(url);
    let err = provider
        .stream(user_request("t-429", "frai-default", "안녕"), sink)
        .await
        .expect_err("429 인데 성공했다");

    assert!(err.contains("무료 사용 횟수"), "안내 문구가 없다: {err}");
    assert!(
        err.contains("API 키") && err.contains("CLI"),
        "대안 안내가 없다: {err}"
    );
}

/// 서버가 error 이벤트를 보내면 사용자에게 그대로 전달되어야 한다.
#[tokio::test(flavor = "multi_thread")]
async fn 릴레이_error_이벤트가_전달된다() {
    let url = spawn_mock_relay(
        "data: {\"type\":\"error\",\"message\":\"오늘 예산 소진\"}\n\n",
        "HTTP/1.1 200 OK",
    )
    .await;

    let (sink, collected) = sink_with_collector("t-relay-err");
    let provider = crate::provider::relay::RelayProvider::with_url(url);
    let _ = provider
        .stream(user_request("t-relay-err", "frai-default", "안녕"), sink)
        .await;

    assert_eq!(collected.errors(), vec!["오늘 예산 소진".to_string()]);
}

// ── 프로바이더 해석 ────────────────────────────────────────────

#[test]
fn 프로바이더_id_로_어댑터를_고른다() {
    assert!(crate::provider::resolve("frai-default").is_ok());
    assert!(crate::provider::resolve("claude").is_ok());
    let err = match crate::provider::resolve("없는-프로바이더") {
        Ok(_) => panic!("없는 프로바이더인데 어댑터가 만들어졌다"),
        Err(e) => e,
    };
    assert!(err.contains("알 수 없는 프로바이더"), "예상 밖 오류: {err}");
}

/// 기본 AI 는 서버를 경유하므로 반드시 "기기를 벗어남" 으로 표시되어야 한다.
/// 이 표시가 빠지면 사용자가 모르는 채 대화가 서버를 지나게 된다.
#[test]
fn 릴레이만_기기를_벗어난다고_표시된다() {
    let list = crate::commands::list_providers();
    let relay = list.iter().find(|p| p.id == "frai-default").expect("기본 AI 가 없다");
    assert!(relay.leaves_device, "기본 AI 에 서버 경유 표시가 없다");

    for cli in list.iter().filter(|p| p.id != "frai-default") {
        assert!(!cli.leaves_device, "{} 가 서버 경유로 표시됐다", cli.id);
    }
}

/// 설치되지 않은 CLI 는 사유와 함께 사용 불가로 나와야 한다("설치 안 됨"과 "못 찾음"은 다르다).
#[test]
fn cli_탐지_결과가_목록에_반영된다() {
    let list = crate::commands::list_providers();
    for p in list.iter().filter(|p| p.id != "frai-default") {
        if p.available {
            assert!(p.path.is_some(), "{} 가 사용 가능인데 경로가 없다", p.id);
        } else {
            assert!(p.reason.is_some(), "{} 가 사용 불가인데 사유가 없다", p.id);
        }
    }
}
