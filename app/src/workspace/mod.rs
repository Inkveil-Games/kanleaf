mod api;
mod sidebar;
mod task_list;

use dioxus::prelude::*;

use crate::project::Project;
use api::{Workspace, list as list_workspaces};
use sidebar::WorkspaceSidebar;
use task_list::TaskCollection;

#[derive(Clone, Debug, PartialEq)]
enum WorkspaceView {
    Home,
    MyTasks,
    Inbox,
    Projects,
    Project(String),
}

#[component]
pub fn WorkspaceShell(token: String, user_email: String, on_logout: EventHandler<()>) -> Element {
    let mut workspace = use_signal(|| None::<Workspace>);
    let mut projects = use_signal(Vec::<Project>::new);
    let active_view = use_signal(|| WorkspaceView::Home);
    let mut loading = use_signal(|| true);
    let mut projects_loading = use_signal(|| true);
    let mut error = use_signal(|| None::<String>);

    let token_for_load = token.clone();
    use_future(move || {
        let token = token_for_load.clone();
        async move {
            match list_workspaces(&token).await {
                Ok(response) => {
                    let current_workspace = response.active_workspace_id.as_ref().and_then(|id| {
                        response
                            .workspaces
                            .iter()
                            .find(|workspace| workspace.id == *id)
                            .cloned()
                    });
                    let workspace_id = current_workspace
                        .as_ref()
                        .map(|workspace| workspace.id.clone());
                    workspace.set(current_workspace);

                    if let Some(workspace_id) = workspace_id {
                        match crate::project::list(&token, &workspace_id).await {
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

    let workspace_value = workspace.read().clone();
    let project_items = projects.read().clone();
    let active_view_value = active_view.read().clone();
    let (page_title, empty_message) = page_content(&active_view_value, &project_items);
    let error_message = error.read().clone();

    rsx! {
        main { class: "workspace-shell",
            WorkspaceSidebar {
                token: token.clone(),
                user_email,
                workspace: workspace_value,
                projects,
                active_view,
                loading: *loading.read(),
                projects_loading: *projects_loading.read(),
                on_error: move |message| error.set(Some(message)),
                on_logout,
            }

            section { class: "workspace-content",
                header { class: "content-header",
                    h1 { "{page_title}" }
                }
                if let Some(workspace) = workspace.read().clone() {
                    match &active_view_value {
                        WorkspaceView::Inbox => rsx! {
                            TaskCollection {
                                key: "{workspace.id}:inbox",
                                token: token.clone(),
                                workspace_id: workspace.id,
                                project_id: None,
                                projects: project_items.clone(),
                            }
                        },
                        WorkspaceView::Project(project_id) => rsx! {
                            TaskCollection {
                                key: "{workspace.id}:{project_id}",
                                token: token.clone(),
                                workspace_id: workspace.id,
                                project_id: Some(project_id.clone()),
                                projects: project_items.clone(),
                            }
                        },
                        _ => rsx! {
                            div { class: "content-empty",
                                p { "{empty_message}" }
                            }
                        },
                    }
                } else if !*loading.read() {
                    div { class: "content-empty",
                        p { "No workspace selected." }
                    }
                }
                if let Some(message) = error_message {
                    p { class: "shell-error", role: "alert", "{message}" }
                }
            }
        }
    }
}

fn page_content(view: &WorkspaceView, projects: &[Project]) -> (String, String) {
    match view {
        WorkspaceView::Home => ("Home".to_owned(), "Your workspace is ready.".to_owned()),
        WorkspaceView::MyTasks => (
            "My Tasks".to_owned(),
            "No tasks assigned to you.".to_owned(),
        ),
        WorkspaceView::Inbox => ("Inbox".to_owned(), "No tasks in your inbox.".to_owned()),
        WorkspaceView::Projects => {
            let message = if projects.is_empty() {
                "No projects yet."
            } else {
                "Select a project from the sidebar."
            };
            ("Projects".to_owned(), message.to_owned())
        }
        WorkspaceView::Project(project_id) => {
            let title = projects
                .iter()
                .find(|project| &project.id == project_id)
                .map(|project| project.name.clone())
                .unwrap_or_else(|| "Project".to_owned());
            (title, "This project has no tasks yet.".to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_view_uses_the_selected_project_name() {
        let projects = vec![Project {
            id: "project-a".to_owned(),
            workspace_id: "workspace-a".to_owned(),
            name: "Kanleaf Core".to_owned(),
        }];

        assert_eq!(
            page_content(&WorkspaceView::Project("project-a".to_owned()), &projects),
            (
                "Kanleaf Core".to_owned(),
                "This project has no tasks yet.".to_owned(),
            )
        );
    }
}
