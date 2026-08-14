mod api;

use dioxus::prelude::*;

use api::{Workspace, activate, create, list};

#[component]
pub fn WorkspaceShell(token: String, on_logout: EventHandler<()>) -> Element {
    let mut workspaces = use_signal(Vec::<Workspace>::new);
    let mut active_workspace_id = use_signal(|| None::<String>);
    let mut menu_open = use_signal(|| false);
    let mut creating_workspace = use_signal(|| false);
    let mut new_workspace_name = use_signal(String::new);
    let mut loading = use_signal(|| true);
    let mut error = use_signal(|| None::<String>);

    let token_for_load = token.clone();
    use_future(move || {
        let token = token_for_load.clone();
        async move {
            match list(&token).await {
                Ok(response) => {
                    workspaces.set(response.workspaces);
                    active_workspace_id.set(response.active_workspace_id);
                }
                Err(message) => error.set(Some(message)),
            }
            loading.set(false);
        }
    });

    let active_workspace = active_workspace_id.read().as_ref().and_then(|active_id| {
        workspaces
            .read()
            .iter()
            .find(|workspace| workspace.id == *active_id)
            .cloned()
    });
    let workspace_items = workspaces.read().clone();
    let error_message = error.read().clone();
    let is_loading = *loading.read();

    rsx! {
        main { class: "workspace-shell",
            aside { class: "workspace-sidebar",
                div { class: "sidebar-brand",
                    span { class: "wordmark-mark", "K" }
                    span { "Kanleaf" }
                }

                div { class: "workspace-switcher",
                    button {
                        class: "workspace-trigger",
                        r#type: "button",
                        disabled: is_loading,
                        onclick: move |_| menu_open.toggle(),
                        span { class: "workspace-avatar", "W" }
                        span { class: "workspace-trigger-name",
                            if is_loading {
                                "Loading…"
                            } else if let Some(workspace) = &active_workspace {
                                "{workspace.name}"
                            } else {
                                "No workspace"
                            }
                        }
                        span { class: "workspace-chevron", "⌄" }
                    }

                    if *menu_open.read() {
                        div { class: "workspace-menu",
                            p { class: "workspace-menu-label", "Workspaces" }
                            for workspace in workspace_items.iter() {
                                {
                                    let workspace_id = workspace.id.clone();
                                    let workspace_name = workspace.name.clone();
                                    let token = token.clone();
                                    let is_active = active_workspace_id
                                        .read()
                                        .as_ref()
                                        .is_some_and(|active_id| active_id == &workspace.id);

                                    rsx! {
                                        button {
                                            class: if is_active { "workspace-option active" } else { "workspace-option" },
                                            r#type: "button",
                                            onclick: move |_| {
                                                let token = token.clone();
                                                let workspace_id = workspace_id.clone();
                                                async move {
                                                    error.set(None);
                                                    match activate(&token, &workspace_id).await {
                                                        Ok(workspace) => {
                                                            active_workspace_id.set(Some(workspace.id));
                                                            menu_open.set(false);
                                                        }
                                                        Err(message) => error.set(Some(message)),
                                                    }
                                                }
                                            },
                                            span { "{workspace_name}" }
                                            if is_active { span { class: "workspace-check", "✓" } }
                                        }
                                    }
                                }
                            }

                            div { class: "workspace-menu-separator" }
                            if *creating_workspace.read() {
                                form {
                                    class: "workspace-create-form",
                                    onsubmit: move |event| {
                                        let token = token.clone();
                                        async move {
                                            event.prevent_default();
                                            error.set(None);
                                            let name = new_workspace_name.read().trim().to_owned();
                                            if name.is_empty() {
                                                error.set(Some("Enter a workspace name.".to_owned()));
                                                return;
                                            }

                                            match create(&token, &name).await {
                                                Ok(workspace) => {
                                                    active_workspace_id.set(Some(workspace.id.clone()));
                                                    workspaces.write().push(workspace);
                                                    new_workspace_name.set(String::new());
                                                    creating_workspace.set(false);
                                                    menu_open.set(false);
                                                }
                                                Err(message) => error.set(Some(message)),
                                            }
                                        }
                                    },
                                    input {
                                        r#type: "text",
                                        aria_label: "Workspace name",
                                        autofocus: true,
                                        placeholder: "Workspace name",
                                        value: new_workspace_name,
                                        oninput: move |event| new_workspace_name.set(event.value()),
                                    }
                                    button { r#type: "submit", "Create" }
                                }
                            } else {
                                button {
                                    class: "workspace-create-action",
                                    r#type: "button",
                                    onclick: move |_| creating_workspace.set(true),
                                    span { "+" }
                                    "New workspace"
                                }
                            }
                        }
                    }
                }

                nav { class: "sidebar-nav", aria_label: "Workspace navigation",
                    button { class: "nav-item active", r#type: "button",
                        span { class: "nav-icon", "□" }
                        "Inbox"
                    }
                    button { class: "nav-item", r#type: "button",
                        span { class: "nav-icon", "✓" }
                        "My Tasks"
                    }

                    p { class: "nav-section-label", "Projects" }
                    p { class: "nav-empty", "No projects yet" }

                    p { class: "nav-section-label", "Views" }
                }

                div { class: "sidebar-footer",
                    button {
                        class: "sidebar-logout",
                        r#type: "button",
                        onclick: move |_| on_logout.call(()),
                        "Log out"
                    }
                }
            }

            section { class: "workspace-content",
                header { class: "content-header",
                    h1 { "Inbox" }
                }
                div { class: "content-empty",
                    p { "No tasks yet." }
                }
                if let Some(message) = error_message {
                    p { class: "shell-error", role: "alert", "{message}" }
                }
            }
        }
    }
}
