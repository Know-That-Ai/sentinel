use crate::api::WebhookLogEntry;
use crate::app::App;
use chrono::{DateTime, Utc};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Padding, Paragraph, Sparkline, Wrap},
};
use std::time::Instant;

const BUCKET_COUNT: usize = 12;
const BUCKET_MINUTES: i64 = 5;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .split(area);

    render_service(f, layout[0], app);

    let right = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(11), Constraint::Min(5)])
        .split(layout[1]);

    render_summary(f, right[0], app);
    render_activity(f, right[1], app);
}

fn render_service(f: &mut Frame, area: Rect, app: &App) {
    let t = app.theme;
    let mut lines: Vec<Line> = Vec::new();

    let daemon_ok = app.snap.health.is_some();
    lines.push(row_status("Daemon", daemon_ok, daemon_status_text(app), app));

    let port = app.snap.config.as_ref().map(|c| c.port).unwrap_or(3847);
    lines.push(kv("Port", &format!("{port}  ·  /health"), app));

    let smee = app
        .snap
        .config
        .as_ref()
        .map(|c| c.smee_url.clone())
        .unwrap_or_default();
    let smee_display = if smee.is_empty() {
        "not configured".to_string()
    } else {
        smee
    };
    lines.push(kv("Smee", &smee_display, app));

    if let Some(cfg) = &app.snap.config {
        let who = if cfg.user_label.is_empty() {
            cfg.github_username.clone()
        } else {
            format!("{} ({})", cfg.user_label, cfg.github_username)
        };
        lines.push(kv("User", &format!("{who}  @  {}", cfg.github_org), app));
        lines.push(kv("Agent", &cfg.preferred_agent, app));
    }

    lines.push(kv("TUI uptime", &format_uptime(app.started_at.elapsed()), app));
    lines.push(kv(
        "Last poll",
        &format!("{:.1}s ago", app.snap.fetched_at.elapsed().as_secs_f32()),
        app,
    ));

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " service ",
            Style::default().fg(t.primary).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    let p = Paragraph::new(lines).wrap(Wrap { trim: false }).block(block);
    f.render_widget(p, area);
}

fn render_summary(f: &mut Frame, area: Rect, app: &App) {
    let t = app.theme;
    let sessions = app.snap.sessions.len();
    let events = app.snap.events.len();
    let scanner_events = app
        .snap
        .events
        .iter()
        .filter(|e| e.source == "bugbot" || e.source == "codeql")
        .count();
    let bots = app
        .snap
        .config
        .as_ref()
        .map(|c| c.scanner_bot_logins.len())
        .unwrap_or(0);

    let lines = vec![
        big_number(sessions, "linked sessions", t.accent, app),
        Line::raw(""),
        big_number(events, "unreviewed events", t.warning, app),
        Line::raw(""),
        big_number(scanner_events, "scanner events", t.primary, app),
        Line::raw(""),
        big_number(bots, "scanner bots watched", t.success, app),
    ];

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " at a glance ",
            Style::default().fg(t.primary).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(3, 2, 1, 1));
    let p = Paragraph::new(lines).block(block);
    f.render_widget(p, area);
}

fn render_activity(f: &mut Frame, area: Rect, app: &App) {
    let t = app.theme;
    let buckets = bucket_webhook_activity(&app.snap.webhook_log);
    let total: u64 = buckets.iter().sum();
    let peak = buckets.iter().copied().max().unwrap_or(0);

    let title = format!(" last 60 min  ·  {total} webhooks  ·  peak {peak}/5-min ");

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            title,
            Style::default().fg(t.primary).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));

    let inner = block.inner(area);
    f.render_widget(block, area);

    if buckets.iter().all(|&n| n == 0) {
        let msg = Paragraph::new(Line::from(Span::styled(
            "no activity in the last hour",
            Style::default().fg(t.muted),
        )));
        f.render_widget(msg, inner);
        return;
    }

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(inner);

    let sparkline = Sparkline::default()
        .data(&buckets)
        .style(Style::default().fg(t.sparkline))
        .max(peak.max(1));
    f.render_widget(sparkline, rows[0]);

    let axis = Line::from(vec![
        Span::styled("-60m", Style::default().fg(t.muted)),
        Span::raw("  "),
        Span::styled("←  5-minute buckets  →", Style::default().fg(t.muted)),
        Span::raw("  "),
        Span::styled(
            "now",
            Style::default().fg(t.muted).add_modifier(Modifier::BOLD),
        ),
    ])
    .alignment(Alignment::Center);
    f.render_widget(Paragraph::new(axis), rows[1]);
}

fn bucket_webhook_activity(log: &[WebhookLogEntry]) -> Vec<u64> {
    let now = Utc::now();
    let mut buckets = vec![0u64; BUCKET_COUNT];
    for entry in log {
        let Ok(ts) = DateTime::parse_from_rfc3339(&entry.received_at) else {
            continue;
        };
        let ts = ts.with_timezone(&Utc);
        let minutes_ago = (now - ts).num_minutes();
        if !(0..(BUCKET_COUNT as i64 * BUCKET_MINUTES)).contains(&minutes_ago) {
            continue;
        }
        let bucket_from_end = (minutes_ago / BUCKET_MINUTES) as usize;
        let idx = BUCKET_COUNT - 1 - bucket_from_end.min(BUCKET_COUNT - 1);
        buckets[idx] = buckets[idx].saturating_add(1);
    }
    buckets
}

fn daemon_status_text(app: &App) -> String {
    match &app.snap.health {
        Some(h) => format!("running  ·  {}", h.status),
        None => "unreachable".to_string(),
    }
}

fn row_status<'a>(label: &'a str, ok: bool, value: String, app: &App) -> Line<'a> {
    let t = app.theme;
    let dot = if ok { "●" } else { "○" };
    let color = if ok { t.success } else { t.error };
    Line::from(vec![
        Span::styled(format!("{dot}  "), Style::default().fg(color)),
        Span::styled(format!("{label:<12}"), Style::default().fg(t.muted)),
        Span::styled(value, Style::default().fg(t.text)),
    ])
}

fn kv<'a>(label: &'a str, value: &str, app: &App) -> Line<'a> {
    let t = app.theme;
    Line::from(vec![
        Span::raw("   "),
        Span::styled(format!("{label:<12}"), Style::default().fg(t.muted)),
        Span::styled(value.to_string(), Style::default().fg(t.text)),
    ])
}

fn big_number<'a>(n: usize, label: &'a str, color: ratatui::style::Color, app: &App) -> Line<'a> {
    let t = app.theme;
    Line::from(vec![
        Span::styled(
            format!("{n:>4}  "),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
        Span::styled(label, Style::default().fg(t.muted)),
    ])
}

fn format_uptime(d: std::time::Duration) -> String {
    let _ = Instant::now();
    let secs = d.as_secs();
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}h {m}m")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
    }
}
