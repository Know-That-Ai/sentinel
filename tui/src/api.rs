use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(Clone)]
pub struct Client {
    base: String,
    http: reqwest::blocking::Client,
}

impl Client {
    pub fn new(base: impl Into<String>) -> Self {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .expect("build http client");
        Self { base: base.into(), http }
    }

    pub fn health(&self) -> Result<Health> {
        self.get("/health")
    }

    pub fn config(&self) -> Result<Config> {
        self.get("/state/config")
    }

    pub fn sessions(&self) -> Result<Vec<Session>> {
        self.get("/state/sessions")
    }

    pub fn unreviewed(&self) -> Result<Vec<Event>> {
        self.get("/state/unreviewed")
    }

    pub fn webhook_log(&self) -> Result<Vec<WebhookLogEntry>> {
        self.get("/state/webhook-log?limit=200")
    }

    pub fn mark_reviewed(&self, id: &str) -> Result<()> {
        let url = format!("{}/state/mark-reviewed/{}", self.base, id);
        self.http.post(&url).send()?.error_for_status()?;
        Ok(())
    }

    pub fn dispatch(&self, id: &str) -> Result<()> {
        let url = format!("{}/state/dispatch/{}", self.base, id);
        self.http.post(&url).send()?.error_for_status()?;
        Ok(())
    }

    fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base, path);
        let res = self
            .http
            .get(&url)
            .send()
            .with_context(|| format!("GET {}", url))?
            .error_for_status()?;
        Ok(res.json::<T>()?)
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct Health {
    pub status: String,
    pub timestamp: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub github_org: String,
    #[serde(default)]
    pub github_username: String,
    #[serde(default)]
    pub user_label: String,
    pub preferred_agent: String,
    pub openclaw_url: String,
    #[serde(default)]
    pub openclaw_api_key: String,
    pub repo_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub scanner_bot_logins: Vec<String>,
    #[serde(default)]
    pub smee_url: String,
    #[serde(default)]
    pub port: u16,
    pub auto_dispatch_bugbot: bool,
    pub auto_dispatch_codeql: bool,
    #[serde(rename = "autoDispatchCI")]
    pub auto_dispatch_ci: bool,
    #[serde(default = "default_true")]
    pub auto_submit: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize, Clone, Debug)]
pub struct Session {
    pub id: String,
    pub repo: String,
    pub pr_number: i64,
    pub agent_type: String,
    pub terminal_pid: Option<i64>,
    pub tmux_pane: Option<String>,
    pub repo_path: String,
    pub linked_at: String,
    pub unlinked_at: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct WebhookLogEntry {
    pub id: String,
    pub received_at: String,
    pub event_type: String,
    pub action: Option<String>,
    pub repo: Option<String>,
    pub pr_number: Option<i64>,
    pub actor: Option<String>,
    pub disposition: String,
    pub reason: Option<String>,
    pub delivery_id: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Event {
    pub id: String,
    pub repo: String,
    pub pr_number: i64,
    pub pr_title: String,
    pub pr_url: String,
    pub pr_author: String,
    pub event_type: String,
    pub source: String,
    pub actor: String,
    pub body: Option<String>,
    pub github_url: String,
    pub received_at: String,
    #[serde(default)]
    pub reviewed: i64,
    #[serde(default)]
    pub dispatched_to: Option<String>,
}
