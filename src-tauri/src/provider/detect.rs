//! 설치된 CLI 탐지 + macOS GUI 앱의 PATH 문제 해결.
//!
//! ⚠️ 이 파일이 존재하는 이유:
//! `.app` 번들로 실행된 GUI 앱은 사용자의 셸 PATH 를 **상속받지 않는다.**
//! 이 개발 머신에서 실측한 결과 대상 CLI 5개가 전부 GUI 기본 PATH 밖에 있었다.
//!   claude/codex → ~/.local/bin,  opencode → ~/.nvm/.../bin,
//!   grok → ~/.grok/bin,  kimi → ~/.kimi-code/bin
//! 따라서 경로를 하드코딩하면 반드시 깨진다(특히 nvm 은 노드 버전이 바뀌면 경로가 바뀐다).
//! 반드시 로그인 셸에서 PATH 를 받아와야 한다.
//!
//! ⚠️ `tauri dev` 로는 이 문제가 재현되지 않는다. 개발 서버는 터미널 PATH 를
//! 그대로 물려받기 때문이다. 검증은 반드시 `.app` 빌드본으로 한다.

use std::path::PathBuf;
use std::sync::OnceLock;

/// CLI 의 출력 해석 방식.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    /// `claude -p --output-format stream-json --verbose` 의 JSONL 출력. (실측 검증됨)
    ClaudeStreamJson,
    /// stdout 을 그대로 텍스트로 흘려보낸다.
    PlainText,
}

#[derive(Debug, Clone)]
pub struct CliSpec {
    pub id: &'static str,
    pub bin: &'static str,
    pub label: &'static str,
    pub args: &'static [&'static str],
    pub format: OutputFormat,
    /// 실제로 옵션·출력 형식을 확인했는가.
    /// false 면 UI 에 "실험적"으로 표시하고, 구현 전 `--help` 로 반드시 재확인한다.
    pub verified: bool,
}

/// 지원 대상 CLI 목록.
///
/// `claude` 만 실제 출력을 확인해 구현했다. 나머지는 잠정값이며 `verified: false` 다.
/// 각 CLI 를 정식 지원할 때는 반드시 `<bin> --help` 로 인자와 출력 형식을 먼저 확인하고
/// 여기 값을 고친 뒤 `verified` 를 올린다. 추측으로 채우지 않는다.
pub const CLI_SPECS: &[CliSpec] = &[
    CliSpec {
        id: "claude",
        bin: "claude",
        label: "Claude Code",
        args: &["-p", "--output-format", "stream-json", "--verbose"],
        format: OutputFormat::ClaudeStreamJson,
        verified: true,
    },
    CliSpec {
        id: "codex",
        bin: "codex",
        label: "Codex",
        args: &[],
        format: OutputFormat::PlainText,
        verified: false,
    },
    CliSpec {
        id: "opencode",
        bin: "opencode",
        label: "opencode",
        args: &[],
        format: OutputFormat::PlainText,
        verified: false,
    },
    CliSpec {
        id: "grok",
        bin: "grok",
        label: "Grok",
        args: &[],
        format: OutputFormat::PlainText,
        verified: false,
    },
    CliSpec {
        id: "kimi",
        bin: "kimi",
        label: "Kimi",
        args: &[],
        format: OutputFormat::PlainText,
        verified: false,
    },
];

pub fn cli_spec(id: &str) -> Option<&'static CliSpec> {
    CLI_SPECS.iter().find(|s| s.id == id)
}

/// 로그인 셸을 거쳐 사용자의 실제 PATH 를 얻는다. 프로세스 수명 동안 1회만 조회한다.
///
/// 실패하면 현재 프로세스의 PATH 로 물러선다(개발 모드에서는 그걸로 충분하다).
pub fn user_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let fallback = || std::env::var("PATH").unwrap_or_default();

        match std::process::Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() {
                    log::warn!("로그인 셸이 빈 PATH 를 반환했습니다. 현재 PATH 로 대체합니다.");
                    fallback()
                } else {
                    log::info!("로그인 셸에서 PATH 확보: {} 개 항목", s.split(':').count());
                    s
                }
            }
            Ok(out) => {
                log::warn!(
                    "로그인 셸 PATH 조회 실패(exit={:?}). 현재 PATH 로 대체합니다.",
                    out.status.code()
                );
                fallback()
            }
            Err(e) => {
                log::warn!("로그인 셸({shell}) 실행 실패: {e}. 현재 PATH 로 대체합니다.");
                fallback()
            }
        }
    })
}

/// PATH 를 뒤져 실행 파일을 찾는다. `which` 를 부르지 않고 직접 확인한다.
pub fn find_executable(bin: &str) -> Option<PathBuf> {
    for dir in user_path().split(':').filter(|d| !d.is_empty()) {
        let candidate = PathBuf::from(dir).join(bin);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_executable(p: &PathBuf) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn cli_spec_은_id_로_조회된다() {
        assert_eq!(cli_spec("claude").map(|s| s.bin), Some("claude"));
        assert!(cli_spec("존재하지-않는-cli").is_none());
    }

    /// id 가 겹치면 `resolve` 가 엉뚱한 어댑터를 고르게 된다.
    #[test]
    fn cli_specs_의_id_는_중복되지_않는다() {
        let ids: HashSet<_> = CLI_SPECS.iter().map(|s| s.id).collect();
        assert_eq!(ids.len(), CLI_SPECS.len());
    }

    /// 실제 출력 형식을 확인한 것은 claude 뿐이다. 나머지를 검증됨으로 올리려면
    /// 반드시 `--help` 로 확인한 뒤 이 테스트도 함께 고쳐야 한다.
    #[test]
    fn 검증된_cli_는_claude_뿐이다() {
        let verified: Vec<_> = CLI_SPECS.iter().filter(|s| s.verified).map(|s| s.id).collect();
        assert_eq!(verified, vec!["claude"]);
    }

    /// ClaudeStreamJson 형식을 쓰는 스펙은 반드시 stream-json 인자를 갖고 있어야 한다.
    #[test]
    fn stream_json_형식은_해당_인자를_갖는다() {
        for spec in CLI_SPECS.iter().filter(|s| s.format == OutputFormat::ClaudeStreamJson) {
            assert!(
                spec.args.contains(&"--output-format") && spec.args.contains(&"stream-json"),
                "{} 스펙에 stream-json 인자가 없다",
                spec.id
            );
        }
    }

    /// 로그인 셸에서 PATH 를 얻지 못하면 CLI 연동 전체가 무너진다.
    #[test]
    fn 사용자_path_를_확보한다() {
        let path = user_path();
        assert!(!path.is_empty(), "PATH 가 비어 있다");
        assert!(path.contains('/'), "PATH 형식이 아니다: {path}");
    }

    /// 셸에 반드시 있는 명령으로 탐지 로직 자체를 검증한다(특정 AI CLI 설치 여부와 무관).
    #[test]
    fn path_에서_실행파일을_찾는다() {
        assert!(find_executable("sh").is_some(), "sh 를 찾지 못했다");
        assert!(find_executable("존재할리없는명령어xyz").is_none());
    }
}
