use crate::app::App;
use crate::theme::Theme;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Padding, Paragraph, Wrap},
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let t = app.theme;
    let Some(cfg) = &app.snap.config else {
        let p = Paragraph::new("Waiting for daemon…").block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(t.border))
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

    render_reacts_to(f, left[0], cfg, t);
    render_repos(f, left[1], cfg, t);
    render_dispatch(f, right[0], cfg, t);
    render_identity(f, right[1], cfg, t);
}

fn render_reacts_to(f: &mut Frame, area: Rect, cfg: &crate::api::Config, t: Theme) {
    let mut lines = vec![
        Line::from(Span::styled(
            "Sentinel injects into linked sessions when it sees",
            Style::default().fg(t.muted),
        )),
        Line::from(Span::styled(
            "PR comments or check runs from these accounts:",
            Style::default().fg(t.muted),
        )),
        Line::raw(""),
    ];
    if cfg.scanner_bot_logins.is_empty() {
        lines.push(Line::from(Span::styled(
            "  (none configured — set SCANNER_BOT_LOGINS in .env)",
            Style::default().fg(t.error),
        )));
    } else {
        for bot in &cfg.scanner_bot_logins {
            lines.push(Line::from(vec![
                Span::styled("  · ", Style::default().fg(t.primary)),
                Span::styled(
                    bot.clone(),
                    Style::default().fg(t.text).add_modifier(Modifier::BOLD),
                ),
            ]));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " reacts to ",
            Style::default().fg(t.success).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_repos(f: &mut Frame, area: Rect, cfg: &crate::api::Config, t: Theme) {
    let mut lines = vec![];
    if cfg.repo_paths.is_empty() {
        lines.push(Line::from(Span::styled(
            "  (no repos mapped — add to REPO_PATHS in .env)",
            Style::default().fg(t.warning),
        )));
    } else {
        for (repo, path) in &cfg.repo_paths {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(
                    repo.clone(),
                    Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::raw("      → "),
                Span::styled(path.clone(), Style::default().fg(t.muted)),
            ]));
            lines.push(Line::raw(""));
        }
    }
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " repo paths ",
            Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_dispatch(f: &mut Frame, area: Rect, cfg: &crate::api::Config, t: Theme) {
    let lines = vec![
        Line::from(Span::styled(
            "Unlinked-PR fallback — when no Claude session is",
            Style::default().fg(t.muted),
        )),
        Line::from(Span::styled(
            "linked, auto-dispatch or just notify?",
            Style::default().fg(t.muted),
        )),
        Line::from(Span::styled(
            "(Linked sessions always get injected regardless.)",
            Style::default().fg(t.muted),
        )),
        Line::raw(""),
        flag_line("BugBot", cfg.auto_dispatch_bugbot, t),
        flag_line("CodeQL", cfg.auto_dispatch_codeql, t),
        flag_line("CI    ", cfg.auto_dispatch_ci, t),
        Line::raw(""),
        Line::from(Span::styled(
            "Injection mode",
            Style::default().fg(t.muted),
        )),
        Line::raw(""),
        submit_line(cfg.auto_submit, t),
        Line::from(Span::styled(
            "  (Terminal.app always submits — toggle only affects",
            Style::default().fg(t.muted),
        )),
        Line::from(Span::styled(
            "  iTerm2 / tmux.)",
            Style::default().fg(t.muted),
        )),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " dispatch ",
            Style::default().fg(t.primary).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_identity(f: &mut Frame, area: Rect, cfg: &crate::api::Config, t: Theme) {
    let lines = vec![
        kv("smee   ", &nonempty(&cfg.smee_url), t),
        kv("agent  ", &cfg.preferred_agent, t),
        kv("org    ", &cfg.github_org, t),
        kv(
            "user   ",
            &if cfg.user_label.is_empty() {
                cfg.github_username.clone()
            } else {
                format!("{} ({})", cfg.user_label, cfg.github_username)
            },
            t,
        ),
        kv("port   ", &cfg.port.to_string(), t),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " endpoints & identity ",
            Style::default().fg(t.primary).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn flag_line<'a>(label: &'a str, on: bool, t: Theme) -> Line<'a> {
    let (text, color) = if on {
        ("AUTO ", t.success)
    } else {
        ("NOTIFY", t.muted)
    };
    Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{label}  "), Style::default().fg(t.text)),
        Span::styled(
            text,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn submit_line<'a>(on: bool, t: Theme) -> Line<'a> {
    let (label, text, color) = if on {
        ("auto-submit", "ON  focus + Enter", t.success)
    } else {
        ("auto-submit", "OFF  type only, you press Enter", t.warning)
    };
    Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{label}  "), Style::default().fg(t.text)),
        Span::styled(
            text,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn kv<'a>(label: &'a str, value: &str, t: Theme) -> Line<'a> {
    Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{label}  "), Style::default().fg(t.muted)),
        Span::styled(value.to_string(), Style::default().fg(t.text)),
    ])
}

fn nonempty(s: &str) -> String {
    if s.is_empty() {
        "(unset)".into()
    } else {
        s.to_string()
    }
}
