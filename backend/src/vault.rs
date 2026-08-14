use std::{io, path::PathBuf};

use crate::domain::{task::TaskId, workspace::WorkspaceId};
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(data_root: impl Into<PathBuf>) -> Self {
        Self {
            root: data_root.into().join("vaults"),
        }
    }

    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    pub async fn read_task_markdown(
        &self,
        workspace_id: WorkspaceId,
        task_id: TaskId,
    ) -> io::Result<Option<String>> {
        match fs::read_to_string(self.task_markdown_path(workspace_id, task_id)).await {
            Ok(content) => Ok(Some(content)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub async fn write_task_markdown(
        &self,
        workspace_id: WorkspaceId,
        task_id: TaskId,
        content: &str,
    ) -> io::Result<()> {
        let path = self.task_markdown_path(workspace_id, task_id);
        let directory = path
            .parent()
            .expect("Task Markdown paths always have a parent directory");
        fs::create_dir_all(directory).await?;

        let temporary_path = directory.join(format!(".{task_id}.{}.tmp", Uuid::new_v4()));
        let result = async {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary_path)
                .await?;
            file.write_all(content.as_bytes()).await?;
            file.sync_all().await?;
            drop(file);
            fs::rename(&temporary_path, path).await
        }
        .await;

        if result.is_err() {
            let _ = fs::remove_file(&temporary_path).await;
        }
        result
    }

    fn task_markdown_path(&self, workspace_id: WorkspaceId, task_id: TaskId) -> PathBuf {
        self.root
            .join(workspace_id.to_string())
            .join("Tasks")
            .join(format!("{task_id}.md"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn task_markdown_uses_stable_ids_and_round_trips_exact_content() {
        let data_root = std::env::temp_dir().join(format!("kanleaf-vault-{}", Uuid::new_v4()));
        let vault = Vault::new(&data_root);
        let workspace_a = WorkspaceId::new();
        let workspace_b = WorkspaceId::new();
        let task_id = TaskId::new();
        let content = "# Kanleaf\n\n  Markdown content.  \n";
        let expected_path = data_root
            .join("vaults")
            .join(workspace_a.to_string())
            .join("Tasks")
            .join(format!("{task_id}.md"));

        assert_eq!(
            vault
                .read_task_markdown(workspace_a, task_id)
                .await
                .unwrap(),
            None
        );
        vault
            .write_task_markdown(workspace_a, task_id, content)
            .await
            .unwrap();

        assert_eq!(fs::read_to_string(&expected_path).await.unwrap(), content);
        assert_eq!(
            vault
                .read_task_markdown(workspace_a, task_id)
                .await
                .unwrap()
                .as_deref(),
            Some(content)
        );
        assert_eq!(
            vault
                .read_task_markdown(workspace_b, task_id)
                .await
                .unwrap(),
            None
        );
        assert!(expected_path.parent().unwrap().is_dir());

        fs::remove_dir_all(data_root).await.unwrap();
    }
}
