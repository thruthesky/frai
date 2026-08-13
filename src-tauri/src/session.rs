//! 세션 관리 — 그리드로 동시에 돌아가는 여러 대화를 서로 독립적으로 다룬다.
//!
//! 규칙:
//! - 한 세션의 실패가 다른 세션에 영향을 주지 않는다.
//! - 세션을 취소하면 자식 프로세스·연결이 확실히 정리된다
//!   (task abort → future drop → `kill_on_drop` 으로 프로세스 종료).
//! - 앱이 종료될 때 남은 세션을 전부 정리한다. 그리드로 여러 개를 돌리므로
//!   누수가 빠르게 쌓인다.

use crate::events::EventSink;
use crate::provider::{self, ChatRequest};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::async_runtime::{self, JoinHandle};
use tauri::AppHandle;

#[derive(Default)]
pub struct SessionManager {
    running: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl SessionManager {
    /// 세션을 시작한다. 같은 세션이 이미 돌고 있으면 먼저 취소한다.
    pub fn start(&self, app: AppHandle, req: ChatRequest) -> Result<(), String> {
        let session_id = req.session_id.clone();
        let provider_id = req.provider.clone();

        // 프로바이더를 먼저 해석한다. 잘못된 id 면 태스크를 띄우기 전에 실패시킨다.
        let provider = provider::resolve(&provider_id)?;

        self.cancel(&session_id);

        let sink = EventSink::new(app, session_id.clone());
        let sink_for_task = sink.clone();

        // ⚠️ `tokio::spawn` 을 쓰지 않는다 — 앱이 그 자리에서 죽는다.
        //
        // `send_message` 는 동기 `#[tauri::command]` 라 **호출 스레드(메인 스레드)에서
        // 그대로** 실행된다. 그런데 Tauri 의 전역 런타임(`async_runtime::default_runtime`)
        // 은 워커 스레드만 띄울 뿐 호출 스레드를 `enter()` 하지 않으므로, 메인 스레드의
        // thread-local 에는 런타임이 없다. `tokio::spawn` 은 그 thread-local 만 보기 때문에
        // "there is no reactor running" 으로 패닉하고 프로세스가 abort 된다.
        // (배포본만의 문제가 아니다. `tauri dev` 에서도 같은 경로면 똑같이 죽는다.)
        //
        // `async_runtime::spawn` 은 내부에서 `let _guard = r.enter()` 를 잡은 뒤 spawn 하므로
        // 어느 스레드에서 불러도 안전하다. 여기서 `tokio::spawn` 으로 되돌리지 말 것.
        let handle = async_runtime::spawn(async move {
            match provider.stream(req, sink_for_task.clone()).await {
                Ok(usage) => sink_for_task.done(usage),
                Err(e) => sink_for_task.error(e),
            }
        });

        self.running
            .lock()
            .unwrap()
            .insert(session_id, handle);
        Ok(())
    }

    /// 세션을 취소한다. 돌고 있지 않으면 아무 일도 하지 않는다.
    pub fn cancel(&self, session_id: &str) {
        if let Some(handle) = self.running.lock().unwrap().remove(session_id) {
            handle.abort();
            log::info!("세션 취소: {session_id}");
        }
    }

    /// 끝난 세션을 목록에서 치운다.
    pub fn reap_finished(&self) {
        // Tauri 의 `JoinHandle` 에는 `is_finished()` 가 없다. 내부 tokio 핸들을 꺼내 쓴다.
        self.running
            .lock()
            .unwrap()
            .retain(|_, h| !h.inner().is_finished());
    }

    pub fn cancel_all(&self) {
        let mut running = self.running.lock().unwrap();
        for (id, handle) in running.drain() {
            handle.abort();
            log::info!("앱 종료로 세션 취소: {id}");
        }
    }
}
