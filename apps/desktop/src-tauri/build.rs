fn main() {
    println!("cargo:rerun-if-env-changed=XTOOLS_MARKET_URL");
    tauri_build::build()
}
