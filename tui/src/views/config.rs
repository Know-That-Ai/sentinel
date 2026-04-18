use crate::app::App;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Padding, Paragraph, Wrap},
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let Some(cfg) = &app.snap.config else {
        let p = Paragraph::new("Waiting for daemon…").block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(" config "),
        );
        f.render_widget(p, area);
        return;
    };

    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    let left = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(10), Constraint::Min(6)])
        .split(layout[0]);

    let right = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(14), Constraint::Min(6)])
        .split(layout[1]);

    render_reacts_to(f, left[0], cfg);
    render_repos(f, left[1], cfg);
    render_dispatch(f, right[0], cfg);
    render_identity(f, right[1], cfg);
}

fn render_reacts_to(f: &mut Frame, area: Rect, cfg: &crate::api::Config) {
    let mut lines = vec![
        Line::from(Span::styled(
            "Sentinel injects into linked sessions when it sees",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "PR comments or check runs from these accounts:",
            Style::default().fg(Color::DarkGray),
        )),
        Line::raw(""),
    ];
    if cfg.scanner_bot_logins.is_empty() {
        lines.push(Line::from(Span::styled(
            "  (none configured — set SCANNER_BOT_LOGINS in .env)",
            Style::default().fg(Color::Red),
        )));
    } else {
        for bot in &cfg.scanner_bot_logins {
            lines.push(Line::from(vec![
                Span::styled("  · ", Style::default().fg(Color::Magenta)),
                Span::styled(
                    bot.clone(),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " reacts to ",
            Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_repos(f: &mut Frame, area: Rect, cfg: &crate::api::Config) {
    let mut lines = vec![];
    if cfg.repo_paths.is_empty() {
        lines.push(Line::from(Span::styled(
            "  (no repos mapped — add to REPO_PATHS in .env)",
            Style::default().fg(Color::Yellow),
        )));
    } else {
        for (repo, path) in &cfg.repo_paths {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(
                    repo.clone(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::raw("      → "),
                Span::styled(path.clone(), Style::default().fg(Color::Gray)),
            ]));
            lines.push(Line::raw(""));
        }
    }
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " repo paths ",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_dispatch(f: &mut Frame, area: Rect, cfg: &crate::api::Config) {
    let lines = vec![
        Line::from(Span::styled(
            "Unlinked-PR fallback — when no Claude session is",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "linked, auto-dispatch or just notify?",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "(Linked sessions always get injected regardless.)",
            Style::default().fg(Color::DarkGray),
        )),
        Line::raw(""),
        flag_line("BugBot", cfg.auto_dispatch_bugbot),
        flag_line("CodeQL", cfg.auto_dispatch_codeql),
        flag_line("CI    ", cfg.auto_dispatch_ci),
        Line::raw(""),
        Line::from(Span::styled(
            "Injection mode",
            Style::default().fg(Color::DarkGray),
        )),
        Line::raw(""),
        submit_line(cfg.auto_submit),
        Line::from(Span::styled(
            "  (Terminal.app always submits — toggle only affects",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "  iTerm2 / tmux.)",
            Style::default().fg(Color::DarkGray),
        )),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " dispatch ",
            Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_identity(f: &mut Frame, area: Rect, cfg: &crate::api::Config) {
    let lines = vec![
        kv("smee   ", &nonempty(&cfg.smee_url)),
        kv("agent  ", &cfg.preferred_agent),
        kv("org    ", &cfg.github_org),
        kv(
            "user   ",
            &if cfg.user_label.is_empty() {
                cfg.github_username.clone()
            } else {
                format!("{} ({})", cfg.user_label, cfg.github_username)
            },
        ),
        kv("port   ", &cfg.port.to_string()),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " endpoints & identity ",
            Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn flag_line<'a>(label: &'a str, on: bool) -> Line<'a> {
    let (text, color) = if on {
        ("AUTO ", Color::Green)
    } else {
        ("NOTIFY", Color::DarkGray)
    };
    Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{label}  "), Style::default().fg(Color::White)),
        Span::styled(
            text,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn submit_line<'a>(on: bool) -> Line<'a> {
    let (label, text, color) = if on {
        ("auto-submit", "ON  focus + Enter", Color::Green)
    } else {
        ("auto-submit", "OFF  type only, you press Enter", Color::Yellow)
    };
    Line::from(vec![
        Span::raw("  "),
        Span::styled(
            format!("{label}  "),
            Style::default().fg(Color::White),
        ),
        Span::styled(
            text,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn kv<'a>(label: &'a str, value: &str) -> Line<'a> {
    Line::from(vec![
        Span::raw("  "),
        Span::styled(
            format!("{label}  "),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(value.to_string(), Style::default().fg(Color::White)),
    ])
}

fn nonempty(s: &str) -> String {
    if s.is_empty() {
        "(unset)".into()
    } else {
        s.to_string()
    }
}
