#![allow(non_snake_case)]

use dioxus::prelude::*;

use crate::auth::{AuthFlow, AuthSession, logout};
use crate::workspace::WorkspaceShell;

static CSS: Asset = asset!("/assets/styles.css");

pub fn App() -> Element {
    let mut session = use_signal(|| None::<AuthSession>);

    if let Some(current_session) = session.read().clone() {
        let token_for_logout = current_session.token.clone();
        return rsx! {
            document::Link { rel: "stylesheet", href: CSS }
            WorkspaceShell {
                token: current_session.token,
                user_email: current_session.email,
                on_logout: move |_| {
                    let token = token_for_logout.clone();
                    spawn(async move {
                        let _ = logout(&token).await;
                        session.set(None);
                    });
                }
            }
        };
    }

    rsx! {
        document::Link { rel: "stylesheet", href: CSS }
        AuthFlow {
            on_authenticated: move |authenticated_session| session.set(Some(authenticated_session)),
        }
    }
}
