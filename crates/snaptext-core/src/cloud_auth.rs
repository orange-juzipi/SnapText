#[cfg(test)]
use std::sync::{Mutex, OnceLock};
use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use crate::{
    Error, Result,
    config::{SnapTextCloudConfig, app_data_dir},
};

const AUTH_CONTEXT: &str = "SNAPTEXT-AUTH-V1";
const DEVICE_ID_PREFIX: &str = "snaptext-desktop";
const IDENTITY_FILE: &str = "cloud-device.yaml";

#[derive(Debug, Clone)]
pub struct CloudDeviceIdentity {
    device_id: String,
    signing_key: SigningKey,
}

#[derive(Debug, Clone)]
pub struct SignedCloudRequest {
    pub timestamp_ms: String,
    pub nonce: String,
    pub body_sha256: String,
    pub signature: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredCloudDeviceIdentity {
    device_id: String,
    private_key: String,
}

impl CloudDeviceIdentity {
    pub fn load_or_create(config: &SnapTextCloudConfig) -> Result<Self> {
        Self::load_or_create_at(config, default_identity_path())
    }

    pub fn load_or_create_at(config: &SnapTextCloudConfig, path: PathBuf) -> Result<Self> {
        if path.exists() {
            return Self::load(path);
        }

        let identity = Self::generate(config.device_id.clone())?;
        identity.save(path)?;
        Ok(identity)
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn public_key_base64(&self) -> String {
        general_purpose::STANDARD.encode(self.signing_key.verifying_key().to_bytes())
    }

    pub fn sign_json_request(
        &self,
        method: &str,
        url: &Url,
        body: &[u8],
    ) -> Result<SignedCloudRequest> {
        let timestamp_ms = unix_timestamp_millis().to_string();
        let nonce = random_nonce()?;
        self.sign_json_request_with_parts(method, url, body, timestamp_ms, nonce)
    }

    fn sign_json_request_with_parts(
        &self,
        method: &str,
        url: &Url,
        body: &[u8],
        timestamp_ms: String,
        nonce: String,
    ) -> Result<SignedCloudRequest> {
        let body_sha256 = hex::encode(Sha256::digest(body));
        let canonical = format!(
            "{AUTH_CONTEXT}\n{}\n{}\n{}\n{}\n{}\n{}",
            method.to_ascii_uppercase(),
            path_and_query(url),
            self.device_id,
            timestamp_ms,
            nonce,
            body_sha256
        );
        let signature = self.signing_key.sign(canonical.as_bytes());
        Ok(SignedCloudRequest {
            timestamp_ms,
            nonce,
            body_sha256,
            signature: general_purpose::STANDARD.encode(signature.to_bytes()),
        })
    }

    fn generate(config_device_id: String) -> Result<Self> {
        let mut private_key = [0_u8; 32];
        getrandom::fill(&mut private_key)
            .map_err(|err| Error::Config(format!("failed to generate cloud device key: {err}")))?;
        Ok(Self {
            device_id: normalize_cloud_device_id(config_device_id),
            signing_key: SigningKey::from_bytes(&private_key),
        })
    }

    fn load(path: PathBuf) -> Result<Self> {
        let content = fs::read_to_string(path)?;
        let stored: StoredCloudDeviceIdentity = serde_yaml::from_str(&content)?;
        let private_key = decode_private_key(&stored.private_key)?;
        Ok(Self {
            device_id: normalize_cloud_device_id(stored.device_id),
            signing_key: SigningKey::from_bytes(&private_key),
        })
    }

    fn save(&self, path: PathBuf) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let stored = StoredCloudDeviceIdentity {
            device_id: self.device_id.clone(),
            private_key: general_purpose::STANDARD.encode(self.signing_key.to_bytes()),
        };
        let content = serde_yaml::to_string(&stored)?;
        write_secret_file(&path, content.as_bytes())
    }
}

pub fn registered_marker_path(endpoint: &Url, device_id: &str) -> PathBuf {
    let digest = Sha256::digest(endpoint.origin().ascii_serialization().as_bytes());
    let filename = format!(
        "cloud-device-registered-{device_id}-{}.marker",
        hex::encode(&digest[..8])
    );
    #[cfg(test)]
    if let Some(path) = test_identity_path().and_then(|path| path.parent().map(Path::to_path_buf)) {
        return path.join(filename);
    }
    app_data_dir().join(filename)
}

pub fn is_registered_locally(endpoint: &Url, device_id: &str) -> bool {
    registered_marker_path(endpoint, device_id).exists()
}

pub fn mark_registered_locally(endpoint: &Url, device_id: &str) -> Result<()> {
    let path = registered_marker_path(endpoint, device_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, b"registered\n")?;
    Ok(())
}

pub fn default_identity_path() -> PathBuf {
    #[cfg(test)]
    if let Some(path) = test_identity_path() {
        return path;
    }
    app_data_dir().join(IDENTITY_FILE)
}

pub fn normalize_cloud_device_id(value: String) -> String {
    let value = value.trim();
    if is_valid_cloud_device_id(value) {
        return value.to_owned();
    }
    format!("{DEVICE_ID_PREFIX}-{}", Uuid::new_v4())
}

pub fn cloud_register_endpoint(config: &SnapTextCloudConfig) -> Result<Url> {
    join_cloud_url(&config.endpoint, "v1/auth/devices")
}

pub fn cloud_translate_endpoint(config: &SnapTextCloudConfig) -> Result<Url> {
    join_cloud_url(&config.endpoint, "v1/translate")
}

fn join_cloud_url(base: &Url, path: &str) -> Result<Url> {
    let mut url = base.clone();
    let mut base_path = url.path().trim_end_matches('/').to_owned();
    if !path.is_empty() {
        base_path.push('/');
        base_path.push_str(path.trim_start_matches('/'));
    }
    url.set_path(&base_path);
    Ok(url)
}

fn decode_private_key(value: &str) -> Result<[u8; 32]> {
    let bytes = general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|err| Error::Config(format!("cloud device private key is invalid: {err}")))?;
    bytes
        .try_into()
        .map_err(|_| Error::Config("cloud device private key must decode to 32 bytes".to_owned()))
}

fn is_valid_cloud_device_id(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn path_and_query(url: &Url) -> String {
    match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_owned(),
    }
}

fn random_nonce() -> Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|err| Error::Translate(format!("failed to generate request nonce: {err}")))?;
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn unix_timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(unix)]
fn write_secret_file(path: &Path, content: &[u8]) -> Result<()> {
    use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt};

    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true).mode(0o600);
    std::io::Write::write_all(&mut options.open(path)?, content)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_secret_file(path: &Path, content: &[u8]) -> Result<()> {
    fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
pub fn set_test_identity_path(path: PathBuf) {
    let storage = TEST_IDENTITY_PATH.get_or_init(|| Mutex::new(None));
    *storage.lock().expect("test identity path lock") = Some(path);
}

#[cfg(test)]
fn test_identity_path() -> Option<PathBuf> {
    TEST_IDENTITY_PATH
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("test identity path lock")
        .clone()
}

#[cfg(test)]
static TEST_IDENTITY_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    use super::*;

    #[test]
    fn generated_identity_uses_valid_config_device_id() {
        let identity =
            CloudDeviceIdentity::generate("snaptext-client-test".to_owned()).expect("identity");

        assert_eq!(identity.device_id(), "snaptext-client-test");
        assert_eq!(
            general_purpose::STANDARD
                .decode(identity.public_key_base64())
                .expect("public key")
                .len(),
            32
        );
    }

    #[test]
    fn generated_identity_replaces_invalid_config_device_id() {
        let identity = CloudDeviceIdentity::generate("bad/device".to_owned()).expect("identity");

        assert!(identity.device_id().starts_with("snaptext-desktop-"));
    }

    #[test]
    fn signs_cloud_request_using_server_canonical_shape() {
        let identity =
            CloudDeviceIdentity::generate("snaptext-client-test".to_owned()).expect("identity");
        let url = Url::parse("https://example.com/v1/translate?debug=1").expect("url");
        let signed = identity
            .sign_json_request_with_parts(
                "post",
                &url,
                br#"{"text":"hello"}"#,
                "1710000000000".to_owned(),
                "nonce-123456".to_owned(),
            )
            .expect("signed request");

        let canonical = format!(
            "{AUTH_CONTEXT}\nPOST\n/v1/translate?debug=1\nsnaptext-client-test\n1710000000000\nnonce-123456\n{}",
            signed.body_sha256
        );
        let public_key: [u8; 32] = general_purpose::STANDARD
            .decode(identity.public_key_base64())
            .expect("public key")
            .try_into()
            .expect("public key len");
        let signature: [u8; 64] = general_purpose::STANDARD
            .decode(signed.signature)
            .expect("signature")
            .try_into()
            .expect("signature len");
        VerifyingKey::from_bytes(&public_key)
            .expect("verify key")
            .verify(canonical.as_bytes(), &Signature::from_bytes(&signature))
            .expect("valid signature");
    }

    #[test]
    fn identity_round_trips_to_private_file() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let path = tempdir.path().join("cloud-device.yaml");
        let config = SnapTextCloudConfig {
            endpoint: Url::parse("http://127.0.0.1:8080").expect("url"),
            device_id: "snaptext-client-test".to_owned(),
            enabled: true,
        };

        let first =
            CloudDeviceIdentity::load_or_create_at(&config, path.clone()).expect("first identity");
        let second =
            CloudDeviceIdentity::load_or_create_at(&config, path).expect("second identity");

        assert_eq!(first.device_id(), second.device_id());
        assert_eq!(first.public_key_base64(), second.public_key_base64());
    }
}
