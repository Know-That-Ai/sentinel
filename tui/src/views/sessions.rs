use crate::app::App;
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
    let header = Row::new(vec![
        hdr("REPO"),
        hdr("PR"),
        hdr("AGENT"),
        hdr("PID"),
        hdr("LINKED"),
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
                Style::default().fg(Color::Black).bg(Color::Magenta)
            } else {
                Style::default()
            };
            Row::new(vec![
                Cell::from(s.repo.clone()),
                Cell::from(format!("#{}", s.pr_number)),
                Cell::from(agent_badge(&s.agent_type)),
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
            .border_style(Style::default().fg(Color::DarkGray))
            .title(Span::styled(
                " linked sessions ",
                Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
            ))
            .padding(Padding::horizontal(1)),
    );
    f.render_widget(table, area);
}

fn render_detail(f: &mut Frame, area: Rect, app: &App, sessions: &[&crate::api::Session]) {
    let Some(s) = sessions.get(app.sessions_cursor) else {
        return;
    };
    let lines = vec![
        kv("session id", &s.id),
        kv("repo path ", &s.repo_path),
        kv("tmux pane ", s.tmux_pane.as_deref().unwrap_or("-")),
        kv("linked at ", &s.linked_at),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " details ",
            Style::default().fg(Color::DarkGray),
        ))
        .padding(Padding::horizontal(2));
    f.render_widget(Paragraph::new(lines).block(block), area);
}

fn render_empty(f: &mut Frame, area: Rect, app: &App) {
    let has_query = !app.filter_query.is_empty();
    let total = app.snap.sessions.len();
    let msg = if has_query && total > 0 {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                format!("  No sessions match filter \"{}\".", app.filter_query),
                Style::default().fg(Color::DarkGray),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  Press Esc to clear.",
                Style::default().fg(Color::DarkGray),
            )),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "  No linked sessions yet.",
                Style::default().fg(Color::DarkGray),
            )),
            Line::from(""),
            Line::from(vec![
                Span::raw("  From any repo with an open PR, run  "),
                Span::styled(
                    "`sentinel link`",
                    Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(Span::styled(
                "  or let the Claude Code PostToolUse hook auto-link.",
                Style::default().fg(Color::DarkGray),
            )),
        ]
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" linked sessions ");
    f.render_widget(Paragraph::new(msg).block(block), area);
}

fn hdr(s: &str) -> Cell<'_> {
    Cell::from(s).style(
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
    )
}

fn agent_badge(agent: &str) -> Span<'_> {
    let color = match agent {
        "claude-code" => Color::Magenta,
        "openclaw" => Color::Cyan,
        _ => Color::White,
    };
    Span::styled(
        agent.to_string(),
        Style::default().fg(color).add_modifier(Modifier::BOLD),
    )
}

fn kv<'a>(label: &'a str, value: &str) -> Line<'a> {
    Line::from(vec![
        Span::styled(
            format!("{label}  "),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(value.to_string(), Style::default().fg(Color::White)),
    ])
}
