use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

const TRUST: &str = include_str!("../../../../packages/tool-manifest/market-trust.json");
const MAX_BYTES: usize = 2_000_000;

#[derive(Deserialize)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema_version: u32,
    releases: Vec<Release>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub manifest: serde_json::Value,
    api_version: u32,
    pub sha256: String,
    bytes: usize,
}

pub fn verify_package(id: &str, html: &str, envelope: &Envelope) -> Result<Release, String> {
    if envelope.payload.len() > MAX_BYTES || html.len() > MAX_BYTES {
        return Err("市场响应超过大小限制".into());
    }
    let trust: serde_json::Value = serde_json::from_str(TRUST).map_err(|e| e.to_string())?;
    let key_bytes =
        hex::decode(trust["publicKey"].as_str().ok_or("公钥无效")?).map_err(|e| e.to_string())?;
    let key_array: [u8; 32] = key_bytes.try_into().map_err(|_| "公钥长度无效")?;
    let key = VerifyingKey::from_bytes(&key_array).map_err(|e| e.to_string())?;
    let signature = hex::decode(&envelope.signature).map_err(|e| e.to_string())?;
    let signature = Signature::from_slice(&signature).map_err(|e| e.to_string())?;
    key.verify_strict(envelope.payload.as_bytes(), &signature)
        .map_err(|_| "市场目录签名验证失败")?;
    let catalog: Catalog = serde_json::from_str(&envelope.payload).map_err(|e| e.to_string())?;
    if catalog.schema_version != 1 || catalog.releases.len() > 2000 {
        return Err("目录版本不兼容".into());
    }
    let checksum = format!("{:x}", Sha256::digest(html.as_bytes()));
    let release = catalog
        .releases
        .into_iter()
        .find(|release| release.manifest["id"].as_str() == Some(id) && release.sha256 == checksum)
        .ok_or("工具包不在签名目录中")?;
    if release.api_version != 1
        || release.bytes != html.len()
        || release.manifest["version"].as_str().is_none()
        || release.manifest["name"].as_str().is_none()
        || release.manifest["permissions"]
            .as_array()
            .is_none_or(|items| !items.is_empty())
    {
        return Err("工具包不兼容或请求了未支持的权限".into());
    }
    Ok(release)
}

fn resource_url(source: &str, path: &str) -> Result<reqwest::Url, String> {
    if path != "catalog.json" {
        let digest = path
            .strip_prefix("packages/")
            .and_then(|value| value.strip_suffix(".xtool"))
            .ok_or("不允许的市场路径")?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("无效的工具包摘要".into());
        }
    }
    let mut base = reqwest::Url::parse(source).map_err(|e| e.to_string())?;
    if base.scheme() != "https"
        && !(base.scheme() == "http"
            && matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
    {
        return Err("市场源必须使用 HTTPS（本机开发除外）".into());
    }
    if !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("市场源地址不能包含凭据、查询参数或片段".into());
    }
    if !base.path().ends_with('/') {
        base.set_path(&format!("{}/", base.path()));
    }
    base.join(path).map_err(|e| e.to_string())
}

pub async fn request(path: &str) -> Result<String, String> {
    let base =
        option_env!("XTOOLS_MARKET_URL").unwrap_or("https://jupiterben.github.io/xtools-market/");
    #[cfg(debug_assertions)]
    let configured = std::env::var("XTOOLS_MARKET_URL").unwrap_or_else(|_| base.to_owned());
    #[cfg(not(debug_assertions))]
    let configured = base.to_owned();
    let url = resource_url(&configured, path)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .header(
            reqwest::header::CACHE_CONTROL,
            if path == "catalog.json" {
                "no-cache"
            } else {
                "max-age=31536000"
            },
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("市场请求失败 ({})", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("市场响应超过大小限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const CATALOG: &str = include_str!("../../../../tests/fixtures/market/catalog.json");

    #[test]
    fn static_urls_preserve_repository_prefix() {
        for base in [
            "https://jupiterben.github.io/xtools-market",
            "https://jupiterben.github.io/xtools-market/",
        ] {
            assert_eq!(
                resource_url(base, "catalog.json").unwrap().as_str(),
                "https://jupiterben.github.io/xtools-market/catalog.json"
            );
            let path = format!("packages/{}.xtool", "a".repeat(64));
            assert_eq!(
                resource_url(base, &path).unwrap().as_str(),
                format!("https://jupiterben.github.io/xtools-market/{path}")
            );
        }
        for path in [
            "../catalog.json",
            "/catalog.json",
            "https://untrusted.example/catalog.json",
            "packages/bad.xtool",
        ] {
            assert!(resource_url("https://example.com/repo/", path).is_err());
        }
        for base in [
            "http://example.com/",
            "https://user:pass@example.com/",
            "https://example.com/?token=secret",
            "https://example.com/#fragment",
        ] {
            assert!(resource_url(base, "catalog.json").is_err());
        }
        assert!(resource_url("http://127.0.0.1:1430/repo", "catalog.json").is_ok());
    }

    fn fixture() -> (Envelope, String, String) {
        let envelope: Envelope = serde_json::from_str(CATALOG).unwrap();
        let catalog: Catalog = serde_json::from_str(&envelope.payload).unwrap();
        let release = &catalog.releases[0];
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/market/packages");
        let html =
            std::fs::read_to_string(directory.join(format!("{}.html", release.sha256))).unwrap();
        (
            envelope,
            release.manifest["id"].as_str().unwrap().into(),
            html,
        )
    }

    #[test]
    fn verifies_service_signature_and_rejects_tampering() {
        let (mut envelope, id, html) = fixture();
        assert!(verify_package(&id, &html, &envelope).is_ok());
        assert!(verify_package(&id, &(html.clone() + "changed"), &envelope).is_err());
        assert!(verify_package("another-tool", &html, &envelope).is_err());
        envelope.payload.push(' ');
        assert!(verify_package(&id, &html, &envelope).is_err());
    }

    #[test]
    fn downloaded_tool_metadata_survives_database_restart() {
        let (envelope, id, html) = fixture();
        let release = verify_package(&id, &html, &envelope).unwrap();
        let path =
            std::env::temp_dir().join(format!("xtools-market-{}.sqlite", uuid::Uuid::new_v4()));
        {
            let mut store = crate::store::Store::open(&path).unwrap();
            store.uninstall(&id).unwrap();
            store.install_market(&id, &html, &release).unwrap();
        }
        {
            let mut store = crate::store::Store::open(&path).unwrap();
            let snapshot = serde_json::to_value(store.snapshot().unwrap()).unwrap();
            let tool = snapshot["installed"]
                .as_array()
                .unwrap()
                .iter()
                .find(|tool| tool["id"] == id)
                .unwrap();
            assert_eq!(tool["manifest"]["name"], release.manifest["name"]);
            assert!(store.open_tool(&id).is_ok());
            store.uninstall(&id).unwrap();
            assert!(store.open_tool(&id).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }
}
