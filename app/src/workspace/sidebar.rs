use dioxus::prelude::*;

use crate::project::{Project, create as create_project};

use super::{WorkspaceView, api::Workspace};

#[component]
pub(super) fn WorkspaceSidebar(
    token: String,
    user_email: String,
    workspace: Option<Workspace>,
    mut projects: Signal<Vec<Project>>,
    mut active_view: Signal<WorkspaceView>,
    loading: bool,
    projects_loading: bool,
    on_error: EventHandler<String>,
    on_logout: EventHandler<()>,
) -> Element {
    let workspace_id = workspace.as_ref().map(|workspace| workspace.id.clone());
    let current_view = active_view.read().clone();

    rsx! {
        aside { class: "workspace-sidebar",
            div { class: "sidebar-brand",
                span { class: "wordmark-mark", "K" }
                span { "Kanleaf" }
            }

            div { class: "sidebar-scroll",
                WorkspaceButton { workspace, loading }
                PrimaryNavigation {
                    active_view: current_view.clone(),
                    on_navigate: move |view| active_view.set(view),
                }
                WorkspaceNavigation {
                    active: current_view == WorkspaceView::Projects,
                    on_select: move |_| active_view.set(WorkspaceView::Projects),
                }
                ProjectNavigation {
                    token,
                    workspace_id,
                    projects,
                    active_view,
                    loading: projects_loading,
                    on_error,
                }
                ViewsNavigation {}
            }

            UserArea { email: user_email, on_logout }
        }
    }
}

#[component]
fn WorkspaceButton(workspace: Option<Workspace>, loading: bool) -> Element {
    let (name, avatar) = if loading {
        ("Loading…".to_owned(), "W".to_owned())
    } else if let Some(workspace) = workspace {
        let avatar = workspace
            .name
            .chars()
            .next()
            .unwrap_or('W')
            .to_uppercase()
            .to_string();
        (workspace.name, avatar)
    } else {
        ("No workspace".to_owned(), "W".to_owned())
    };

    rsx! {
        button {
            class: "workspace-button",
            r#type: "button",
            disabled: true,
            aria_label: "Current workspace",
            span { class: "workspace-avatar", "{avatar}" }
            span { class: "workspace-name", "{name}" }
            span { class: "workspace-chevron", aria_hidden: "true", "⌄" }
        }
    }
}

#[component]
fn PrimaryNavigation(
    active_view: WorkspaceView,
    on_navigate: EventHandler<WorkspaceView>,
) -> Element {
    let navigate_home = on_navigate;
    let navigate_tasks = on_navigate;
    let navigate_inbox = on_navigate;

    rsx! {
        nav { class: "primary-navigation", aria_label: "Primary navigation",
            NavigationItem {
                label: "Home",
                icon: "⌂",
                active: active_view == WorkspaceView::Home,
                on_select: move |_| navigate_home.call(WorkspaceView::Home),
            }
            NavigationItem {
                label: "My Tasks",
                icon: "✓",
                active: active_view == WorkspaceView::MyTasks,
                on_select: move |_| navigate_tasks.call(WorkspaceView::MyTasks),
            }
            NavigationItem {
                label: "Inbox",
                icon: "□",
                active: active_view == WorkspaceView::Inbox,
                on_select: move |_| navigate_inbox.call(WorkspaceView::Inbox),
            }
        }
    }
}

#[component]
fn WorkspaceNavigation(active: bool, on_select: EventHandler<()>) -> Element {
    rsx! {
        section { class: "sidebar-section",
            p { class: "sidebar-section-label", "Workspace" }
            NavigationItem {
                label: "Projects",
                icon: "▦",
                active,
                on_select,
            }
        }
    }
}

#[component]
fn NavigationItem(
    label: String,
    icon: String,
    active: bool,
    on_select: EventHandler<()>,
) -> Element {
    rsx! {
        button {
            class: if active { "nav-item active" } else { "nav-item" },
            r#type: "button",
            onclick: move |_| on_select.call(()),
            span { class: "nav-icon", aria_hidden: "true", "{icon}" }
            span { "{label}" }
        }
    }
}

#[component]
fn ProjectNavigation(
    token: String,
    workspace_id: Option<String>,
    mut projects: Signal<Vec<Project>>,
    mut active_view: Signal<WorkspaceView>,
    loading: bool,
    on_error: EventHandler<String>,
) -> Element {
    let mut creating = use_signal(|| false);
    let mut project_name = use_signal(String::new);
    let project_items = projects.read().clone();
    let current_view = active_view.read().clone();
    let can_create = workspace_id.is_some() && !loading;
    let workspace_for_submit = workspace_id.clone();
    let token_for_submit = token.clone();

    rsx! {
        section { class: "sidebar-section project-navigation",
            p { class: "sidebar-section-label", "Projects" }

            if loading {
                p { class: "nav-empty", "Loading…" }
            } else if project_items.is_empty() {
                p { class: "nav-empty", "No projects yet" }
            } else {
                for project in project_items {
                    {
                        let project_id = project.id.clone();
                        let is_active = matches!(
                            &current_view,
                            WorkspaceView::Project(selected_id) if selected_id == &project.id
                        );

                        rsx! {
                            button {
                                class: if is_active { "project-item active" } else { "project-item" },
                                r#type: "button",
                                onclick: move |_| {
                                    active_view.set(WorkspaceView::Project(project_id.clone()));
                                },
                                span { class: "project-mark", aria_hidden: "true" }
                                span { "{project.name}" }
                            }
                        }
                    }
                }
            }

            if *creating.read() {
                form {
                    class: "project-create-form",
                    onsubmit: move |event| {
                        let token = token_for_submit.clone();
                        let workspace_id = workspace_for_submit.clone();
                        async move {
                            event.prevent_default();
                            let name = project_name.read().trim().to_owned();
                            if name.is_empty() {
                                on_error.call("Enter a project name.".to_owned());
                                return;
                            }
                            let Some(workspace_id) = workspace_id else {
                                on_error.call("Select a workspace first.".to_owned());
                                return;
                            };

                            match create_project(&token, &workspace_id, &name).await {
                                Ok(project) => {
                                    active_view.set(WorkspaceView::Project(project.id.clone()));
                                    projects.write().push(project);
                                    project_name.set(String::new());
                                    creating.set(false);
                                }
                                Err(message) => on_error.call(message),
                            }
                        }
                    },
                    input {
                        r#type: "text",
                        aria_label: "Project name",
                        autofocus: true,
                        placeholder: "Project name",
                        value: project_name,
                        oninput: move |event| project_name.set(event.value()),
                    }
                    button { r#type: "submit", "Create" }
                }
            } else {
                button {
                    class: "project-create-action",
                    r#type: "button",
                    disabled: !can_create,
                    onclick: move |_| creating.set(true),
                    span { aria_hidden: "true", "+" }
                    "New project"
                }
            }
        }
    }
}

#[component]
fn ViewsNavigation() -> Element {
    rsx! {
        section { class: "sidebar-section views-navigation",
            p { class: "sidebar-section-label", "Views" }
        }
    }
}

#[component]
fn UserArea(email: String, on_logout: EventHandler<()>) -> Element {
    let display_name = email.split('@').next().unwrap_or("User").to_owned();
    let avatar = display_name
        .chars()
        .next()
        .unwrap_or('U')
        .to_uppercase()
        .to_string();

    rsx! {
        div { class: "sidebar-user-area",
            div { class: "sidebar-user-identity",
                span { class: "sidebar-user-avatar", "{avatar}" }
                span { class: "sidebar-user-copy",
                    strong { "{display_name}" }
                    small { title: "{email}", "{email}" }
                }
            }
            button {
                class: "sidebar-logout",
                r#type: "button",
                onclick: move |_| on_logout.call(()),
                "Log out"
            }
        }
    }
}
