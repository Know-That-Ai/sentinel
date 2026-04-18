use crate::api::{Client, Config, Event, Health, Session, WebhookLogEntry};
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
    pub snap: Snapshot,
    pub sessions_cursor: usize,
    pub events_cursor: usize,
    pub audit_cursor: usize,
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
            snap: Snapshot::default(),
            sessions_cursor: 0,
            events_cursor: 0,
            audit_cursor: 0,
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
        self.snap.events.get(self.events_cursor)
    }

    pub fn selected_session(&self) -> Option<&Session> {
        self.snap.sessions.get(self.sessions_cursor)
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
            self.client.dispatch(&ev.id)?;
            self.flash(format!("dispatched: {} #{}", ev.repo, ev.pr_number));
            self.request_refresh();
        }
        Ok(())
    }

    pub fn move_cursor(&mut self, delta: isize) {
        let (len, cursor) = match self.tab {
            Tab::Sessions => (self.snap.sessions.len(), &mut self.sessions_cursor),
            Tab::Events => (self.snap.events.len(), &mut self.events_cursor),
            Tab::Audit => (self.snap.webhook_log.len(), &mut self.audit_cursor),
            _ => return,
        };
        if len == 0 {
            *cursor = 0;
            return;
        }
        let new = (*cursor as isize + delta).rem_euclid(len as isize);
        *cursor = new as usize;
    }
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
