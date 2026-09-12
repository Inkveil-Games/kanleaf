#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Kanleaf desktop application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn desktop_policy_allows_configured_http_and_websocket_servers() {
        let config = include_str!("../tauri.conf.json");
        assert!(config.contains("connect-src http: https: ws: wss:;"));
    }
}
