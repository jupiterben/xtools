use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const RUNTIME: &str = include_str!("../../public/runtime/tool.html");
const INTEGRITY: &str = include_str!("../../public/runtime/integrity.json");
const CATALOG: &str = include_str!("../../../../packages/tool-manifest/catalog.json");
const DEFAULT_TOOLS: [&str; 3] = ["json", "base64", "timestamp"];
type Result<T> = std::result::Result<T, String>;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTool {
    id: String,
    version: String,
    installed_at: i64,
    last_opened_at: Option<i64>,
    favorite: bool,
    enabled: bool,
    manifest: Option<serde_json::Value>,
    group_id: Option<String>,
}

#[derive(Serialize)]
pub struct ToolGroup {
    id: String,
    name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    id: String,
    tool_id: String,
    action: String,
    status: String,
    created_at: i64,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub theme: String,
    pub confirm_uninstall: bool,
}

#[derive(Serialize)]
pub struct Snapshot {
    groups: Vec<ToolGroup>,
    installed: Vec<InstalledTool>,
    tasks: Vec<TaskRecord>,
    settings: Settings,
}

#[derive(Serialize)]
pub struct OpenTool {
    html: String,
    snapshot: Snapshot,
}

#[derive(Deserialize)]
struct CatalogTool {
    id: String,
    version: String,
}

pub struct Store {
    connection: Connection,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn official_checksum() -> Result<String> {
    let integrity: serde_json::Value =
        serde_json::from_str(INTEGRITY).map_err(|error| error.to_string())?;
    let checksum = hash(RUNTIME);
    if integrity["apiVersion"].as_u64() != Some(1)
        || integrity["sha256"].as_str() != Some(checksum.as_str())
    {
        return Err("官方工具包完整性校验失败".into());
    }
    Ok(checksum)
}

fn catalog_tool(id: &str) -> Result<CatalogTool> {
    serde_json::from_str::<Vec<CatalogTool>>(CATALOG)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|tool| tool.id == id)
        .ok_or_else(|| "未知工具".into())
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        Self::initialize(connection)
    }

    fn initialize(mut connection: Connection) -> Result<Self> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS tools (
               id TEXT PRIMARY KEY, version TEXT NOT NULL, installed_at INTEGER NOT NULL,
               last_opened_at INTEGER, favorite INTEGER NOT NULL, enabled INTEGER NOT NULL,
               html TEXT NOT NULL, sha256 TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS tasks (
               id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, action TEXT NOT NULL,
               status TEXT NOT NULL, created_at INTEGER NOT NULL, message TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS groups (
               id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE
             );
             CREATE TABLE IF NOT EXISTS tool_groups (
               tool_id TEXT PRIMARY KEY REFERENCES tools(id) ON DELETE CASCADE,
               group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE
             );",
            )
            .map_err(|error| error.to_string())?;
        let has_manifest: bool = connection
            .prepare("PRAGMA table_info(tools)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .filter_map(|value| value.ok())
            .any(|name| name == "manifest");
        if !has_manifest {
            connection
                .execute("ALTER TABLE tools ADD COLUMN manifest TEXT", [])
                .map_err(|e| e.to_string())?;
        }
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let initialized: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM metadata WHERE key = 'initialized')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !initialized {
            let checksum = official_checksum()?;
            for id in DEFAULT_TOOLS {
                let tool = catalog_tool(id)?;
                transaction
                    .execute(
                        "INSERT INTO tools (id, version, installed_at, last_opened_at, favorite, enabled, html, sha256) VALUES (?1, ?2, ?3, NULL, ?4, 1, ?5, ?6)",
                        params![id, tool.version, now(), id == "json", RUNTIME, checksum],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "INSERT INTO metadata VALUES ('settings', ?1)",
                    [r#"{"theme":"light","confirmUninstall":true}"#],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute("INSERT INTO metadata VALUES ('initialized', '1')", [])
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(Self { connection })
    }

    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.version, t.installed_at, t.last_opened_at, t.favorite, t.enabled, t.manifest, g.group_id
             FROM tools t LEFT JOIN tool_groups g ON g.tool_id = t.id ORDER BY t.installed_at, t.rowid",
        ).map_err(|error| error.to_string())?;
        let installed = statement
            .query_map([], |row| {
                Ok(InstalledTool {
                    id: row.get(0)?,
                    version: row.get(1)?,
                    installed_at: row.get(2)?,
                    last_opened_at: row.get(3)?,
                    favorite: row.get(4)?,
                    enabled: row.get(5)?,
                    manifest: row
                        .get::<_, Option<String>>(6)?
                        .and_then(|value| serde_json::from_str(&value).ok()),
                    group_id: row.get(7)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        let mut statement = self.connection.prepare(
            "SELECT id, tool_id, action, status, created_at, message FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT 100",
        ).map_err(|error| error.to_string())?;
        let tasks = statement
            .query_map([], |row| {
                Ok(TaskRecord {
                    id: row.get(0)?,
                    tool_id: row.get(1)?,
                    action: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    message: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        let settings: String = self
            .connection
            .query_row(
                "SELECT value FROM metadata WHERE key = 'settings'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let mut statement = self
            .connection
            .prepare("SELECT id, name FROM groups ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let groups = statement
            .query_map([], |row| {
                Ok(ToolGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        Ok(Snapshot {
            groups,
            installed,
            tasks,
            settings: serde_json::from_str(&settings).map_err(|error| error.to_string())?,
        })
    }

    pub fn install_market(
        &mut self,
        id: &str,
        html: &str,
        release: &crate::market::Release,
    ) -> Result<Snapshot> {
        let manifest = serde_json::to_string(&release.manifest).map_err(|e| e.to_string())?;
        let version = release.manifest["version"]
            .as_str()
            .ok_or("无效的工具版本")?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let changed = tx.execute(
            "INSERT OR IGNORE INTO tools (id, version, installed_at, last_opened_at, favorite, enabled, html, sha256, manifest) VALUES (?1, ?2, ?3, NULL, 0, 1, ?4, ?5, ?6)",
            params![id, version, now(), html, release.sha256, manifest],
        ).map_err(|e| e.to_string())?;
        if changed > 0 {
            Self::record(&tx, id, "install", "市场签名和工具包校验通过，工具已安装")?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.snapshot()
    }

    #[cfg(test)]
    pub fn install(&mut self, id: &str) -> Result<Snapshot> {
        let tool = catalog_tool(id)?;
        let checksum = official_checksum()?;
        // Bundle and metadata share one SQLite transaction, so a crash cannot leave a half-installed tool.
        let tx = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let changed = tx
            .execute(
                "INSERT OR IGNORE INTO tools (id, version, installed_at, last_opened_at, favorite, enabled, html, sha256) VALUES (?1, ?2, ?3, NULL, 0, 1, ?4, ?5)",
                params![id, tool.version, now(), RUNTIME, checksum],
            )
            .map_err(|error| error.to_string())?;
        if changed > 0 {
            Self::record(&tx, id, "install", "完整性校验通过，工具已安装")?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        self.snapshot()
    }

    pub fn uninstall(&mut self, id: &str) -> Result<Snapshot> {
        let tx = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let changed = tx
            .execute("DELETE FROM tools WHERE id = ?1", [id])
            .map_err(|error| error.to_string())?;
        if changed > 0 {
            Self::record(&tx, id, "uninstall", "工具包及偏好已移除")?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        self.snapshot()
    }

    fn record(connection: &Connection, id: &str, action: &str, message: &str) -> Result<()> {
        connection
            .execute(
                "INSERT INTO tasks VALUES (?1, ?2, ?3, 'completed', ?4, ?5)",
                params![Uuid::new_v4().to_string(), id, action, now(), message],
            )
            .map_err(|error| error.to_string())?;
        connection.execute(
            "DELETE FROM tasks WHERE rowid NOT IN (SELECT rowid FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT 100)", [],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn favorite(&mut self, id: &str, value: bool) -> Result<Snapshot> {
        let changed = self
            .connection
            .execute(
                "UPDATE tools SET favorite = ?1 WHERE id = ?2",
                params![value, id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("请先安装工具".into());
        }
        self.snapshot()
    }

    pub fn enabled(&mut self, id: &str, value: bool) -> Result<Snapshot> {
        let changed = self
            .connection
            .execute(
                "UPDATE tools SET enabled = ?1 WHERE id = ?2",
                params![value, id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("请先安装工具".into());
        }
        self.snapshot()
    }

    pub fn open_tool(&mut self, id: &str) -> Result<OpenTool> {
        let (html, checksum, enabled): (String, String, bool) = self
            .connection
            .query_row(
                "SELECT html, sha256, enabled FROM tools WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| "工具尚未安装".to_string())?;
        if !enabled {
            return Err("工具已停用".into());
        }
        if hash(&html) != checksum {
            return Err("工具包已损坏，请卸载后重新安装".into());
        }
        self.connection
            .execute(
                "UPDATE tools SET last_opened_at = ?1 WHERE id = ?2",
                params![now(), id],
            )
            .map_err(|error| error.to_string())?;
        Ok(OpenTool {
            html,
            snapshot: self.snapshot()?,
        })
    }

    pub fn save_settings(&mut self, settings: Settings) -> Result<Snapshot> {
        if !["light", "dark", "system"].contains(&settings.theme.as_str()) {
            return Err("不支持的主题".into());
        }
        self.connection
            .execute(
                "UPDATE metadata SET value = ?1 WHERE key = 'settings'",
                [serde_json::to_string(&settings).map_err(|error| error.to_string())?],
            )
            .map_err(|error| error.to_string())?;
        self.snapshot()
    }

    pub fn clear_tasks(&mut self) -> Result<Snapshot> {
        self.connection
            .execute("DELETE FROM tasks", [])
            .map_err(|error| error.to_string())?;
        self.snapshot()
    }

    fn group_name(&self, value: &str, except_id: Option<&str>) -> Result<String> {
        let name = value.trim();
        if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
            return Err("分组名称需为 1–40 个字符，且不能包含控制字符".into());
        }
        let duplicate: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM groups WHERE name = ?1 AND (?2 IS NULL OR id != ?2))",
                params![name, except_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if duplicate || ["全部工具", "未分组"].contains(&name) {
            return Err("分组名称已存在或为保留名称".into());
        }
        Ok(name.into())
    }

    pub fn create_group(&mut self, name: &str) -> Result<Snapshot> {
        let count: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM groups", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if count >= 100 {
            return Err("最多创建 100 个分组".into());
        }
        let name = self.group_name(name, None)?;
        self.connection
            .execute(
                "INSERT INTO groups (id, name) VALUES (?1, ?2)",
                params![Uuid::new_v4().to_string(), name],
            )
            .map_err(|e| e.to_string())?;
        self.snapshot()
    }

    pub fn rename_group(&mut self, id: &str, name: &str) -> Result<Snapshot> {
        let name = self.group_name(name, Some(id))?;
        let changed = self
            .connection
            .execute(
                "UPDATE groups SET name = ?1 WHERE id = ?2",
                params![name, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("分组不存在".into());
        }
        self.snapshot()
    }

    pub fn delete_group(&mut self, id: &str) -> Result<Snapshot> {
        let changed = self
            .connection
            .execute("DELETE FROM groups WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("分组不存在".into());
        }
        self.snapshot()
    }

    pub fn set_tool_group(&mut self, ids: &[String], group_id: Option<&str>) -> Result<Snapshot> {
        if ids.is_empty() || ids.len() > 2000 {
            return Err("请选择 1–2000 个工具".into());
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if let Some(id) = group_id {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?1)",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err("分组不存在".into());
            }
        }
        for id in ids {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM tools WHERE id = ?1)",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err("请先安装工具".into());
            }
            tx.execute("DELETE FROM tool_groups WHERE tool_id = ?1", [id])
                .map_err(|e| e.to_string())?;
            if let Some(group) = group_id {
                tx.execute(
                    "INSERT INTO tool_groups (tool_id, group_id) VALUES (?1, ?2)",
                    params![id, group],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }

    #[test]
    fn install_uninstall_is_atomic_and_idempotent() {
        let mut store = store();
        assert_eq!(store.snapshot().unwrap().installed.len(), 3);
        store.install("uuid").unwrap();
        store.install("uuid").unwrap();
        assert_eq!(store.snapshot().unwrap().installed.len(), 4);
        assert_eq!(store.snapshot().unwrap().tasks.len(), 1);
        assert!(store.open_tool("uuid").is_ok());
        store.uninstall("uuid").unwrap();
        store.uninstall("uuid").unwrap();
        assert!(store.open_tool("uuid").is_err());
        assert_eq!(store.snapshot().unwrap().tasks.len(), 2);
    }

    #[test]
    fn rejects_unknown_disabled_and_corrupted_tools() {
        let mut store = store();
        assert!(store.install("../../malicious").is_err());
        store.enabled("json", false).unwrap();
        assert!(store.open_tool("json").is_err());
        store.enabled("json", true).unwrap();
        store
            .connection
            .execute("UPDATE tools SET html = 'corrupt' WHERE id = 'json'", [])
            .unwrap();
        assert!(store.open_tool("json").err().unwrap().contains("损坏"));
    }

    #[test]
    fn settings_and_favorites_are_persisted() {
        let mut store = store();
        store.favorite("json", false).unwrap();
        let state = store
            .save_settings(Settings {
                theme: "dark".into(),
                confirm_uninstall: false,
            })
            .unwrap();
        assert!(
            !state
                .installed
                .iter()
                .find(|tool| tool.id == "json")
                .unwrap()
                .favorite
        );
        assert_eq!(state.settings.theme, "dark");
        assert!(store
            .save_settings(Settings {
                theme: "invalid".into(),
                confirm_uninstall: true
            })
            .is_err());
    }

    #[test]
    fn restarting_does_not_reinstall_removed_defaults() {
        let path = std::env::temp_dir().join(format!("xtools-{}.sqlite", Uuid::new_v4()));
        {
            let mut store = Store::open(&path).unwrap();
            store.uninstall("json").unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.snapshot().unwrap().installed.len(), 2);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn groups_validate_names_and_move_atomically() {
        let mut store = store();
        let group = store.create_group("  开发  ").unwrap().groups.remove(0);
        assert_eq!(group.name, "开发");
        for name in ["", "  ", "开发", "全部工具", "未分组", "a\nb"] {
            assert!(store.create_group(name).is_err());
        }
        assert!(store.create_group(&"x".repeat(41)).is_err());
        assert!(store.rename_group("missing", "新名称").is_err());
        assert!(store.delete_group("missing").is_err());
        store.rename_group(&group.id, "开发").unwrap();
        let ids = vec!["json".into(), "base64".into()];
        store.set_tool_group(&ids, Some(&group.id)).unwrap();
        assert!(store.set_tool_group(&[], None).is_err());
        assert!(store.set_tool_group(&ids, Some("missing")).is_err());
        assert!(store
            .set_tool_group(&["json".into(), "missing".into()], None)
            .is_err());
        assert_eq!(
            store
                .snapshot()
                .unwrap()
                .installed
                .iter()
                .filter(|tool| tool.group_id.as_deref() == Some(&group.id))
                .count(),
            2
        );
        store.rename_group(&group.id, "常用").unwrap();
        store.enabled("json", false).unwrap();
        let state = store.delete_group(&group.id).unwrap();
        assert_eq!(state.installed.len(), 3);
        assert!(state.groups.is_empty());
        assert!(state.installed.iter().all(|tool| tool.group_id.is_none()));
        let json = state
            .installed
            .iter()
            .find(|tool| tool.id == "json")
            .unwrap();
        assert!(json.favorite);
        assert!(!json.enabled);
    }

    #[test]
    fn groups_migrate_legacy_database_and_survive_restart() {
        let path = std::env::temp_dir().join(format!("xtools-groups-{}.sqlite", Uuid::new_v4()));
        {
            let mut store = Store::open(&path).unwrap();
            store.uninstall("timestamp").unwrap();
            store
                .connection
                .execute_batch("DROP TABLE tool_groups; DROP TABLE groups;")
                .unwrap();
        }
        let group_id;
        {
            let mut store = Store::open(&path).unwrap();
            assert_eq!(store.snapshot().unwrap().installed.len(), 2);
            assert!(store.snapshot().unwrap().groups.is_empty());
            group_id = store.create_group("常用").unwrap().groups.remove(0).id;
            store
                .set_tool_group(&["json".into(), "base64".into()], Some(&group_id))
                .unwrap();
        }
        {
            let mut store = Store::open(&path).unwrap();
            assert_eq!(store.snapshot().unwrap().groups[0].name, "常用");
            assert!(store
                .snapshot()
                .unwrap()
                .installed
                .iter()
                .all(|tool| tool.group_id.as_deref() == Some(&group_id)));
            store.uninstall("base64").unwrap();
            let state = store.install("base64").unwrap();
            assert!(state
                .installed
                .iter()
                .find(|tool| tool.id == "base64")
                .unwrap()
                .group_id
                .is_none());
            assert_eq!(state.groups.len(), 1);
        }
        std::fs::remove_file(path).unwrap();
    }
}
