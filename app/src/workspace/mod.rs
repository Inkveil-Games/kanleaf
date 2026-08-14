mod api;

use dioxus::prelude::*;

use crate::project::{Project, create as create_project, list as list_projects};
use api::{Workspace, activate, create as create_workspace, list as list_workspaces};

#[component]
pub fn WorkspaceShell(token: String, on_logout: EventHandler<()>) -> Element {
    let mut workspaces = use_signal(Vec::<Workspace>::new);
    let mut active_workspace_id = use_signal(|| None::<String>);
    let mut projects = use_signal(Vec::<Project>::new);
    let mut selected_project_id = use_signal(|| None::<String>);
    let mut menu_open = use_signal(|| false);
    let mut creating_workspace = use_signal(|| false);
    let mut new_workspace_name = use_signal(String::new);
    let mut creating_project = use_signal(|| false);
    let mut new_project_name = use_signal(String::new);
    let mut loading = use_signal(|| true);
    let mut projects_loading = use_signal(|| true);
    let mut error = use_signal(|| None::<String>);

    let token_for_load = token.clone();
    use_future(move || {
        let token = token_for_load.clone();
        async move {
            match list_workspaces(&token).await {
                Ok(response) => {
                    let workspace_id = response.active_workspace_id.clone();
                    workspaces.set(response.workspaces);
                    active_workspace_id.set(response.active_workspace_id);
                    if let Some(workspace_id) = workspace_id {
                        match list_projects(&token, &workspace_id).await {
                            Ok(response) => projects.set(response),
                            Err(message) => error.set(Some(message)),
                        }
                    }
                }
                Err(message) => error.set(Some(message)),
            }
            loading.set(false);
            projects_loading.set(false);
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
    let project_items = projects.read().clone();
    let selected_project = selected_project_id.read().as_ref().and_then(|selected_id| {
        projects
            .read()
            .iter()
            .find(|project| project.id == *selected_id)
            .cloned()
    });
    let error_message = error.read().clone();
    let is_loading = *loading.read();
    let are_projects_loading = *projects_loading.read();
    let token_for_workspace_create = token.clone();
    let token_for_project_create = token.clone();

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
                                                            let workspace_id = workspace.id;
                                                            active_workspace_id.set(Some(workspace_id.clone()));
                                                            selected_project_id.set(None);
                                                            projects.set(Vec::new());
                                                            projects_loading.set(true);
                                                            creating_project.set(false);
                                                            new_project_name.set(String::new());
                                                            menu_open.set(false);

                                                            let response = list_projects(&token, &workspace_id).await;
                                                            let is_current = active_workspace_id
                                                                .read()
                                                                .as_ref()
                                                                .is_some_and(|active_id| active_id == &workspace_id);
                                                            if is_current {
                                                                match response {
                                                                    Ok(response) => projects.set(response),
                                                                    Err(message) => error.set(Some(message)),
                                                                }
                                                                projects_loading.set(false);
                                                            }
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
                                        let token = token_for_workspace_create.clone();
                                        async move {
                                            event.prevent_default();
                                            error.set(None);
                                            let name = new_workspace_name.read().trim().to_owned();
                                            if name.is_empty() {
                                                error.set(Some("Enter a workspace name.".to_owned()));
                                                return;
                                            }

                                            match create_workspace(&token, &name).await {
                                                Ok(workspace) => {
                                                    active_workspace_id.set(Some(workspace.id.clone()));
                                                    workspaces.write().push(workspace);
                                                    projects.set(Vec::new());
                                                    selected_project_id.set(None);
                                                    projects_loading.set(false);
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
                    button {
                        class: if selected_project.is_none() { "nav-item active" } else { "nav-item" },
                        r#type: "button",
                        onclick: move |_| selected_project_id.set(None),
                        span { class: "nav-icon", "□" }
                        "Inbox"
                    }
                    button { class: "nav-item", r#type: "button",
                        span { class: "nav-icon", "✓" }
                        "My Tasks"
                    }

                    p { class: "nav-section-label", "Projects" }
                    if are_projects_loading {
                        p { class: "nav-empty", "Loading…" }
                    } else if project_items.is_empty() {
                        p { class: "nav-empty", "No projects yet" }
                    } else {
                        for project in project_items.iter() {
                            {
                                let project_id = project.id.clone();
                                let project_name = project.name.clone();
                                let is_selected = selected_project_id
                                    .read()
                                    .as_ref()
                                    .is_some_and(|selected_id| selected_id == &project.id);

                                rsx! {
                                    button {
                                        class: if is_selected { "project-item active" } else { "project-item" },
                                        r#type: "button",
                                        onclick: move |_| selected_project_id.set(Some(project_id.clone())),
                                        span { class: "project-mark" }
                                        span { "{project_name}" }
                                    }
                                }
                            }
                        }
                    }

                    if *creating_project.read() {
                        form {
                            class: "project-create-form",
                            onsubmit: move |event| {
                                let token = token_for_project_create.clone();
                                async move {
                                    event.prevent_default();
                                    error.set(None);
                                    let name = new_project_name.read().trim().to_owned();
                                    if name.is_empty() {
                                        error.set(Some("Enter a project name.".to_owned()));
                                        return;
                                    }
                                    let Some(workspace_id) = active_workspace_id.read().clone() else {
                                        error.set(Some("Select a workspace first.".to_owned()));
                                        return;
                                    };

                                    match create_project(&token, &workspace_id, &name).await {
                                        Ok(project) => {
                                            selected_project_id.set(Some(project.id.clone()));
                                            projects.write().push(project);
                                            new_project_name.set(String::new());
                                            creating_project.set(false);
                                        }
                                        Err(message) => error.set(Some(message)),
                                    }
                                }
                            },
                            input {
                                r#type: "text",
                                aria_label: "Project name",
                                autofocus: true,
                                placeholder: "Project name",
                                value: new_project_name,
                                oninput: move |event| new_project_name.set(event.value()),
                            }
                            button { r#type: "submit", "Create" }
                        }
                    } else {
                        button {
                            class: "project-create-action",
                            r#type: "button",
                            disabled: active_workspace.is_none() || are_projects_loading,
                            onclick: move |_| creating_project.set(true),
                            span { "+" }
                            "New project"
                        }
                    }

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
                    h1 {
                        if let Some(project) = &selected_project {
                            "{project.name}"
                        } else {
                            "Inbox"
                        }
                    }
                }
                div { class: "content-empty",
                    if selected_project.is_some() {
                        p { "This project has no tasks yet." }
                    } else {
                        p { "No tasks yet." }
                    }
                }
                if let Some(message) = error_message {
                    p { class: "shell-error", role: "alert", "{message}" }
                }
            }
        }
    }
}
