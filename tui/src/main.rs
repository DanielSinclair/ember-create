use exact_plan::Value;
use exact_runner::{Answer, DataError, DataSource, Native, Store};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
mod attachment;

#[allow(dead_code, unused_imports)]
mod shapes {
    include!(concat!(env!("OUT_DIR"), "/shapes.rs"));
}
use shapes::ContractValue;

#[derive(Default)]
struct State {
    busy: bool,
    status: String,
    entries: Vec<(String, String)>,
    tone: String,
    attachment: String,
    picker: bool,
    projects: Vec<(String, String, bool)>,
}

struct Bridge {
    state: Arc<Mutex<State>>,
    native: Native,
}

fn clean(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect()
}

impl Bridge {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                status: "Ready".into(),
                tone: "ready".into(),
                ..State::default()
            })),
            native: Native::default(),
        }
    }

    fn start(&self, args: Vec<String>) -> bool {
        {
            let mut state = self.state.lock().unwrap();
            if state.busy {
                return false;
            }
            state.busy = true;
            state.status = "Starting".into();
            state.tone = "working".into();
        }
        self.native.changed("session");
        let state = self.state.clone();
        let native = self.native.clone();
        std::thread::spawn(move || {
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap();
            let result = (|| -> Result<bool, String> {
                let mut child = Command::new(std::env::var("BUN").unwrap_or_else(|_| "bun".into()))
                    .arg(root.join("src/cli.ts"))
                    .args(args)
                    .current_dir(root)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .map_err(|e| e.to_string())?;
                let errors = child.stderr.take().unwrap();
                let error_state = state.clone();
                let error_native = native.clone();
                let reader =
                    std::thread::spawn(move || read_lines(errors, &error_state, &error_native));
                read_lines(child.stdout.take().unwrap(), &state, &native);
                let success = child.wait().map_err(|e| e.to_string())?.success();
                let _ = reader.join();
                Ok(success)
            })();
            let mut s = state.lock().unwrap();
            s.busy = false;
            s.tone = if matches!(&result, Ok(true)) {
                "success"
            } else {
                "error"
            }
            .into();
            s.status = match result {
                Ok(true) => "Done".into(),
                Ok(false) => "Failed — see output".into(),
                Err(e) => format!("Failed: {e}"),
            };
            drop(s);
            native.changed("session");
        });
        true
    }

    fn note(&self, message: &str) {
        let mut s = self.state.lock().unwrap();
        s.entries.push((
            clean(message),
            if message.starts_with('>') {
                "prompt"
            } else {
                "muted"
            }
            .into(),
        ));
        drop(s);
        self.native.changed("session");
    }

    fn attach(&self, input: &str) -> bool {
        let Some(path) = attachment::image_path(input) else {
            return false;
        };
        let path = path.to_string_lossy().into_owned();
        let mut state = self.state.lock().unwrap();
        if state.attachment == path {
            return true;
        }
        state.attachment = path.clone();
        drop(state);
        self.note(&format!(
            "Image attached · {path}\nDescribe what Muse Ember should build from it."
        ));
        true
    }

    fn builds(&self) -> bool {
        self.state.lock().unwrap().picker = true;
        self.start(vec!["list".into(), "--json".into()])
    }

    fn install(&self, id: &str) -> bool {
        if self.state.lock().unwrap().busy {
            return false;
        }
        self.state.lock().unwrap().picker = false;
        self.note(&format!("> Install and open {id}"));
        self.start(vec!["install".into(), id.into(), "--json".into()])
    }

    fn submit(&self, text: &str) -> bool {
        if self.attach(text) {
            return true;
        }
        if self.state.lock().unwrap().busy {
            return false;
        }
        let text = text.trim();
        if text.is_empty() {
            return false;
        }
        self.note(&format!("> {text}"));
        let (command, rest) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
        let rest = rest.trim();
        match command {
            "/apps" | "/builds" => return self.builds(),
            "/open" if !rest.is_empty() => return self.install(rest),
            "/simulator" => return self.start(vec!["ios".into(), "--json".into()]),
            "/image" => {
                if rest.is_empty() {
                    self.note("Attach: /image /path/to/image.png · Remove: /image clear");
                    return true;
                }
                if rest == "clear" {
                    self.state.lock().unwrap().attachment.clear();
                    self.note("Image removed.");
                } else if !self.attach(rest) {
                    self.note("Choose a readable PNG, JPEG, or WebP image.");
                }
                return true;
            }
            "/new" if rest.is_empty() => {
                self.note("Describe your next app. Each plain prompt creates a new project.");
                return true;
            }
            "/help" => {
                self.note("Prompt: create an app with Muse Ember\nCtrl+B or /builds: choose a build to install\n/open ID: install and open a build\n/edit prompt: revise the selected app\nDrop an image or use /image path to attach it\n/image clear: remove it\nCtrl+O or /simulator: launch iOS");
                return true;
            }
            _ => {}
        }
        if command.starts_with('/') && !["/new", "/edit"].contains(&command) {
            self.note("Unknown command. Type /help for commands.");
            return true;
        }
        let prompt = if command == "/edit" || command == "/new" {
            rest
        } else {
            text
        };
        if prompt.is_empty() {
            self.note("Add a description after the command.");
            return true;
        }
        let mut args = vec![
            "generate".into(),
            prompt.into(),
            "--provider".into(),
            "openrouter".into(),
            "--json".into(),
        ];
        if command == "/edit" {
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap();
            let data = std::env::var_os("EXACT_CREATE_HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| root.join(".exact-create"));
            let selected = std::fs::read(data.join("selection.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .and_then(|v| v["id"].as_str().map(str::to_owned));
            let Some(id) = selected else {
                self.note("Open an app first with /apps and /open ID.");
                return true;
            };
            args.extend(["--id".into(), id]);
        }
        let image = self.state.lock().unwrap().attachment.clone();
        if !image.is_empty() {
            args.extend(["--image".into(), image]);
        }
        self.start(args)
    }
}

fn event_status<'a>(kind: &str, message: &'a str) -> (Option<&'a str>, &'static str) {
    match kind {
        "error" => (Some("Failed — see output"), "error"),
        "diagnostics" => (Some("Checking issues"), "warning"),
        "result" | "selected" => (Some("Finishing"), "success"),
        "status" if message.contains("naming") => (Some("Thinking · naming your app"), "thinking"),
        "status" if message.starts_with("Generating") => {
            (Some("Thinking · writing your contract"), "thinking")
        }
        "status" if message.starts_with("Repairing") => {
            (Some("Thinking · repairing your contract"), "warning")
        }
        "status" if message.starts_with("Checking") => {
            (Some("Validating Contract and TypeScript"), "working")
        }
        "status" if message.starts_with("Validating") => (Some("Staging app update"), "working"),
        "status" if message.starts_with("Building") => {
            (Some("Building and launching iOS"), "working")
        }
        "status" => (Some(message), "working"),
        "metadata" => (Some("Preparing generation"), "prompt"),
        "usage" => (None, "muted"),
        _ => (None, "muted"),
    }
}

fn read_lines<R: std::io::Read>(reader: R, state: &Arc<Mutex<State>>, native: &Native) {
    for line in BufReader::new(reader).lines().map_while(Result::ok) {
        let mut s = state.lock().unwrap();
        let event = serde_json::from_str::<serde_json::Value>(&line).ok();
        if let Some(event) = &event {
            let message = event["message"].as_str().unwrap_or("");
            let (label, tone) = event_status(event["type"].as_str().unwrap_or(""), message);
            if let Some(label) = label {
                s.status = label.into();
                s.tone = tone.into();
            }
        }
        let shown = if let Some(projects) = event
            .as_ref()
            .and_then(|v| v.get("projects"))
            .and_then(|v| v.as_array())
        {
            s.projects = projects
                .iter()
                .filter_map(|p| {
                    Some((
                        p["id"].as_str()?.to_string(),
                        p["name"].as_str()?.to_string(),
                        p["demo"].as_bool().unwrap_or(false),
                    ))
                })
                .collect();
            if projects.is_empty() {
                "No projects yet.".to_string()
            } else {
                projects
                    .iter()
                    .map(|p| {
                        format!(
                            "{}  {}{}",
                            p["id"].as_str().unwrap_or(""),
                            p["name"].as_str().unwrap_or(""),
                            if p["demo"].as_bool().unwrap_or(false) {
                                " [Demo]"
                            } else {
                                ""
                            }
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        } else {
            event
                .as_ref()
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or(&line)
                .to_string()
        };
        let tone = event
            .as_ref()
            .map(|e| {
                event_status(
                    e["type"].as_str().unwrap_or(""),
                    e["message"].as_str().unwrap_or(""),
                )
                .1
            })
            .unwrap_or("muted");
        s.entries.push((clean(&shown), tone.into()));
        if let Some(ms) = event
            .as_ref()
            .and_then(|e| e["elapsedMs"].as_f64())
            .filter(|ms| ms.is_finite() && *ms >= 0.0)
        {
            s.entries.push((
                format!("Generation time: {:.1}s", ms / 1000.0),
                "muted".into(),
            ));
        }
        if let Some(cost) = event
            .as_ref()
            .and_then(|e| e["totalCostUsd"].as_f64())
            .filter(|cost| cost.is_finite() && *cost >= 0.0)
        {
            s.entries.push((
                format!("OpenRouter cost: ${cost:.6} USD (including naming and repairs)"),
                "cost".into(),
            ));
        }
        while s.entries.len() > 1
            && s.entries.iter().map(|(text, _)| text.len()).sum::<usize>() > 16000
        {
            s.entries.remove(0);
        }
        drop(s);
        native.changed("session");
    }
}

impl DataSource for Bridge {
    fn query(&mut self, source: &str, args: &[Value]) -> Result<Value, DataError> {
        if source == "session" {
            let s = self.state.lock().unwrap();
            return Ok(shapes::Session {
                busy: s.busy,
                status: s.status.clone(),
                entries: s
                    .entries
                    .iter()
                    .map(|(text, tone)| shapes::LogEntry {
                        text: text.clone(),
                        tone: tone.clone(),
                    })
                    .collect(),
                tone: s.tone.clone(),
                attachment: s.attachment.clone(),
                picker: s.picker,
                projects: s
                    .projects
                    .iter()
                    .map(|(id, name, demo)| shapes::ProjectChoice {
                        id: id.clone(),
                        name: name.clone(),
                        demo: *demo,
                    })
                    .collect(),
            }
            .to_value());
        }
        let text = |i: usize| {
            args.get(i)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        if source == "inspectInput" {
            let input = text(0);
            return Ok(shapes::Inspection {
                attached: self.attach(&input),
                input,
            }
            .to_value());
        }
        let ok = match source {
            "submit" => self.submit(&text(0)),
            "showBuilds" => self.builds(),
            "installProject" => self.install(&text(0)),
            "clearAttachment" => {
                self.state.lock().unwrap().attachment.clear();
                self.native.changed("session");
                true
            }
            "closePicker" => {
                self.state.lock().unwrap().picker = false;
                self.native.changed("session");
                true
            }
            "launchSimulator" => {
                self.note("> Launch iOS simulator");
                self.start(vec!["ios".into(), "--json".into()])
            }
            _ => return Err(DataError::UnknownSource(source.into())),
        };
        Ok(shapes::Ack { ok }.to_value())
    }
    fn answer(
        &mut self,
        store: &mut Store,
        source: &str,
        args: &[Value],
    ) -> Result<Answer, DataError> {
        if source == "session" {
            store.observe_topic("session");
        }
        self.query(source, args).map(Answer::Now)
    }
    fn native(&self) -> Option<Native> {
        Some(self.native.clone())
    }
}

fn main() -> std::process::ExitCode {
    exact_terminal::cli::run_embedded(
        std::env::args().skip(1).collect(),
        Bridge::new(),
        include_bytes!(concat!(env!("OUT_DIR"), "/terminal.plan")),
        exact_terminal::host::Mode::Fullscreen,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_and_cost_survive_usage_events_and_failures() {
        let bridge = Bridge::new();
        let events = concat!(
            "{\"type\":\"status\",\"message\":\"Generating demo with Muse Ember (1/3)\"}\n",
            "{\"type\":\"usage\",\"message\":\"Muse Ember generation complete\"}\n"
        );
        read_lines(events.as_bytes(), &bridge.state, &bridge.native);
        assert_eq!(
            bridge.state.lock().unwrap().status,
            "Thinking · writing your contract"
        );
        let error =
            "{\"type\":\"error\",\"message\":\"Validation failed\",\"totalCostUsd\":0.0037359,\"elapsedMs\":11967}\n";
        read_lines(error.as_bytes(), &bridge.state, &bridge.native);
        let state = bridge.state.lock().unwrap();
        assert_eq!(state.tone, "error");
        assert!(state
            .entries
            .iter()
            .any(|(text, _)| text == "Generation time: 12.0s"));
        assert_eq!(
            state.entries.last().unwrap().0,
            "OpenRouter cost: $0.003736 USD (including naming and repairs)"
        );
        assert_eq!(
            event_status("status", "Repairing demo (2/3)"),
            (Some("Thinking · repairing your contract"), "warning")
        );
        assert_eq!(
            event_status("status", "Checking the generated Contract and TypeScript").1,
            "working"
        );
    }
}
