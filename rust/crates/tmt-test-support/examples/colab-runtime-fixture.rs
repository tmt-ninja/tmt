//! Tiny embedded-app stand-in for archive and public-smoke verifier sensitivity.
//! Product embedding/crypto/browser acceptance remains Colab-owned.

use std::{
    env, fs,
    io::{self, Read, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

const INDEX: &str = "<!doctype html><script src=\"./assets/app.js\"></script><link href=\"./assets/app.css\" rel=\"stylesheet\">tiny embedded app\n";
const RENDERER: &str = "<!doctype html>tiny renderer\n";
const READER: &str = "<!doctype html>tiny reader\n";
const JS: &str = "console.log('embedded fixture');\n";
const CSS: &str = "body { color: blue; }\n";
const NOTICES: &str = "Tiny app attribution\n";

fn main() -> io::Result<()> {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    let variant = if args.first().map(String::as_str) == Some("--fixture-variant") {
        if args.len() < 2 {
            return Err(io::Error::other("missing fixture variant"));
        }
        let variant = args.remove(1);
        args.remove(0);
        variant
    } else {
        "valid".into()
    };
    if ![
        "valid",
        "PLACEHOLDER",
        "CORRUPT_ASSET",
        "STARTUP_FAILURE",
        "LEAK_SOCKET",
        "REQUEST_BARRIER",
    ]
    .contains(&variant.as_str())
    {
        return Err(io::Error::other("unknown fixture variant"));
    }
    if args == ["skill"] {
        io::stdout().write_all(b"Colab fixture skill\n")?;
        return Ok(());
    }
    if args == ["--version"] {
        println!("colab 0.1.0-alpha.1");
        return Ok(());
    }
    // Independent portable wire fixture: its declaration identifies one plain hosted byte.
    let metadata = serde_json::json!({"path":"/index.html",
        "sha256":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
        "length":1,"contentType":"text/html","csp":"default-src 'none'"});
    // Struct field order is pinned by the literal compact portable JSON below.
    let manifest = r#"{"version":1,"files":[{"path":"/index.html","sha256":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb","length":1,"contentType":"text/html","csp":"default-src 'none'"}]}"#;
    if args == ["hosting-bundle", "--json"] {
        let mut file = metadata;
        file["path"] = serde_json::json!(
            env::current_exe()?
                .canonicalize()?
                .parent()
                .unwrap()
                .join("dist-hosted/index.html")
        );
        println!(
            "{}",
            serde_json::json!({"version":1,"manifestDigest":"773117f410fc293b6dcef1129e1c23f68fb873b1fc4e0cea2571a6649a24f730","files":[file]})
        );
        return Ok(());
    }
    if args == ["deploy-declaration", "--json"] {
        let declaration = format!("{{\"hosting\":{manifest}}}");
        println!(
            "{}",
            serde_json::json!({"version":1,"declarationDigest":"d943d71bc09b4e554b1b34e0a787373cd01640489f6ae26ea90586ef4498aa3b","declaration":declaration})
        );
        return Ok(());
    }
    if args != ["serve", "--json"] {
        return Err(io::Error::other("unexpected fixture command"));
    }
    if env::var_os("TMT_COLAB_APP_DIR").is_some() || env::var_os("GITHUB_TOKEN").is_some() {
        return Err(io::Error::other("ambient runtime overrides"));
    }
    let state =
        PathBuf::from(env::var_os("TMT_HOME").ok_or_else(|| io::Error::other("missing state"))?);
    env::var_os("TMT_EXECUTABLE").ok_or_else(|| io::Error::other("missing core selector"))?;
    let directory = state.join("colab");
    fs::create_dir_all(&directory)?;
    let socket = directory.join("door.sock");
    let listener = UnixListener::bind(&socket)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
    let stop = Arc::new(AtomicBool::new(false));
    signal_hook::flag::register(signal_hook::consts::SIGTERM, Arc::clone(&stop))?;
    if variant == "STARTUP_FAILURE" {
        // Exit immediately after the diagnostic, without a readiness record.
        let mut stderr = io::stderr().lock();
        writeln!(stderr, "COLAB_APP_UNAVAILABLE")?;
        stderr.flush()?;
        std::process::exit(1);
    }
    println!(
        "{{\"socket\":\"{}\",\"state\":\"mounted\"}}",
        socket.display()
    );
    io::stdout().flush()?;
    listener.set_nonblocking(true)?;
    while !stop.load(Ordering::Relaxed) {
        let mut client = match listener.accept() {
            Ok((client, _)) => client,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(error) => return Err(error),
        };
        // Darwin inherits the listener's nonblocking flag on accepted sockets.
        // This synchronous reader must wait for headers under its existing timeout.
        client.set_nonblocking(false)?;
        client.set_read_timeout(Some(Duration::from_secs(3)))?;
        client.set_write_timeout(Some(Duration::from_secs(3)))?;
        if variant == "REQUEST_BARRIER" {
            eprintln!("COLAB_FIXTURE_REQUEST_ACCEPTED");
        }
        let mut request = Vec::new();
        let mut bytes = [0; 1024];
        while !request.windows(4).any(|chunk| chunk == b"\r\n\r\n") && request.len() < 8192 {
            let length = client.read(&mut bytes)?;
            if length == 0 {
                break;
            }
            request.extend_from_slice(&bytes[..length]);
        }
        let request = String::from_utf8_lossy(&request);
        let route = request.split_whitespace().nth(1).unwrap_or("");
        let (status, body, mime) = if !request.contains("tmt-device-context:") {
            (403, "DENIED", "text/plain")
        } else {
            match route {
                "/" | "/index.html" => (
                    200,
                    if variant == "PLACEHOLDER" {
                        "<html>build the app</html>"
                    } else {
                        INDEX
                    },
                    "text/html",
                ),
                "/assets/app.js" => (
                    200,
                    if variant == "CORRUPT_ASSET" {
                        "changed byte\n"
                    } else {
                        JS
                    },
                    "text/javascript",
                ),
                "/renderer.html" => (200, RENDERER, "text/html"),
                "/reader.html" => (200, READER, "text/html"),
                "/assets/app.css" => (200, CSS, "text/css"),
                "/THIRD-PARTY-NOTICES.txt" => (200, NOTICES, "text/plain"),
                _ => (404, "NOT FOUND", "text/plain"),
            }
        };
        write!(
            client,
            "HTTP/1.1 {status} Response\r\nContent-Type: {mime}; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )?;
    }
    drop(listener);
    if variant != "LEAK_SOCKET" {
        fs::remove_file(socket)?;
    }
    Ok(())
}
