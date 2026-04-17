mod api;
mod app;
mod ui;
mod views;

use anyhow::Result;
use app::{App, Tab};
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use std::{io, time::Duration};

fn main() -> Result<()> {
    let base = std::env::var("SENTINEL_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:3847".to_string());

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut term = Terminal::new(backend)?;

    let mut app = App::new(base);
    app.request_refresh();

    let result = run(&mut term, &mut app);

    disable_raw_mode()?;
    execute!(term.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    term.show_cursor()?;

    result
}

fn run<B: Backend>(term: &mut Terminal<B>, app: &mut App) -> Result<()> {
    loop {
        app.drain_msgs();
        term.draw(|f| ui::draw(f, app))?;

        if event::poll(Duration::from_millis(200))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                if handle_key(app, key.code, key.modifiers)? {
                    break;
                }
            }
        }
        if app.quitting {
            break;
        }
    }
    Ok(())
}

fn handle_key(app: &mut App, code: KeyCode, mods: KeyModifiers) -> Result<bool> {
    match (code, mods) {
        (KeyCode::Char('q'), _) | (KeyCode::Esc, _) => {
            app.quitting = true;
            return Ok(true);
        }
        (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
            app.quitting = true;
            return Ok(true);
        }
        (KeyCode::Tab, _) | (KeyCode::Char('l'), _) => app.tab = app.tab.next(),
        (KeyCode::BackTab, _) | (KeyCode::Char('h'), _) => app.tab = app.tab.prev(),
        (KeyCode::Char('1'), _) => app.tab = Tab::Dashboard,
        (KeyCode::Char('2'), _) => app.tab = Tab::Sessions,
        (KeyCode::Char('3'), _) => app.tab = Tab::Events,
        (KeyCode::Char('4'), _) => app.tab = Tab::Config,
        (KeyCode::Char('r'), _) => {
            if app.tab == Tab::Events {
                if let Err(e) = app.mark_reviewed_selected() {
                    app.flash(format!("error: {e}"));
                }
            } else {
                app.request_refresh();
                app.flash("refreshing…");
            }
        }
        (KeyCode::Char('d'), _) if app.tab == Tab::Events => {
            if let Err(e) = app.dispatch_selected() {
                app.flash(format!("error: {e}"));
            }
        }
        (KeyCode::Char('j'), _) | (KeyCode::Down, _) => app.move_cursor(1),
        (KeyCode::Char('k'), _) | (KeyCode::Up, _) => app.move_cursor(-1),
        (KeyCode::Char('o'), _) => open_selected(app),
        _ => {}
    }
    Ok(false)
}

fn open_selected(app: &mut App) {
    let url = match app.tab {
        Tab::Events => app.selected_event().map(|e| e.github_url.clone()),
        Tab::Sessions => app
            .selected_session()
            .map(|s| format!("https://github.com/{}/pull/{}", s.repo, s.pr_number)),
        _ => None,
    };
    if let Some(u) = url {
        let _ = std::process::Command::new("open").arg(&u).status();
        app.flash(format!("opened {u}"));
    }
}
