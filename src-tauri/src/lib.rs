mod auth;
mod commands;
mod events;
mod provider;
mod session;

#[cfg(test)]
mod integration_tests;

use session::SessionManager;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Emitter, Manager, RunEvent};

/// 메뉴에서 화면 전환을 요청할 때 프론트로 보내는 이벤트.
const SET_VIEW_EVENT: &str = "set-view";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::send_message,
            commands::cancel_session,
            commands::auth_status,
            commands::auth_sign_in,
            commands::auth_sign_out,
            commands::diagnostics,
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            "view-grid" => {
                let _ = app.emit(SET_VIEW_EVENT, "grid");
            }
            "view-board" => {
                let _ = app.emit(SET_VIEW_EVENT, "board");
            }
            _ => {}
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 로그인 셸 PATH 를 미리 확보해 둔다. 첫 요청에서 셸을 띄우면
            // 그만큼 응답이 늦어지고, 실패했을 때 원인이 로그에 먼저 남는 편이 낫다.
            let path = provider::detect::user_path();
            log::info!("사용자 PATH 확보 완료 ({} 항목)", path.split(':').count());

            // macOS 기본 메뉴(종료·편집 등)를 유지한 채 "보기" 메뉴를 덧붙인다.
            let handle = app.handle();
            let menu = Menu::default(handle)?;
            let grid = MenuItem::with_id(handle, "view-grid", "바둑판", true, Some("CmdOrCtrl+1"))?;
            let board =
                MenuItem::with_id(handle, "view-board", "세션 목록", true, Some("CmdOrCtrl+2"))?;
            let view = Submenu::with_items(handle, "보기", true, &[&grid, &board])?;
            menu.append(&view)?;
            app.set_menu(menu)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // 앱이 종료될 때 돌고 있는 자식 프로세스를 전부 정리한다.
            if let RunEvent::Exit = event {
                app.state::<SessionManager>().cancel_all();
            }
        });
}
