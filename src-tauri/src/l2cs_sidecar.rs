use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
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
    frame_base64: &'a str,
}

struct L2csSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl L2csSession {
    fn spawn(app: &AppHandle) -> Result<Self, String> {
        let script_path = resolve_sidecar_script_path(app)?;
        let weights_path = resolve_l2cs_weights_path(app);
        let python_bin = python_bin_name();

        let mut command = Command::new(&python_bin);
        command
            .arg(script_path)
            .arg("--device")
            .arg("cpu")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        if let Some(weights_path) = weights_path {
            command.arg("--weights").arg(weights_path);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to spawn L2CS worker with `{python_bin}`: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to acquire L2CS worker stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to acquire L2CS worker stdout".to_string())?;

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn is_alive(&mut self) -> bool {
        self.child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }

    fn estimate(&mut self, frame_base64: &str) -> Result<L2csEstimateResult, String> {
        let payload = serde_json::to_string(&WorkerRequest { frame_base64 })
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

        let response: WorkerResponse = serde_json::from_str(line.trim()).map_err(|error| {
            format!("failed to parse L2CS worker response: {error} (raw: {line})")
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

fn python_bin_name() -> String {
    std::env::var("FLOWORFLOP_PYTHON").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "python".to_string()
        } else {
            "python3".to_string()
        }
    })
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
