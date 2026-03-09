use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct L2csEstimateResult {
    pub has_face: bool,
    pub yaw_deg: Option<f32>,
    pub pitch_deg: Option<f32>,
    pub confidence: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    ok: bool,
    has_face: Option<bool>,
    yaw_deg: Option<f32>,
    pitch_deg: Option<f32>,
    confidence: Option<f32>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest<'a> {
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_base64: Option<&'a str>,
}

enum WorkerLaunch {
    Executable { program: PathBuf },
    PythonScript { python_bin: PathBuf, script_path: PathBuf },
}

impl WorkerLaunch {
    fn to_command(&self, app: &AppHandle) -> Command {
        let mut command = match self {
            WorkerLaunch::Executable { program } => Command::new(program),
            WorkerLaunch::PythonScript {
                python_bin,
                script_path,
            } => {
                let mut command = Command::new(python_bin);
                command.arg(script_path);
                command
            }
        };

        command
            .arg("--device")
            .arg("cpu")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        if let Some(weights_path) = resolve_l2cs_weights_path(app) {
            command.arg("--weights").arg(weights_path);
        }

        command
    }

    fn display_name(&self) -> String {
        match self {
            WorkerLaunch::Executable { program } => program.display().to_string(),
            WorkerLaunch::PythonScript {
                python_bin,
                script_path,
            } => format!("{} {}", python_bin.display(), script_path.display()),
        }
    }
}

struct L2csSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl L2csSession {
    fn spawn(app: &AppHandle) -> Result<Self, String> {
        let launch = resolve_worker_launch(app)?;
        let mut child = launch.to_command(app).spawn().map_err(|error| {
            format!(
                "failed to spawn L2CS worker with `{}`: {error}",
                launch.display_name()
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to acquire L2CS worker stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to acquire L2CS worker stdout".to_string())?;

        let mut session = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };

        if let Err(error) = session.ping() {
            session.shutdown();
            return Err(format!("L2CS startup health check failed: {error}"));
        }

        Ok(session)
    }

    fn is_alive(&mut self) -> bool {
        self.child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }

    fn ping(&mut self) -> Result<(), String> {
        let response = self.send_request(&WorkerRequest {
            kind: "ping",
            frame_base64: None,
        })?;

        if !response.ok {
            return Err(response
                .error
                .unwrap_or_else(|| "L2CS worker health check failed".to_string()));
        }

        Ok(())
    }

    fn estimate(&mut self, frame_base64: &str) -> Result<L2csEstimateResult, String> {
        let response = self.send_request(&WorkerRequest {
            kind: "estimate",
            frame_base64: Some(frame_base64),
        })?;

        if !response.ok {
            return Err(response
                .error
                .unwrap_or_else(|| "L2CS worker returned unknown error".to_string()));
        }

        Ok(L2csEstimateResult {
            has_face: response.has_face.unwrap_or(false),
            yaw_deg: response.yaw_deg,
            pitch_deg: response.pitch_deg,
            confidence: response.confidence,
        })
    }

    fn send_request(&mut self, request: &WorkerRequest<'_>) -> Result<WorkerResponse, String> {
        let payload = serde_json::to_string(request)
            .map_err(|error| format!("failed to serialize L2CS request: {error}"))?;

        writeln!(self.stdin, "{payload}")
            .map_err(|error| format!("failed to write L2CS worker stdin: {error}"))?;
        self.stdin
            .flush()
            .map_err(|error| format!("failed to flush L2CS worker stdin: {error}"))?;

        let mut line = String::new();
        let bytes_read = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("failed to read L2CS worker stdout: {error}"))?;

        if bytes_read == 0 {
            return Err("L2CS worker exited unexpectedly".to_string());
        }

        serde_json::from_str(line.trim()).map_err(|error| {
            format!("failed to parse L2CS worker response: {error} (raw: {line})")
        })
    }

    fn shutdown(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct L2csSessionManager {
    session: Option<L2csSession>,
}

impl L2csSessionManager {
    fn init(&mut self, app: &AppHandle) -> Result<(), String> {
        if self
            .session
            .as_mut()
            .map(|session| session.is_alive())
            .unwrap_or(false)
        {
            return self
                .session
                .as_mut()
                .ok_or_else(|| "L2CS session was not initialized".to_string())?
                .ping();
        }

        self.reset();
        self.session = Some(L2csSession::spawn(app)?);
        Ok(())
    }

    fn estimate(
        &mut self,
        app: &AppHandle,
        frame_base64: &str,
    ) -> Result<L2csEstimateResult, String> {
        if self
            .session
            .as_mut()
            .map(|session| session.is_alive())
            .unwrap_or(false)
            == false
        {
            self.session = Some(L2csSession::spawn(app)?);
        }

        let first_attempt = self
            .session
            .as_mut()
            .ok_or_else(|| "L2CS session was not initialized".to_string())?
            .estimate(frame_base64);

        match first_attempt {
            Ok(result) => Ok(result),
            Err(first_error) => {
                self.reset();
                self.session = Some(L2csSession::spawn(app)?);
                self.session
                    .as_mut()
                    .ok_or_else(|| "L2CS session restart failed".to_string())?
                    .estimate(frame_base64)
                    .map_err(|error| format!("{first_error}; retry failed: {error}"))
            }
        }
    }

    fn reset(&mut self) {
        if let Some(session) = self.session.take() {
            session.shutdown();
        }
    }
}

#[derive(Default)]
pub struct L2csSidecarState {
    manager: Mutex<L2csSessionManager>,
}

impl L2csSidecarState {
    pub fn init(&self, app: &AppHandle) -> Result<(), String> {
        let mut manager = self
            .manager
            .lock()
            .map_err(|_| "failed to lock L2CS sidecar manager".to_string())?;
        manager.init(app)
    }

    pub fn estimate(
        &self,
        app: &AppHandle,
        frame_base64: &str,
    ) -> Result<L2csEstimateResult, String> {
        let mut manager = self
            .manager
            .lock()
            .map_err(|_| "failed to lock L2CS sidecar manager".to_string())?;

        manager.estimate(app, frame_base64)
    }

    pub fn reset(&self) -> Result<(), String> {
        let mut manager = self
            .manager
            .lock()
            .map_err(|_| "failed to lock L2CS sidecar manager".to_string())?;
        manager.reset();
        Ok(())
    }
}

fn resolve_worker_launch(app: &AppHandle) -> Result<WorkerLaunch, String> {
    if let Ok(path) = std::env::var("FLOWORFLOP_L2CS_SIDECAR") {
        let parsed = PathBuf::from(path);
        if parsed.exists() {
            return Ok(WorkerLaunch::Executable { program: parsed });
        }
    }

    if let Some(binary_name) = bundled_sidecar_binary_name() {
        let dev_binary_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(binary_name);
        if dev_binary_path.exists() {
            return Ok(WorkerLaunch::Executable {
                program: dev_binary_path,
            });
        }

        let resource_binary_path = app
            .path()
            .resolve(format!("binaries/{binary_name}"), BaseDirectory::Resource)
            .map_err(|error| format!("failed to resolve sidecar resource path: {error}"))?;
        if resource_binary_path.exists() {
            return Ok(WorkerLaunch::Executable {
                program: resource_binary_path,
            });
        }
    }

    if cfg!(debug_assertions) {
        let script_path = resolve_sidecar_script_path(app)?;
        let python_bin = resolve_dev_python_bin_path(app).ok_or_else(|| {
            "no bundled L2CS sidecar executable was found and no local Python dev environment is available"
                .to_string()
        })?;
        return Ok(WorkerLaunch::PythonScript {
            python_bin,
            script_path,
        });
    }

    Err("bundled L2CS sidecar executable not found for this platform".to_string())
}

fn bundled_sidecar_binary_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("floworflop-l2cs-sidecar-aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("floworflop-l2cs-sidecar-x86_64-apple-darwin"),
        ("windows", "x86_64") => Some("floworflop-l2cs-sidecar-x86_64-pc-windows-msvc.exe"),
        _ => None,
    }
}

fn resolve_dev_python_bin_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FLOWORFLOP_PYTHON") {
        let parsed = PathBuf::from(path);
        if parsed.exists() {
            return Some(parsed);
        }
    }

    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    for candidate in python_venv_candidates(&dev_root) {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in python_venv_candidates(&resource_dir) {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

fn python_venv_candidates(root: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "windows") {
        vec![
            root.join(".venv-l2cs").join("Scripts").join("python.exe"),
            root.join(".venv").join("Scripts").join("python.exe"),
        ]
    } else {
        vec![
            root.join(".venv-l2cs").join("bin").join("python3"),
            root.join(".venv-l2cs").join("bin").join("python"),
            root.join(".venv").join("bin").join("python3"),
            root.join(".venv").join("bin").join("python"),
        ]
    }
}

fn resolve_sidecar_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecars/l2cs_worker.py");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    let resource_path = app
        .path()
        .resolve("sidecars/l2cs_worker.py", BaseDirectory::Resource)
        .map_err(|error| format!("failed to resolve sidecar resource path: {error}"))?;

    if resource_path.exists() {
        return Ok(resource_path);
    }

    Err("L2CS sidecar script not found (`src-tauri/sidecars/l2cs_worker.py`)".to_string())
}

fn resolve_l2cs_weights_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FLOWORFLOP_L2CS_WEIGHTS") {
        let parsed = PathBuf::from(path);
        if parsed.exists() {
            return Some(parsed);
        }
    }

    let dev_default = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/L2CSNet_gaze360.pkl");
    if dev_default.exists() {
        return Some(dev_default);
    }

    let resource_default = app
        .path()
        .resolve("models/L2CSNet_gaze360.pkl", BaseDirectory::Resource)
        .ok()?;
    if resource_default.exists() {
        return Some(resource_default);
    }

    None
}
