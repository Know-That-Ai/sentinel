use crate::api::{Client, Config, Event, Health, Session, WebhookLogEntry};
use crate::theme::Theme;
use anyhow::Result;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Tab {
    Dashboard,
    Sessions,
    Events,
    Audit,
    Config,
}

impl Tab {
    pub const ALL: [Tab; 5] = [
        Tab::Dashboard,
        Tab::Sessions,
        Tab::Events,
        Tab::Audit,
        Tab::Config,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Sessions => "Sessions",
            Tab::Events => "Events",
            Tab::Audit => "Audit",
            Tab::Config => "Config",
        }
    }

    pub fn index(self) -> usize {
        Tab::ALL.iter().position(|&t| t == self).unwrap_or(0)
    }

    pub fn next(self) -> Tab {
        Tab::ALL[(self.index() + 1) % Tab::ALL.len()]
    }

    pub fn prev(self) -> Tab {
        Tab::ALL[(self.index() + Tab::ALL.len() - 1) % Tab::ALL.len()]
    }
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub health: Option<Health>,
    pub config: Option<Config>,
    pub sessions: Vec<Session>,
    pub events: Vec<Event>,
    pub webhook_log: Vec<WebhookLogEntry>,
    pub fetched_at: Instant,
    pub error: Option<String>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            health: None,
            config: None,
            sessions: Vec::new(),
            events: Vec::new(),
            webhook_log: Vec::new(),
            fetched_at: Instant::now(),
            error: None,
        }
    }
}

pub enum Msg {
    Snapshot(Snapshot),
    Flash(String),
}

pub struct App {
    pub tab: Tab,
    pub theme: Theme,
    pub snap: Snapshot,
    pub sessions_cursor: usize,
    pub events_cursor: usize,
    pub audit_cursor: usize,
    pub audit_show_all: bool,
    /// Current filter query (case-insensitive substring match). Applies to
    /// whichever list tab the user is on. Empty string = no filter.
    pub filter_query: String,
    /// True while the user is typing into the filter bar.
    pub filter_mode: bool,
    /// True while the help overlay is visible.
    pub help_visible: bool,
    /// Counts the user has "seen" for each tab — used to compute the
    /// delta badge on tabs they aren't currently looking at.
    pub seen_events_count: usize,
    pub seen_audit_count: usize,
    pub flash: Option<(String, Instant)>,
    pub quitting: bool,
    pub started_at: Instant,
    pub client: Client,
    pub tx: Sender<Msg>,
    pub rx: Receiver<Msg>,
    pub refresh_tx: Sender<()>,
}

impl App {
    pub fn new(base: String) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        let (refresh_tx, refresh_rx) = mpsc::channel::<()>();
        spawn_poller(Client::new(base.clone()), tx.clone(), refresh_rx);
        Self {
            tab: Tab::Dashboard,
            theme: Theme::from_env(),
            snap: Snapshot::default(),
            sessions_cursor: 0,
            events_cursor: 0,
            audit_cursor: 0,
            audit_show_all: false,
            filter_query: String::new(),
            filter_mode: false,
            help_visible: false,
            seen_events_count: 0,
            seen_audit_count: 0,
            flash: None,
            quitting: false,
            started_at: Instant::now(),
            client: Client::new(base),
            tx,
            rx,
            refresh_tx,
        }
    }

    pub fn drain_msgs(&mut self) {
        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                Msg::Snapshot(s) => self.snap = s,
                Msg::Flash(f) => self.flash = Some((f, Instant::now())),
            }
        }
        if let Some((_, t)) = &self.flash {
            if t.elapsed() > Duration::from_secs(3) {
                self.flash = None;
            }
        }
    }

    pub fn request_refresh(&self) {
        let _ = self.refresh_tx.send(());
    }

    pub fn flash(&mut self, text: impl Into<String>) {
        self.flash = Some((text.into(), Instant::now()));
    }

    pub fn selected_event(&self) -> Option<&Event> {
        self.filtered_events().into_iter().nth(self.events_cursor)
    }

    pub fn selected_session(&self) -> Option<&Session> {
        self.filtered_sessions().into_iter().nth(self.sessions_cursor)
    }

    pub fn filtered_sessions(&self) -> Vec<&Session> {
        let q = self.filter_query.trim().to_lowercase();
        self.snap
            .sessions
            .iter()
            .filter(|s| {
                if q.is_empty() {
                    return true;
                }
                s.repo.to_lowercase().contains(&q)
                    || s.agent_type.to_lowercase().contains(&q)
                    || s.repo_path.to_lowercase().contains(&q)
                    || s.pr_number.to_string().contains(&q)
            })
            .collect()
    }

    pub fn filtered_events(&self) -> Vec<&Event> {
        let q = self.filter_query.trim().to_lowercase();
        self.snap
            .events
            .iter()
            .filter(|e| {
                if q.is_empty() {
                    return true;
                }
                e.repo.to_lowercase().contains(&q)
                    || e.actor.to_lowercase().contains(&q)
                    || e.source.to_lowercase().contains(&q)
                    || e.pr_title.to_lowercase().contains(&q)
                    || e.pr_number.to_string().contains(&q)
                    || e.body
                        .as_deref()
                        .map(|b| b.to_lowercase().contains(&q))
                        .unwrap_or(false)
            })
            .collect()
    }

    /// Audit entries after applying both the noise filter AND the query.
    /// When `audit_show_all` is false, hide entries that are usually noise.
    pub fn audit_entries(&self) -> Vec<&WebhookLogEntry> {
        let q = self.filter_query.trim().to_lowercase();
        self.snap
            .webhook_log
            .iter()
            .filter(|e| self.audit_show_all || is_interesting(e))
            .filter(|e| q.is_empty() || matches_audit_query(e, &q))
            .collect()
    }

    pub fn selected_audit_entry(&self) -> Option<&WebhookLogEntry> {
        self.audit_entries().into_iter().nth(self.audit_cursor)
    }

    /// Badge count for a tab — number of "new" items since the user last
    /// viewed that tab. Only Events and Audit surface badges.
    pub fn badge_for(&self, tab: Tab) -> Option<usize> {
        if tab == self.tab {
            return None;
        }
        let (current, seen) = match tab {
            Tab::Events => (self.snap.events.len(), self.seen_events_count),
            Tab::Audit => (self.snap.webhook_log.len(), self.seen_audit_count),
            _ => return None,
        };
        let delta = current.saturating_sub(seen);
        if delta == 0 {
            None
        } else {
            Some(delta)
        }
    }

    /// Snapshot current counts as "seen" so the badge clears.
    pub fn mark_tab_seen(&mut self, tab: Tab) {
        match tab {
            Tab::Events => self.seen_events_count = self.snap.events.len(),
            Tab::Audit => self.seen_audit_count = self.snap.webhook_log.len(),
            _ => {}
        }
    }

    pub fn switch_tab(&mut self, tab: Tab) {
        self.tab = tab;
        self.mark_tab_seen(tab);
        self.sessions_cursor = 0;
        self.events_cursor = 0;
        self.audit_cursor = 0;
    }

    pub fn mark_reviewed_selected(&mut self) -> Result<()> {
        if let Some(ev) = self.selected_event().cloned() {
            self.client.mark_reviewed(&ev.id)?;
            self.flash(format!("marked reviewed: {} #{}", ev.repo, ev.pr_number));
            self.request_refresh();
        }
        Ok(())
    }

    pub fn dispatch_selected(&mut self) -> Result<()> {
        if let Some(ev) = self.selected_event().cloned() {
            let result = self.client.dispatch(&ev.id)?;
            let msg = if result.delivered {
                format!(
                    "injected via {}: {} #{}",
                    result.via.as_deref().unwrap_or("unknown"),
                    ev.repo,
                    ev.pr_number
                )
            } else {
                format!(
                    "wrote inbox file only ({}) — open the terminal and Claude can read it",
                    result.reason.as_deref().unwrap_or("no_terminal")
                )
            };
            self.flash(msg);
            self.request_refresh();
        }
        Ok(())
    }

    pub fn focus_selected_session(&mut self) -> Result<()> {
        if let Some(s) = self.selected_session().cloned() {
            let result = self.client.focus_session(&s.id)?;
            if result.ok {
                self.flash(format!("focused {} #{}", s.repo, s.pr_number));
            } else {
                let hint = match result.reason.as_deref() {
                    Some("daemon_needs_restart") => "daemon needs restart (sentinel restart)",
                    Some("no_tty_resolved") => "no tty recorded — try re-linking",
                    Some("no_matching_terminal_window") => {
                        "terminal tab closed — stored tty no longer matches any window"
                    }
                    Some(other) => other,
                    None => "unknown",
                };
                self.flash(format!("could not focus: {hint}"));
            }
        }
        Ok(())
    }

    pub fn unlink_selected_session(&mut self) -> Result<()> {
        if let Some(s) = self.selected_session().cloned() {
            self.client.unlink_session(&s.id)?;
            self.flash(format!("dismissed {} #{}", s.repo, s.pr_number));
            // Keep cursor in bounds after the row disappears on next refresh.
            if self.sessions_cursor > 0 {
                self.sessions_cursor -= 1;
            }
            self.request_refresh();
        }
        Ok(())
    }

    pub fn move_cursor(&mut self, delta: isize) {
        // Resolve filtered length before taking a mutable borrow of the cursor.
        let len = match self.tab {
            Tab::Sessions => self.filtered_sessions().len(),
            Tab::Events => self.filtered_events().len(),
            Tab::Audit => self.audit_entries().len(),
            _ => return,
        };
        let cursor = match self.tab {
            Tab::Sessions => &mut self.sessions_cursor,
            Tab::Events => &mut self.events_cursor,
            Tab::Audit => &mut self.audit_cursor,
            _ => return,
        };
        if len == 0 {
            *cursor = 0;
            return;
        }
        let new = (*cursor as isize + delta).rem_euclid(len as isize);
        *cursor = new as usize;
    }

    /// Enter the filter input mode. Safe to call while already in filter mode.
    pub fn filter_begin(&mut self) {
        self.filter_mode = true;
    }

    /// Exit filter input mode without clearing the query.
    pub fn filter_commit(&mut self) {
        self.filter_mode = false;
    }

    /// Clear the query AND exit input mode.
    pub fn filter_cancel(&mut self) {
        self.filter_query.clear();
        self.filter_mode = false;
        self.sessions_cursor = 0;
        self.events_cursor = 0;
        self.audit_cursor = 0;
    }

    pub fn filter_push(&mut self, c: char) {
        self.filter_query.push(c);
        self.sessions_cursor = 0;
        self.events_cursor = 0;
        self.audit_cursor = 0;
    }

    pub fn filter_pop(&mut self) {
        self.filter_query.pop();
        self.sessions_cursor = 0;
        self.events_cursor = 0;
        self.audit_cursor = 0;
    }

    pub fn toggle_help(&mut self) {
        self.help_visible = !self.help_visible;
    }
}

fn matches_audit_query(e: &WebhookLogEntry, q: &str) -> bool {
    let fields = [
        e.event_type.to_lowercase(),
        e.action.as_deref().unwrap_or("").to_lowercase(),
        e.repo.as_deref().unwrap_or("").to_lowercase(),
        e.actor.as_deref().unwrap_or("").to_lowercase(),
        e.reason.as_deref().unwrap_or("").to_lowercase(),
        e.disposition.to_lowercase(),
        e.pr_number.map(|n| n.to_string()).unwrap_or_default(),
    ];
    fields.iter().any(|s| s.contains(q))
}

fn is_interesting(e: &WebhookLogEntry) -> bool {
    // Keep everything that acted on something.
    if e.disposition != "dropped" {
        return true;
    }
    let reason = e.reason.as_deref().unwrap_or("");
    // Drop the obvious noise.
    if reason == "ping"
        || reason == "unhandled_event_type"
        || reason == "comment_on_issue_not_pr"
        || reason.starts_with("pr_action_")
        || reason.starts_with("action_")
    {
        return false;
    }
    // check_run from a CI/build bot with no scanner match — noisy but so
    // common it buries everything else.
    if e.event_type == "check_run" {
        if let Some(actor) = e.actor.as_deref() {
            let noisy = [
                "github-actions",
                "vercel",
                "vercel[bot]",
                "netlify",
                "netlify[bot]",
                "dependabot",
                "dependabot[bot]",
            ];
            if noisy.contains(&actor) {
                return false;
            }
        }
    }
    true
}

fn spawn_poller(client: Client, tx: Sender<Msg>, refresh_rx: Receiver<()>) {
    thread::spawn(move || {
        let mut last = Instant::now().checked_sub(Duration::from_secs(60)).unwrap_or_else(Instant::now);
        loop {
            let forced = refresh_rx.recv_timeout(Duration::from_millis(500)).is_ok();
            if !forced && last.elapsed() < Duration::from_secs(3) {
                continue;
            }
            last = Instant::now();
            let snap = fetch_snapshot(&client);
            if tx.send(Msg::Snapshot(snap)).is_err() {
                return;
            }
        }
    });
}

fn fetch_snapshot(client: &Client) -> Snapshot {
    let mut snap = Snapshot::default();
    let mut note = |snap: &mut Snapshot, msg: String| {
        if snap.error.is_none() {
            snap.error = Some(msg);
        }
    };
    match client.health() {
        Ok(h) => snap.health = Some(h),
        Err(e) => note(&mut snap, format!("health: {e}")),
    }
    match client.config() {
        Ok(c) => snap.config = Some(c),
        Err(e) => note(&mut snap, format!("config: {e}")),
    }
    match client.sessions() {
        Ok(s) => snap.sessions = s,
        Err(e) => note(&mut snap, format!("sessions: {e}")),
    }
    match client.unreviewed() {
        Ok(e) => snap.events = e,
        Err(err) => note(&mut snap, format!("events: {err}")),
    }
    match client.webhook_log() {
        Ok(w) => snap.webhook_log = w,
        Err(err) => note(&mut snap, format!("webhook-log: {err}")),
    }
    snap.fetched_at = Instant::now();
    snap
}
