use crate::app::App;
use crate::theme::Theme;
use crate::views::relative_time;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Cell, Padding, Paragraph, Row, Table},
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let sessions = app.filtered_sessions();
    if sessions.is_empty() {
        render_empty(f, area, app);
        return;
    }

    let layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(5), Constraint::Length(7)])
        .split(area);

    render_table(f, layout[0], app, &sessions);
    render_detail(f, layout[1], app, &sessions);
}

fn render_table(f: &mut Frame, area: Rect, app: &App, sessions: &[&crate::api::Session]) {
    let t = app.theme;
    let header = Row::new(vec![
        hdr("REPO", t),
        hdr("PR", t),
        hdr("AGENT", t),
        hdr("PID", t),
        hdr("LINKED", t),
    ])
    .height(1);

    let rows: Vec<Row> = sessions
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let pid = s
                .terminal_pid
                .map(|p| p.to_string())
                .unwrap_or_else(|| "-".into());
            let selected = i == app.sessions_cursor;
            let style = if selected {
                Style::default().fg(t.selected_fg).bg(t.selected_bg)
            } else {
                Style::default()
            };
            Row::new(vec![
                Cell::from(s.repo.clone()),
                Cell::from(format!("#{}", s.pr_number)),
                Cell::from(agent_badge(&s.agent_type, t, selected)),
                Cell::from(pid),
                Cell::from(relative_time(&s.linked_at)),
            ])
            .style(style)
        })
        .collect();

    let widths = [
        Constraint::Percentage(42),
        Constraint::Length(8),
        Constraint::Length(14),
        Constraint::Length(8),
        Constraint::Length(12),
    ];

    let table = Table::new(rows, widths).header(header).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(t.border))
            .title(Span::styled(
                " linked sessions ",
                Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
            ))
            .padding(Padding::horizontal(1)),
    );
    f.render_widget(table, area);
}

fn render_detail(f: &mut Frame, area: Rect, app: &App, sessions: &[&crate::api::Session]) {
    let t = app.theme;
    let Some(s) = sessions.get(app.sessions_cursor) else {
        return;
    };
    let lines = vec![
        kv("session id", &s.id, t),
        kv("repo path ", &s.repo_path, t),
        kv("tmux pane ", s.tmux_pane.as_deref().unwrap_or("-"), t),
        kv("linked at ", &s.linked_at, t),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " details ",
            Style::default().fg(t.muted),
        ))
        .padding(Padding::horizontal(2));
    f.render_widget(Paragraph::new(lines).block(block), area);
}

fn render_empty(f: &mut Frame, area: Rect, app: &App) {
    let t = app.theme;
    let has_query = !app.filter_query.is_empty();
    let total = app.snap.sessions.len();
    let msg = if has_query && total > 0 {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                format!("  No sessions match filter \"{}\".", app.filter_query),
                Style::default().fg(t.muted),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  Press Esc to clear.",
                Style::default().fg(t.muted),
            )),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "  No linked sessions yet.",
                Style::default().fg(t.muted),
            )),
            Line::from(""),
            Line::from(vec![
                Span::raw("  From any repo with an open PR, run  "),
                Span::styled(
                    "`sentinel link`",
                    Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(Span::styled(
                "  or let the Claude Code PostToolUse hook auto-link.",
                Style::default().fg(t.muted),
            )),
        ]
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(" linked sessions ");
    f.render_widget(Paragraph::new(msg).block(block), area);
}

fn hdr(s: &str, t: Theme) -> Cell<'_> {
    Cell::from(s).style(
        Style::default()
            .fg(t.muted)
            .add_modifier(Modifier::BOLD),
    )
}

fn agent_badge(agent: &str, t: Theme, selected: bool) -> Span<'_> {
    let color = if selected {
        t.selected_fg
    } else {
        match agent {
            "claude-code" => t.primary,
            "openclaw" => t.accent,
            _ => t.text,
        }
    };
    Span::styled(
        agent.to_string(),
        Style::default().fg(color).add_modifier(Modifier::BOLD),
    )
}

fn kv<'a>(label: &'a str, value: &str, t: Theme) -> Line<'a> {
    Line::from(vec![
        Span::styled(format!("{label}  "), Style::default().fg(t.muted)),
        Span::styled(value.to_string(), Style::default().fg(t.text)),
    ])
}
