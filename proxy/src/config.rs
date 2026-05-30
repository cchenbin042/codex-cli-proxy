// proxy/src/config.rs
#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
}

pub fn load_from_env() -> Config {
    let port: u16 = std::env::var("CLI_PROXY_PORT")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(8317);
    Config { port }
}
