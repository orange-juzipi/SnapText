use snaptext_core::{
    Error, Result,
    config::{AppConfig, default_history_path},
    history::HistoryStore,
};
use snaptext_tauri::run_tauri;
#[cfg(debug_assertions)]
use std::{
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};

#[cfg(debug_assertions)]
const DEV_SERVER_ADDR: &str = "127.0.0.1:1420";

fn main() -> Result<()> {
    init_tracing();

    let _frontend = start_dev_frontend_if_needed()?;
    let config = AppConfig::load_or_default(None)?;
    let history = HistoryStore::open(default_history_path())?;

    run_tauri(config, history)?;

    Ok(())
}

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "snaptext=info".into()),
        )
        .try_init();
}

#[cfg(not(debug_assertions))]
fn start_dev_frontend_if_needed() -> Result<Option<()>> {
    Ok(None)
}

#[cfg(debug_assertions)]
fn start_dev_frontend_if_needed() -> Result<Option<DevFrontendGuard>> {
    if dev_server_is_ready() {
        return Ok(None);
    }

    let ui_dir = repository_ui_dir()?;
    tracing::info!(
        ui_dir = %ui_dir.display(),
        "Vite dev server is not running; starting React frontend for cargo run"
    );
    let child = Command::new("bun")
        .arg("run")
        .arg("dev")
        .current_dir(&ui_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| {
            Error::Config(format!(
                "failed to start React frontend with `bun run dev` in {}: {err}. \
                 Install bun or run `cd ui && bun run dev` before `cargo run -p snaptext-tauri`.",
                ui_dir.display()
            ))
        })?;
    let guard = DevFrontendGuard { child };
    wait_for_dev_server()?;
    Ok(Some(guard))
}

#[cfg(debug_assertions)]
fn repository_ui_dir() -> Result<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let Some(root) = manifest_dir.parent().and_then(|path| path.parent()) else {
        return Err(Error::Config(format!(
            "cannot resolve repository root from {}",
            manifest_dir.display()
        )));
    };
    let ui_dir = root.join("ui");
    if ui_dir.is_dir() {
        Ok(ui_dir)
    } else {
        Err(Error::Config(format!(
            "React frontend directory is missing: {}",
            ui_dir.display()
        )))
    }
}

#[cfg(debug_assertions)]
fn wait_for_dev_server() -> Result<()> {
    for _ in 0..80 {
        if dev_server_is_ready() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(125));
    }
    Err(Error::Config(format!(
        "React frontend dev server did not become ready at http://{DEV_SERVER_ADDR}"
    )))
}

#[cfg(debug_assertions)]
fn dev_server_is_ready() -> bool {
    let Ok(addr) = DEV_SERVER_ADDR.parse::<SocketAddr>() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok()
}

#[cfg(debug_assertions)]
struct DevFrontendGuard {
    child: Child,
}

#[cfg(debug_assertions)]
impl Drop for DevFrontendGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
