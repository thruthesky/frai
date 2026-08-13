//! 설치된 CLI 를 자식 프로세스로 실행하는 어댑터.
//!
//! 보안 원칙:
//! - **셸을 거치지 않는다.** `sh -c` 를 쓰면 프롬프트에 인젝션이 가능해진다.
//!   실행 파일을 직접 spawn 하고 인자는 배열로 넘긴다.
//! - **프롬프트는 인자가 아니라 stdin 으로 넘긴다.** 인자 길이 제한을 피하고,
//!   프로세스 목록(`ps`)에 사용자 대화가 노출되지 않는다.
//! - **허용 목록(`CLI_SPECS`)에 있는 실행 파일만** 구동한다. 프론트가 보낸
//!   임의 문자열을 명령으로 실행하지 않는다.

use super::detect::{find_executable, user_path, CliSpec, OutputFormat};
use super::{last_user_prompt, ChatRequest, Provider};
use crate::events::{EventSink, Usage};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub struct CliProvider {
    spec: &'static CliSpec,
}

impl CliProvider {
    pub fn new(spec: &'static CliSpec) -> Self {
        Self { spec }
    }
}

#[async_trait::async_trait]
impl Provider for CliProvider {
    async fn stream(&self, req: ChatRequest, sink: EventSink) -> Result<Usage, String> {
        let spec = self.spec;

        let bin = find_executable(spec.bin).ok_or_else(|| {
            format!(
                "`{}` 실행 파일을 찾지 못했습니다. 설치되어 있다면 설정에서 경로를 직접 지정해 주세요.",
                spec.bin
            )
        })?;

        let prompt = last_user_prompt(&req.messages)
            .ok_or_else(|| "보낼 사용자 메시지가 없습니다.".to_string())?
            .to_string();

        let mut cmd = Command::new(&bin);
        cmd.args(spec.args);

        // 대화 이어가기. CLI 가 자체 세션을 관리하므로 히스토리를 다시 보내지 않는다.
        if let Some(rid) = req.resume_id.as_deref() {
            if spec.format == OutputFormat::ClaudeStreamJson {
                cmd.args(["--resume", rid]);
            }
        }

        // ⚠️ 자식이 다시 자식을 띄우는 경우까지 고려해 PATH 를 명시적으로 물려준다.
        cmd.env("PATH", user_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // 이 future 가 abort 되면 Child 가 drop 되고, 그때 프로세스를 확실히 죽인다.
            // 그리드로 여러 세션을 동시에 돌리므로 좀비가 빠르게 쌓인다.
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("`{}` 실행에 실패했습니다: {e}", bin.display()))?;

        sink.started(spec.id);

        // 프롬프트를 stdin 으로 넘기고 즉시 닫는다(닫지 않으면 CLI 가 입력을 기다린다).
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .await
                .map_err(|e| format!("프롬프트 전달 실패: {e}"))?;
            drop(stdin);
        }

        // stderr 는 별도 태스크로 모은다. 실패했을 때 사용자에게 이유를 보여주기 위함이다.
        let stderr_handle = child.stderr.take().map(|err| {
            tokio::spawn(async move {
                let mut buf = String::new();
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if buf.len() < 4096 {
                        buf.push_str(&line);
                        buf.push('\n');
                    }
                }
                buf
            })
        });

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "자식 프로세스의 stdout 을 열 수 없습니다.".to_string())?;

        let mut usage = Usage {
            // CLI 경로는 구독 요금제로 커버되므로 FRAI 관점에서 추가 비용이 없다.
            // (claude 는 result 에 total_cost_usd 를 주므로 아래에서 덮어쓴다.)
            cost_usd: Some(0.0),
            ..Default::default()
        };

        let mut lines = BufReader::new(stdout).lines();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("출력 읽기 실패: {e}"))?
        {
            match spec.format {
                OutputFormat::ClaudeStreamJson => match parse_claude_line(&line) {
                    ClaudeLine::Text(text) => sink.chunk(text),
                    ClaudeLine::Finished {
                        cost,
                        input,
                        output,
                        error,
                    } => {
                        if cost.is_some() {
                            usage.cost_usd = cost;
                        }
                        usage.input_tokens = input;
                        usage.output_tokens = output;
                        if let Some(msg) = error {
                            sink.error(msg);
                        }
                    }
                    ClaudeLine::Ignore => {}
                },
                OutputFormat::PlainText => {
                    if !line.is_empty() {
                        sink.chunk(format!("{line}\n"));
                    }
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| format!("프로세스 종료 확인 실패: {e}"))?;

        if !status.success() {
            let detail = match stderr_handle {
                Some(h) => h.await.unwrap_or_default(),
                None => String::new(),
            };
            let detail = detail.trim();
            return Err(if detail.is_empty() {
                format!("`{}` 가 비정상 종료했습니다 (exit={:?})", spec.id, status.code())
            } else {
                format!("`{}` 실행 오류: {detail}", spec.id)
            });
        }

        Ok(usage)
    }
}

/// `parse_claude_line` 의 결과. 부수효과(이벤트 전송)와 파싱을 분리해 테스트 가능하게 둔다.
#[derive(Debug, PartialEq)]
pub enum ClaudeLine {
    Text(String),
    Finished {
        cost: Option<f64>,
        input: Option<u64>,
        output: Option<u64>,
        error: Option<String>,
    },
    Ignore,
}

/// `claude -p --output-format stream-json --verbose` 의 JSONL 한 줄을 해석한다.
///
/// 실측한 줄 구조:
///   {"type":"system","subtype":"init","session_id":"..."}
///   {"type":"rate_limit_event", ...}
///   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}],"usage":{...}}}
///   {"type":"result","subtype":"success","result":"...","total_cost_usd":0.0,"usage":{...}}
///
/// ⚠️ 이 형식은 **델타(토큰) 단위가 아니라 메시지 단위**다. 즉 답변이 완성된 뒤
/// 한 덩어리로 온다. 토큰 단위 스트리밍이 필요해지면 부분 메시지 옵션을 조사해
/// 여기를 확장한다.
pub fn parse_claude_line(line: &str) -> ClaudeLine {
    let line = line.trim();
    if line.is_empty() {
        return ClaudeLine::Ignore;
    }

    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        // JSON 이 아닌 줄(경고 등)은 조용히 흘린다. 본문으로 오해시키지 않는다.
        log::debug!("stream-json 파싱 불가, 무시: {line}");
        return ClaudeLine::Ignore;
    };

    match v.get("type").and_then(|t| t.as_str()) {
        Some("assistant") => {
            let mut text = String::new();
            if let Some(parts) = v.pointer("/message/content").and_then(|c| c.as_array()) {
                for part in parts {
                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                }
            }
            if text.is_empty() {
                ClaudeLine::Ignore
            } else {
                ClaudeLine::Text(text)
            }
        }
        Some("result") => {
            let error = if v.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
                Some(
                    v.get("result")
                        .and_then(|r| r.as_str())
                        .unwrap_or("알 수 없는 오류")
                        .to_string(),
                )
            } else {
                None
            };
            ClaudeLine::Finished {
                cost: v.get("total_cost_usd").and_then(|c| c.as_f64()),
                input: v.pointer("/usage/input_tokens").and_then(|x| x.as_u64()),
                output: v.pointer("/usage/output_tokens").and_then(|x| x.as_u64()),
                error,
            }
        }
        _ => ClaudeLine::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 실측한 첫 줄. 세션 정보일 뿐 본문이 아니므로 무시되어야 한다.
    #[test]
    fn system_init_은_무시된다() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc","tools":["Bash"]}"#;
        assert_eq!(parse_claude_line(line), ClaudeLine::Ignore);
    }

    #[test]
    fn rate_limit_event_는_무시된다() {
        let line = r#"{"type":"rate_limit_event","status":"ok"}"#;
        assert_eq!(parse_claude_line(line), ClaudeLine::Ignore);
    }

    #[test]
    fn assistant_메시지에서_본문을_뽑는다() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"2"}]}}"#;
        assert_eq!(parse_claude_line(line), ClaudeLine::Text("2".into()));
    }

    /// 툴 사용 블록이 섞여 와도 text 만 골라내야 한다.
    #[test]
    fn assistant_의_text_블록만_이어붙인다() {
        let line = r#"{"type":"assistant","message":{"content":[
            {"type":"text","text":"안녕"},
            {"type":"tool_use","id":"t1","name":"Bash","input":{}},
            {"type":"text","text":"하세요"}
        ]}}"#;
        assert_eq!(parse_claude_line(line), ClaudeLine::Text("안녕하세요".into()));
    }

    #[test]
    fn 툴_블록만_있으면_무시된다() {
        let line =
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}"#;
        assert_eq!(parse_claude_line(line), ClaudeLine::Ignore);
    }

    #[test]
    fn result_에서_비용과_토큰을_뽑는다() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"2",
            "total_cost_usd":0.0123,"usage":{"input_tokens":2,"output_tokens":1}}"#;
        assert_eq!(
            parse_claude_line(line),
            ClaudeLine::Finished {
                cost: Some(0.0123),
                input: Some(2),
                output: Some(1),
                error: None,
            }
        );
    }

    #[test]
    fn is_error_인_result_는_오류로_해석된다() {
        let line = r#"{"type":"result","is_error":true,"result":"권한이 없습니다"}"#;
        match parse_claude_line(line) {
            ClaudeLine::Finished { error, .. } => {
                assert_eq!(error.as_deref(), Some("권한이 없습니다"))
            }
            other => panic!("Finished 를 기대했으나 {other:?}"),
        }
    }

    /// CLI 가 JSON 이 아닌 경고를 섞어 내보내도 본문으로 오해하면 안 된다.
    #[test]
    fn json_이_아닌_줄은_무시된다() {
        assert_eq!(parse_claude_line("warning: something"), ClaudeLine::Ignore);
        assert_eq!(parse_claude_line(""), ClaudeLine::Ignore);
        assert_eq!(parse_claude_line("   "), ClaudeLine::Ignore);
    }
}
