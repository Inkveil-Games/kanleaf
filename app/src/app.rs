#![allow(non_snake_case)]

use dioxus::prelude::*;

use crate::auth::{AuthFlow, logout};
use crate::workspace::WorkspaceShell;

static CSS: Asset = asset!("/assets/styles.css");

pub fn App() -> Element {
    let mut session_token = use_signal(|| None::<String>);

    if let Some(token) = session_token.read().clone() {
        let token_for_shell = token.clone();
        let token_for_logout = token.clone();
        return rsx! {
            document::Link { rel: "stylesheet", href: CSS }
            WorkspaceShell {
                token: token_for_shell,
                on_logout: move |_| {
                    let token = token_for_logout.clone();
                    spawn(async move {
                        let _ = logout(&token).await;
                        session_token.set(None);
                    });
                }
            }
        };
    }

    rsx! {
        document::Link { rel: "stylesheet", href: CSS }
        AuthFlow {
            on_authenticated: move |token| session_token.set(Some(token)),
        }
    }
}
