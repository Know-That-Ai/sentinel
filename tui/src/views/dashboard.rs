use crate::app::App;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Padding, Paragraph, Wrap},
};
use std::time::Instant;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .split(area);

    render_service(f, layout[0], app);
    render_summary(f, layout[1], app);
}

fn render_service(f: &mut Frame, area: Rect, app: &App) {
    let mut lines: Vec<Line> = Vec::new();

    let daemon_ok = app.snap.health.is_some();
    lines.push(row_status("Daemon", daemon_ok, daemon_status_text(app)));

    let port = app.snap.config.as_ref().map(|c| c.port).unwrap_or(3847);
    lines.push(kv("Port", &format!("{port}  ·  /health")));

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
    lines.push(kv("Smee", &smee_display));

    if let Some(cfg) = &app.snap.config {
        let who = if cfg.user_label.is_empty() {
            cfg.github_username.clone()
        } else {
            format!("{} ({})", cfg.user_label, cfg.github_username)
        };
        lines.push(kv("User", &format!("{who}  @  {}", cfg.github_org)));
        lines.push(kv("Agent", &cfg.preferred_agent));
    }

    lines.push(kv(
        "TUI uptime",
        &format_uptime(app.started_at.elapsed()),
    ));
    lines.push(kv(
        "Last poll",
        &format!(
            "{:.1}s ago",
            app.snap.fetched_at.elapsed().as_secs_f32()
        ),
    ));

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " service ",
            Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    let p = Paragraph::new(lines).wrap(Wrap { trim: false }).block(block);
    f.render_widget(p, area);
}

fn render_summary(f: &mut Frame, area: Rect, app: &App) {
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
        big_number(sessions, "linked sessions", Color::Cyan),
        Line::raw(""),
        big_number(events, "unreviewed events", Color::Yellow),
        Line::raw(""),
        big_number(scanner_events, "scanner events", Color::Magenta),
        Line::raw(""),
        big_number(bots, "scanner bots watched", Color::Green),
    ];

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " at a glance ",
            Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(3, 2, 1, 1));
    let p = Paragraph::new(lines).block(block);
    f.render_widget(p, area);
}

fn daemon_status_text(app: &App) -> String {
    match &app.snap.health {
        Some(h) => format!("running  ·  {}", h.status),
        None => "unreachable".to_string(),
    }
}

fn row_status<'a>(label: &'a str, ok: bool, value: String) -> Line<'a> {
    let dot = if ok { "●" } else { "○" };
    let color = if ok { Color::Green } else { Color::Red };
    Line::from(vec![
        Span::styled(format!("{dot}  "), Style::default().fg(color)),
        Span::styled(
            format!("{label:<12}"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(value, Style::default().fg(Color::White)),
    ])
}

fn kv<'a>(label: &'a str, value: &str) -> Line<'a> {
    Line::from(vec![
        Span::raw("   "),
        Span::styled(
            format!("{label:<12}"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(value.to_string(), Style::default().fg(Color::White)),
    ])
}

fn big_number<'a>(n: usize, label: &'a str, color: Color) -> Line<'a> {
    Line::from(vec![
        Span::styled(
            format!("{n:>4}  "),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
        Span::styled(label, Style::default().fg(Color::DarkGray)),
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
